"""Generating an import area's buildings: the work that ties the pure pieces to the database.

`GenerationService.generate` reads an area's blocks, real buildings, land use, ground and feedback,
decides which blocks are eligible and which of them are references, matches the rest to a reference
(or defaults), generates each eligible block with its own seeded generator, and replaces the area's
stored run. It reads observed tables and writes only the generation tables."""

import logging
import random
import uuid
from collections.abc import Callable, Sequence
from dataclasses import replace

from shapely.geometry import Point
from shapely.strtree import STRtree
from shapely.validation import make_valid
from sqlalchemy.orm import Session

from app.domain.block import Block
from app.domain.building import Building
from app.domain.covered_areas import compose_by_source_id
from app.domain.enums import AreaFeatureKind
from app.domain.generation import (
    ALGORITHM_VERSION,
    CALIBRATION_MIN_BLOCKS,
    CALIBRATION_RADIUS_METERS,
    EXEMPLAR_MIN_BUILDINGS,
    EXEMPLAR_MIN_COVERAGE,
    INFORMAL_HEIGHT_ABOVE_WATER_METERS,
    INFORMAL_WATER_DISTANCE_METERS,
    MIN_FOOTPRINT_SQUARE_METERS,
    MIN_GENERATION_BUILDABLE_SQUARE_METERS,
    REFERENCE_RADIUS_METERS,
    SPARSE_COVERAGE_BELOW,
    STEEP_SLOPE,
    STYLE_CONTEXT_RADIUS_METERS,
    WATER_BUFFER_METERS,
    BlockAssignment,
    BlockEligibility,
    BlockFeedback,
    CountSource,
    Fingerprint,
    GeneratedBuilding,
    GenerationRun,
    GenerationZone,
    MatchProfile,
    NewGenerationRun,
    ReferenceCandidate,
    SettlementStyle,
    StaleReason,
    best_reference,
    calibration_factor,
    default_fingerprint,
    eligibility,
    fingerprint_of,
    qualifies_as_exemplar,
    road_graph_hash,
    strongest_road_group,
    with_narrower_lots,
)
from app.domain.generation import stale_reasons as domain_stale_reasons
from app.domain.import_area import ImportArea
from app.domain.local_projection import LocalProjection, local_projection_for
from app.generation.fingerprint import measure_block
from app.generation.generator import generate_block
from app.generation.geometry import from_local_xy, polygon_from_local, polygon_to_local, solid_polygons
from app.generation.suitability import Suitability, suitability
from app.persistence.repositories.area_feature import AreaFeatureRepository
from app.persistence.repositories.block import BlockRepository
from app.persistence.repositories.building import BuildingRepository
from app.persistence.repositories.elevation import ElevationRepository
from app.persistence.repositories.generation import BlockFeedbackRepository, GenerationRepository
from app.persistence.repositories.import_area import ImportAreaRepository

logger = logging.getLogger(__name__)

NEARBY_BUILDINGS_METERS = 500.0


def stale_reasons(session: Session, area: ImportArea, run: GenerationRun) -> list[StaleReason]:
    """Why a stored run no longer matches its area, computed on read: its blocks differ
    (`roads_changed`), or its ground does (`terrain_changed`)."""
    current_hash = road_graph_hash(BlockRepository(session).ids_for_import_area(area.id))
    stored = ElevationRepository(session).get_grid(area.id)
    return domain_stale_reasons(
        run_road_graph_hash=run.road_graph_hash,
        current_road_graph_hash=current_hash,
        run_elevation_version=run.elevation_version,
        current_elevation_version=stored.version if stored is not None else None,
    )


class GenerationService:
    """Generates and stores an area's buildings. The caller commits."""

    def __init__(self, session: Session):
        self.session = session
        self.blocks = BlockRepository(session)
        self.buildings = BuildingRepository(session)
        self.runs = GenerationRepository(session)

    def generate(
        self, area: ImportArea, seed: int, progress: Callable[[int], None] | None = None
    ) -> GenerationRun:
        """Replaces the area's run with a new one for `seed`. The same seed over the same data gives
        the same buildings. `progress` is called once with the number of eligible blocks, before the
        heavy work starts."""
        projection = local_projection_for(area.bbox.ring())
        owner_ids = [area.id, *(inner.id for inner in ImportAreaRepository(self.session).completed_areas_covered_by(area.bbox, exclude_id=area.id))]

        own_blocks = sorted(self.blocks.list_for_import_area(area.id), key=lambda block: str(block.id))
        composed_buildings = compose_by_source_id(
            (self.buildings.list_for_import_area(owner_id) for owner_id in owner_ids), lambda item: item.source_id
        )
        features = compose_by_source_id(
            (AreaFeatureRepository(self.session).list_for_import_area(owner_id) for owner_id in owner_ids),
            lambda item: item.source_id,
        )
        stored_grid = ElevationRepository(self.session).get_grid(area.id)
        grid = stored_grid.grid if stored_grid is not None else None
        feedback = {
            entry.feedback.block_id: entry.feedback
            for entry in BlockFeedbackRepository(self.session).list_for_import_area(area.id)
            if not entry.orphaned
        }
        previous = self.runs.get_run(area.id)
        previous_assignments = previous.assignments() if previous is not None else {}

        eligible = [block for block in own_blocks if eligibility(block) is BlockEligibility.ELIGIBLE]
        if progress is not None:
            progress(len(eligible))

        own_ids = {block.id for block in own_blocks}
        blocks_local = {block.id: polygon_to_local(projection, block.boundary) for block in own_blocks}
        centres = {block_id: shape.centroid for block_id, shape in blocks_local.items()}
        by_block: dict[uuid.UUID, list[Building]] = {}
        for building in composed_buildings:
            if building.block_id in own_ids:
                by_block.setdefault(building.block_id, []).append(building)
        footprints = _FootprintIndex(projection, composed_buildings)

        water = [feature for feature in features if feature.kind == AreaFeatureKind.WATER]
        suitabilities: dict[uuid.UUID, Suitability] = {
            block.id: suitability(
                block,
                projection=projection,
                water=water,
                landuse=features,
                grid=grid,
                real_buildings_nearby=footprints.within(centres[block.id], NEARBY_BUILDINGS_METERS),
                area_of_context=area.bbox.ring(),
            )
            for block in eligible
        }

        road_groups = {block.id: strongest_road_group(self.blocks.bounding_road_classes(block.id)) for block in eligible}
        matcher = _ReferenceMatcher(
            self.session, area, projection, eligible, suitabilities, road_groups, centres, by_block
        )

        results: list[tuple[Block, Fingerprint, uuid.UUID | None, CountSource, float | None]] = []
        used_fingerprints: dict[uuid.UUID, Fingerprint] = {}
        calibrations: list[float] = []
        for block in eligible:
            suit = suitabilities[block.id]
            matched, reference_id = matcher.fingerprint_for(block)
            source = CountSource.REFERENCE
            if matched is None:
                matched = default_fingerprint(road_groups[block.id], suit.style)
                source = CountSource.DEFAULT
            else:
                used_fingerprints[reference_id] = matched

            factor = None
            if block.id not in feedback:
                factor = _calibration(block, suit.style, centres, feedback, previous_assignments, suitabilities)
            if factor is not None:
                matched = with_narrower_lots(matched, factor)
                calibrations.append(factor)
            if matched.median_levels is None:
                defaults = default_fingerprint(road_groups[block.id], suit.style)
                matched = replace(matched, median_levels=defaults.median_levels)
            results.append((block, matched, reference_id, source, factor))

        new_buildings: list[GeneratedBuilding] = []
        zones: list[GenerationZone] = []
        assignments: dict[str, dict] = {}
        shortfalls: list[str] = []
        for block, fingerprint, reference_id, source, factor in results:
            suit = suitabilities[block.id]
            outcome = generate_block(
                block,
                suitability=suit,
                fingerprint=fingerprint,
                reference_block_id=reference_id,
                count_source=source,
                feedback=feedback.get(block.id),
                rng=random.Random(f"{seed}:{block.id}"),
                grid=grid,
                real_footprints=footprints.around(blocks_local[block.id]),
                projection=projection,
            )
            for footprint in outcome.footprints:
                new_buildings.append(
                    GeneratedBuilding(
                        id=None,
                        run_id=None,
                        block_id=block.id,
                        geom=footprint.geom,
                        height_meters=footprint.height_meters,
                        levels=footprint.levels,
                        base_elevation_meters=footprint.base_elevation_meters,
                        style=footprint.style,
                        reference_block_id=footprint.reference_block_id,
                        count_source=footprint.count_source,
                    )
                )
            for reason, shape in outcome.suitability.zones:
                parts = tuple(polygon_from_local(projection, polygon) for polygon in solid_polygons(shape))
                if parts:
                    zones.append(GenerationZone(id=None, run_id=None, block_id=block.id, reason=reason, geom=parts))
            assignment = BlockAssignment(suit.style, reference_id, outcome.lot_count, factor)
            assignments[str(block.id)] = {
                "style": assignment.style.value,
                "reference_block_id": str(reference_id) if reference_id else None,
                "lot_count": assignment.lot_count,
                "calibration_ratio": factor,
            }
            if outcome.shortfall > 0:
                shortfalls.append(str(block.id))

        blocks_with_buildings = len({building.block_id for building in new_buildings})
        calibration_ratio = round(sum(calibrations) / len(calibrations), 4) if calibrations else None
        parameters = {
            "algorithm_version": ALGORITHM_VERSION,
            "eligible_block_count": len(eligible),
            "calibration_ratio": calibration_ratio,
            "feedback_shortfall_block_ids": shortfalls,
            "thresholds": {
                "min_buildable_square_meters": MIN_GENERATION_BUILDABLE_SQUARE_METERS,
                "water_buffer_meters": WATER_BUFFER_METERS,
                "steep_slope": STEEP_SLOPE,
                "informal_water_distance_meters": INFORMAL_WATER_DISTANCE_METERS,
                "informal_height_above_water_meters": INFORMAL_HEIGHT_ABOVE_WATER_METERS,
                "sparse_coverage_below": SPARSE_COVERAGE_BELOW,
                "style_context_radius_meters": STYLE_CONTEXT_RADIUS_METERS,
                "exemplar_min_coverage": EXEMPLAR_MIN_COVERAGE,
                "exemplar_min_buildings": EXEMPLAR_MIN_BUILDINGS,
                "reference_radius_meters": REFERENCE_RADIUS_METERS,
                "calibration_radius_meters": CALIBRATION_RADIUS_METERS,
                "calibration_min_blocks": CALIBRATION_MIN_BLOCKS,
                "min_footprint_square_meters": MIN_FOOTPRINT_SQUARE_METERS,
            },
            "blocks": assignments,
        }
        run = self.runs.replace(
            NewGenerationRun(
                import_area_id=area.id,
                seed=seed,
                parameters=parameters,
                elevation_version=stored_grid.version if stored_grid is not None else None,
                road_graph_hash=road_graph_hash(block.id for block in own_blocks),
                building_count=len(new_buildings),
                block_count=blocks_with_buildings,
            ),
            new_buildings,
            zones,
            used_fingerprints,
        )
        logger.info(
            "generation for area %s (seed %d): %d buildings on %d of %d eligible blocks",
            area.id, seed, len(new_buildings), blocks_with_buildings, len(eligible),
        )
        return run


def _calibration(
    block: Block,
    style: SettlementStyle,
    centres: dict,
    feedback: dict[uuid.UUID, BlockFeedback],
    previous: dict[uuid.UUID, BlockAssignment],
    suitabilities: dict[uuid.UUID, Suitability],
) -> float | None:
    """The width calibration for a block without feedback: from the feedback blocks within 500 m that
    share its style and were generated in the previous run (contract 6)."""
    reported: list[int] = []
    generated: list[int] = []
    here = centres[block.id]
    for other_id in sorted(feedback, key=str):
        if other_id == block.id or other_id not in previous:
            continue
        other_style = suitabilities[other_id].style if other_id in suitabilities else previous[other_id].style
        if other_style is not style or here.distance(centres[other_id]) > CALIBRATION_RADIUS_METERS:
            continue
        reported.append(feedback[other_id].target_count)
        generated.append(previous[other_id].lot_count)
    return calibration_factor(reported, generated)


class _FootprintIndex:
    """The composed real buildings in local metres, searchable by distance."""

    def __init__(self, projection: LocalProjection, buildings: Sequence[Building]):
        self.buildings = list(buildings)
        shapes = []
        for building in self.buildings:
            shape = polygon_to_local(projection, building.geom)
            shapes.append(shape if shape.is_valid else make_valid(shape))
        self.shapes = shapes
        self.tree = STRtree(shapes) if shapes else None

    def _indices(self, geometry) -> list[int]:
        if self.tree is None:
            return []
        return sorted(int(index) for index in self.tree.query(geometry, predicate="intersects"))

    def within(self, centre: Point, meters: float):
        """The footprints (as WGS84 rings) of the buildings within `meters` of `centre`."""
        return [self.buildings[index].geom for index in self._indices(centre.buffer(meters))]

    def around(self, shape, meters: float = 2.0):
        """The buildings, in local metres, within `meters` of a block's outline (its own, and those
        straddling or next to it)."""
        return [self.shapes[index] for index in self._indices(shape.buffer(meters))]


class _ReferenceMatcher:
    """Finds the exemplar a block should learn from, among this area's own exemplars and those of
    the other completed areas within 500 m."""

    def __init__(
        self,
        session: Session,
        area: ImportArea,
        projection: LocalProjection,
        eligible: Sequence[Block],
        suitabilities: dict[uuid.UUID, Suitability],
        road_groups: dict,
        centres: dict,
        by_block: dict[uuid.UUID, list[Building]],
    ):
        self.session = session
        self.area = area
        self.projection = projection
        self.blocks = BlockRepository(session)
        self.suitabilities = suitabilities
        self.road_groups = road_groups
        self.centres = centres
        self.own_exemplars: dict[uuid.UUID, tuple[Fingerprint, MatchProfile]] = {}
        for block in eligible:
            measurement = measure_block(block, by_block.get(block.id, []), projection)
            if measurement is None or not qualifies_as_exemplar(
                BlockEligibility.ELIGIBLE, measurement.coverage, len(measurement.measures)
            ):
                continue
            style = suitabilities[block.id].style
            self.own_exemplars[block.id] = (
                fingerprint_of(measurement.measures, measurement.side_gaps, measurement.coverage, style),
                MatchProfile(road_groups[block.id], block.area_square_meters, style),
            )
        self._foreign_buildings: dict[uuid.UUID, dict[uuid.UUID, list[Building]]] = {}
        self._foreign_styles: dict[uuid.UUID, dict] = {}
        self._foreign_exemplars: dict[uuid.UUID, tuple[Fingerprint, MatchProfile] | None] = {}

    def fingerprint_for(self, block: Block) -> tuple[Fingerprint | None, uuid.UUID | None]:
        """The fingerprint to use for `block` and the block it came from; (None, None) means defaults.
        An exemplar references itself."""
        if block.id in self.own_exemplars:
            return self.own_exemplars[block.id][0], block.id

        suit = self.suitabilities[block.id]
        subject = MatchProfile(self.road_groups[block.id], block.area_square_meters, suit.style)
        here = self.centres[block.id]
        candidates = [
            ReferenceCandidate(other_id, here.distance(self.centres[other_id]), profile)
            for other_id, (_, profile) in self.own_exemplars.items()
            if other_id != block.id
        ]
        fingerprints = {other_id: fingerprint for other_id, (fingerprint, _) in self.own_exemplars.items()}

        centre = from_local_xy(self.projection, here.x, here.y)
        for other, distance in self.blocks.blocks_within(centre, REFERENCE_RADIUS_METERS, exclude_area_id=self.area.id):
            exemplar = self._foreign_exemplar(other)
            if exemplar is not None:
                fingerprints[other.id] = exemplar[0]
                candidates.append(ReferenceCandidate(other.id, distance, exemplar[1]))

        best = best_reference(subject, candidates)
        if best is None:
            return None, None
        return fingerprints[best.block_id], best.block_id

    def _foreign_exemplar(self, block: Block) -> tuple[Fingerprint, MatchProfile] | None:
        if block.id in self._foreign_exemplars:
            return self._foreign_exemplars[block.id]
        result = None
        if eligibility(block) is BlockEligibility.ELIGIBLE:
            buildings = self._buildings_of(block.import_area_id).get(block.id, [])
            measurement = measure_block(block, buildings)
            if measurement is not None and qualifies_as_exemplar(
                BlockEligibility.ELIGIBLE, measurement.coverage, len(measurement.measures)
            ):
                style = self._style_of(block)
                group = strongest_road_group(self.blocks.bounding_road_classes(block.id))
                result = (
                    fingerprint_of(measurement.measures, measurement.side_gaps, measurement.coverage, style),
                    MatchProfile(group, block.area_square_meters, style),
                )
        self._foreign_exemplars[block.id] = result
        return result

    def _buildings_of(self, area_id: uuid.UUID) -> dict[uuid.UUID, list[Building]]:
        if area_id not in self._foreign_buildings:
            grouped: dict[uuid.UUID, list[Building]] = {}
            for building in BuildingRepository(self.session).list_for_import_area(area_id):
                if building.block_id is not None:
                    grouped.setdefault(building.block_id, []).append(building)
            self._foreign_buildings[area_id] = grouped
        return self._foreign_buildings[area_id]

    def _style_of(self, block: Block) -> SettlementStyle:
        """Another area's block has no suitability here, so it takes the style its own area's run
        gave it, or `regular` when that area was never generated."""
        if block.import_area_id not in self._foreign_styles:
            run = GenerationRepository(self.session).get_run(block.import_area_id)
            self._foreign_styles[block.import_area_id] = run.assignments() if run is not None else {}
        assignment = self._foreign_styles[block.import_area_id].get(block.id)
        return assignment.style if assignment is not None else SettlementStyle.REGULAR

