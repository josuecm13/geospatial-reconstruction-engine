"""A background import: the work a job runs, and how each stage the ingestion service reports is
mapped to the JSON a client receives.

The service announces a stage once its rows are flushed. The emitter reads them back through the
job's own session (same transaction, so uncommitted rows are visible) and maps them with the same
mappers as `map-data`, so a stage's features look exactly like the finished area's.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from app.api.dependencies import SessionScope
from app.api.errors import describe_error
from app.api.mappers import (
    area_feature_feature,
    block_feature,
    building_feature,
    elevation_out,
    feature_collection,
    generated_building_feature,
    generation_run_out,
    import_area_out,
    poi_feature,
    projection_out,
    segment_feature,
)
from app.api.place_lookup import Geocoder, name_area
from app.domain.bounding_box import BoundingBox
from app.domain.cross_section import cross_sections_by_segment
from app.domain.import_area import ImportArea
from app.domain.local_projection import local_projection_for
from app.generation.run import GenerationService, stale_reasons
from app.ingestion.elevation_analysis import ElevationAnalysis, ElevationResult
from app.ingestion.elevation_source import ElevationUnavailable, TerrainTilesSource
from app.ingestion.jobs import ImportJob
from app.ingestion.overpass import OverpassClient
from app.ingestion.service import OSMIngestionService
from app.persistence.repositories.area_feature import AreaFeatureRepository
from app.persistence.repositories.block import BlockRepository
from app.persistence.repositories.elevation import ElevationRepository
from app.persistence.repositories.import_area import ImportAreaRepository
from app.persistence.repositories.poi import PointOfInterestRepository
from app.persistence.repositories.road_graph import RoadSegmentRepository

logger = logging.getLogger(__name__)

PROVIDER = "osm"


class StageEmitter:
    """Maps the service's `emit(stage, **info)` calls onto the job's events."""

    def __init__(self, session, area: ImportArea, job: ImportJob):
        self.session = session
        self.area_id = area.id
        self.job = job
        self.projection = projection_out(local_projection_for(area.bbox.ring())).model_dump(mode="json")

    def __call__(self, stage: str, **info: Any) -> None:
        data = {"projection": self.projection, **self._layers(stage, info)}
        self.job.emit(stage, data)

    def _layers(self, stage: str, info: dict[str, Any]) -> dict[str, Any]:
        if stage == "fetched":
            # The inner areas are already built, so a client can show them before anything else.
            return {
                "element_count": info["element_count"],
                "inner_area_ids": [str(inner_id) for inner_id in info.get("inner_area_ids", ())],
            }
        if stage == "ground":
            area_features = AreaFeatureRepository(self.session).list_for_import_area(self.area_id)
            pois = PointOfInterestRepository(self.session).list_for_import_area(self.area_id)
            return {
                "area_features": _dump(feature_collection([area_feature_feature(f) for f in area_features])),
                "pois": _dump(feature_collection([poi_feature(p) for p in pois])),
            }
        if stage == "roads":
            segments = RoadSegmentRepository(self.session).list_for_import_area_with_street(self.area_id)
            cross_sections = cross_sections_by_segment(segments)
            features = [segment_feature(entry, cross_sections[entry.segment.id]) for entry in segments]
            return {"road_segments": _dump(feature_collection(features))}
        if stage == "blocks":
            blocks = BlockRepository(self.session).list_for_import_area(self.area_id)
            return {"blocks": _dump(feature_collection([block_feature(b) for b in blocks]))}
        if stage == "buildings":
            features = [building_feature(b) for b in info["buildings"]]
            return {"ring": info["ring"], "buildings": _dump(feature_collection(features))}
        raise ValueError(f"unknown import stage {stage!r}")


def _dump(model) -> dict[str, Any]:
    return model.model_dump(mode="json")


def analyse_elevation(session, area: ImportArea, source: TerrainTilesSource | None) -> ElevationResult | None:
    """Analyses and commits the area's elevation. The caller's import is already committed, so
    this is isolated from it: the terrain is fetched before anything is written, and on
    `ElevationUnavailable` the session is rolled back (undoing nothing but this step) and the
    exception propagates for the caller to report. None when elevation is disabled."""
    if source is None:
        return None
    try:
        result = ElevationAnalysis(session, source).analyse(area)
        session.commit()
    except Exception:
        session.rollback()
        raise
    return result


def elevation_stage_data(session, area: ImportArea, source: TerrainTilesSource | None, projection: dict) -> dict[str, Any]:
    """The `elevation` stage of an import. A source failure doesn't fail the import: the stage
    reports `elevation: null` and the error code, and the area can be re-analysed later."""
    error = None
    try:
        analyse_elevation(session, area, source)
    except ElevationUnavailable as exc:
        logger.warning("elevation for area %s unavailable, the import completes flat: %s", area.id, exc)
        error = "elevation_unavailable"
    except Exception:
        # Elevation never fails an import: whatever went wrong, the committed import stands.
        logger.exception("elevation for area %s failed unexpectedly, the import completes flat", area.id)
        error = "elevation_failed"
    elevation = elevation_out(ElevationRepository(session).get_grid(area.id)) if error is None else None
    return {"projection": projection, "elevation": elevation, "error": error}


def elevation_work(
    area: ImportArea, source: TerrainTilesSource, session_scope: SessionScope
) -> Callable[[ImportJob], None]:
    """The job body of a re-analysis: it fetches no OSM data and changes no entity. Emits
    `elevation`, then `completed` with the version and whether the stored grid changed, or
    `failed` (rolled back) with the error's code."""

    def work(job: ImportJob) -> None:
        with session_scope() as session:
            try:
                result = analyse_elevation(session, area, source)
                projection = projection_out(local_projection_for(area.bbox.ring())).model_dump(mode="json")
                elevation = elevation_out(ElevationRepository(session).get_grid(area.id))
                job.emit("elevation", {"projection": projection, "elevation": elevation, "error": None})
                job.emit(
                    "completed",
                    {"import_area_id": str(area.id), "version": result.version, "changed": result.changed},
                )
            except Exception as exc:
                session.rollback()
                _, code, message, details = describe_error(exc)
                if code == "internal_error":
                    logger.exception("elevation analysis of area %s failed unexpectedly", area.id)
                job.emit("failed", {"code": code, "message": message, "details": details})

    return work


MAX_BUILDINGS_PER_EVENT = 500


def chunks(items: list, size: int = MAX_BUILDINGS_PER_EVENT) -> list[list]:
    """`items` in slices of at most `size`; an empty list is one empty slice, so a ring with no
    buildings still announces itself."""
    return [items[start : start + size] for start in range(0, len(items), size)] or [[]]


def generation_work(area: ImportArea, seed: int, session_scope: SessionScope) -> Callable[[ImportJob], None]:
    """The job body of a generation: it reads the observed data and replaces the area's run in one
    transaction. Emits `generation` with the number of eligible blocks, then a `generated` event per
    ring of blocks (nearest the area's centre first; a ring of more than 500 buildings is split over
    several events with the same `ring`) carrying the buildings generated so far in that ring and
    `blocks_done`, then `completed` with the new run, or `failed` with the error's code.

    The streamed buildings are provisional: nothing is stored until the run is, at the end. On
    `failed` the transaction rolls back, the previous run stays, and a client must discard what it
    streamed. On `completed` the streamed ids are the stored ids, so they agree with map data."""

    def work(job: ImportJob) -> None:
        with session_scope() as session:
            try:
                projection = projection_out(local_projection_for(area.bbox.ring())).model_dump(mode="json")

                def on_ring(ring: int, blocks_done: int, block_count: int, buildings: list) -> None:
                    for batch in chunks(buildings):
                        collection = feature_collection([generated_building_feature(b) for b in batch])
                        job.emit(
                            "generated",
                            {
                                "projection": projection,
                                "ring": ring,
                                "blocks_done": blocks_done,
                                "block_count": block_count,
                                "buildings": _dump(collection),
                            },
                        )

                run = GenerationService(session).generate(
                    area,
                    seed,
                    progress=lambda block_count: job.emit("generation", {"block_count": block_count}),
                    on_ring=on_ring,
                )
                session.commit()
                run_out = generation_run_out(run, stale_reasons(session, area, run))
                job.emit("completed", {"run": _dump(run_out)})
            except Exception as exc:
                session.rollback()
                _, code, message, details = describe_error(exc)
                if code == "internal_error":
                    logger.exception("generation for area %s failed unexpectedly", area.id)
                job.emit("failed", {"code": code, "message": message, "details": details})

    return work


def background_import_work(
    bbox: BoundingBox,
    payload: dict | None,
    overpass: OverpassClient,
    session_scope: SessionScope,
    geocoder: Geocoder | None = None,
    elevation_source: TerrainTilesSource | None = None,
) -> Callable[[ImportJob], None]:
    """The job body: fetch (when no payload was posted), then import in stages in one transaction.

    Ends the job with `completed` or `failed`. A failure rolls the job's session back and does not
    mark the area failed, so its status, counts and data stay exactly as they were.
    """

    def work(job: ImportJob) -> None:
        with session_scope() as session:
            try:
                source = payload if payload is not None else overpass.fetch(bbox)
                area = ImportAreaRepository(session).get_or_create(PROVIDER, bbox)
                result = OSMIngestionService(session).import_staged(bbox, source, StageEmitter(session, area, job), provider=PROVIDER)
                named = name_area(ImportAreaRepository(session), result.import_area, geocoder)
                # The import committed before the lookup; without this the name is dropped when the session closes.
                session.commit()
                projection = projection_out(local_projection_for(named.bbox.ring())).model_dump(mode="json")
                job.emit("elevation", elevation_stage_data(session, named, elevation_source, projection))
                completed = import_area_out(
                    named, result.block_count, result.linked_building_count, result.skipped_restriction_count,
                    result.skipped_feature_count,
                )
                job.emit("completed", _dump(completed))
            except Exception as exc:
                session.rollback()
                _, code, message, details = describe_error(exc)
                if code == "internal_error":
                    logger.exception("background import of area %s failed unexpectedly", job.area_id)
                job.emit("failed", {"code": code, "message": message, "details": details})

    return work
