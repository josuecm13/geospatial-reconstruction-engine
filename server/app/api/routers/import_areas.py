"""Import-area endpoints (design.md Decision 8): import, status/count lookup,
and map data for the whole area or one traced boundary (Milestone 8)."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Header, Query, Response
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.background_import import PROVIDER, analyse_elevation, background_import_work, elevation_work
from app.api.dependencies import (
    SessionScope,
    completed_import_area,
    composed_import_area_ids,
    get_elevation_source,
    get_geocoder,
    get_import_jobs,
    get_job_session_scope,
    get_overpass_client,
    get_session,
    import_area as import_area_dependency,
    scope_boundary,
)
from app.api.errors import ApiError
from app.api.place_lookup import Geocoder, name_area
from app.api.mappers import (
    area_feature_feature,
    block_feature,
    building_feature,
    elevation_out,
    block_generation_properties,
    feature_collection,
    generated_building_feature,
    generation_run_out,
    generation_zone_feature,
    import_area_out,
    node_feature,
    poi_feature,
    projection_out,
    segment_feature,
)
from app.api.schemas import (
    ExportMode,
    Feature,
    ImportAreaCreate,
    ImportAreaListOut,
    ImportAreaOut,
    ImportStartedOut,
    MapDataOut,
    ScopeOut,
    ScopeType,
)
from app.domain.bounding_box import BoundingBox, Coordinate
from app.domain.covered_areas import compose_by_source_id
from app.domain.cross_section import cross_sections_by_segment
from app.domain.elevation import StoredGrid, smoothed
from app.domain.enums import ImportStatus
from app.domain.generation import eligibility
from app.domain.import_area import ImportArea
from app.domain.local_projection import local_projection_for
from app.domain.traced_boundary import TracedBoundary
from app.generation.run import stale_reasons
from app.ingestion.elevation_source import ElevationUnavailable, TerrainTilesSource
from app.ingestion.jobs import ImportAlreadyRunning, ImportJob, ImportJobRegistry
from app.ingestion.overpass import IncompleteSourceResponse, OverpassClient
from app.ingestion.service import OSMIngestionService
from app.persistence.map_scope import ClippedGeometries, clip_to_scope, ids_intersecting_boundary
from app.persistence.repositories.area_feature import AreaFeatureRepository
from app.persistence.repositories.block import BlockRepository
from app.persistence.repositories.building import BuildingRepository
from app.persistence.repositories.elevation import ElevationRepository
from app.persistence.repositories.generation import BlockFeedbackRepository, GenerationRepository
from app.persistence.repositories.import_area import ImportAreaRepository
from app.persistence.repositories.poi import PointOfInterestRepository
from app.persistence.repositories.road_graph import NavigableNodeRepository, RoadSegmentRepository

router = APIRouter(tags=["import-areas"])
logger = logging.getLogger(__name__)


KEEP_ALIVE_SECONDS = 15.0
POLL_SECONDS = 0.25


def _import_in_progress(area_id) -> ApiError:
    return ApiError(
        409,
        "import_in_progress",
        f"an import of area {area_id} is already running",
        {"import_area_id": str(area_id), "events_url": f"/import-areas/{area_id}/events"},
    )


@router.post(
    "/import-areas",
    response_model=ImportAreaOut,
    responses={202: {"model": ImportStartedOut, "description": "`background: true`: the import started; follow `events_url`."}},
)
def create_import_area(
    body: ImportAreaCreate,
    session: Session = Depends(get_session),
    overpass: OverpassClient = Depends(get_overpass_client),
    jobs: ImportJobRegistry = Depends(get_import_jobs),
    session_scope: SessionScope = Depends(get_job_session_scope),
    geocoder: Geocoder | None = Depends(get_geocoder),
    elevation_source: TerrainTilesSource | None = Depends(get_elevation_source),
) -> ImportAreaOut | JSONResponse:
    bbox = BoundingBox(
        min_corner=Coordinate(body.bbox.min_latitude, body.bbox.min_longitude),
        max_corner=Coordinate(body.bbox.max_latitude, body.bbox.max_longitude),
    )
    areas = ImportAreaRepository(session)
    existing = areas.find(PROVIDER, bbox)
    if existing is not None and jobs.is_running(existing.id):
        raise _import_in_progress(existing.id)
    if body.background:
        return _start_background_import(body, bbox, session, overpass, jobs, session_scope, geocoder, elevation_source)
    payload = body.payload
    if payload is None:
        try:
            payload = overpass.fetch(bbox)
        except IncompleteSourceResponse as exc:
            # The source's fault, not the caller's: nothing was changed, and retrying may succeed.
            raise ApiError(502, "source_incomplete", str(exc)) from exc
    try:
        # Provider is always "osm": only the OSM adapter exists, and a
        # free-form provider string from the client would silently fork
        # import-area identity (design.md Decision 3).
        result = OSMIngestionService(session).import_fixture(bbox, payload, provider=PROVIDER)
    except IntegrityError as exc:
        session.rollback()
        raise ApiError(
            409, "import_conflict", "a concurrent request already created this import area"
        ) from exc
    named = name_area(areas, result.import_area, geocoder)
    # The import committed before the lookup; the name needs its own commit or the session's close drops it.
    session.commit()
    try:
        analyse_elevation(session, named, elevation_source)
    except ElevationUnavailable as exc:
        logger.warning("elevation for area %s unavailable, the import stays flat: %s", named.id, exc)
    except Exception:
        # Elevation never fails an import; analyse_elevation already rolled back its own work.
        logger.exception("elevation for area %s failed unexpectedly, the import stays flat", named.id)
    return import_area_out(
        named, result.block_count, result.linked_building_count, result.skipped_restriction_count,
        result.skipped_feature_count,
    )


def _start_background_import(
    body: ImportAreaCreate,
    bbox: BoundingBox,
    session: Session,
    overpass: OverpassClient,
    jobs: ImportJobRegistry,
    session_scope: SessionScope,
    geocoder: Geocoder | None,
    elevation_source: TerrainTilesSource | None,
) -> JSONResponse:
    try:
        area = ImportAreaRepository(session).get_or_create(PROVIDER, bbox)
        # Committed now, so there is an id to return and the job's own session can see the row.
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise ApiError(409, "import_conflict", "a concurrent request already created this import area") from exc
    try:
        jobs.start(area.id, background_import_work(bbox, body.payload, overpass, session_scope, geocoder, elevation_source))
    except ImportAlreadyRunning as exc:
        raise _import_in_progress(area.id) from exc
    started = ImportStartedOut(import_area_id=area.id, events_url=f"/import-areas/{area.id}/events")
    return JSONResponse(status_code=202, content=started.model_dump(mode="json"))


@router.post(
    "/import-areas/{import_area_id}/elevation",
    status_code=202,
    response_model=ImportStartedOut,
)
def reanalyse_elevation(
    area: ImportArea = Depends(completed_import_area),
    jobs: ImportJobRegistry = Depends(get_import_jobs),
    session_scope: SessionScope = Depends(get_job_session_scope),
    elevation_source: TerrainTilesSource | None = Depends(get_elevation_source),
) -> JSONResponse:
    """Re-analyses the area's elevation in the background, with the same events as an import: one
    `elevation`, then `completed` (`version`, `changed`) or `failed`. Fetches no OSM data and
    changes no entity; a second run changes nothing."""
    if elevation_source is None:
        raise ApiError(503, "elevation_unavailable", "elevation is disabled (ELEVATION_URL)")
    try:
        jobs.start(area.id, elevation_work(area, elevation_source, session_scope))
    except ImportAlreadyRunning as exc:
        raise _import_in_progress(area.id) from exc
    started = ImportStartedOut(import_area_id=area.id, events_url=f"/import-areas/{area.id}/events")
    return JSONResponse(status_code=202, content=started.model_dump(mode="json"))


@router.get("/import-areas/{import_area_id}/events")
async def import_events(
    area: ImportArea = Depends(import_area_dependency),
    jobs: ImportJobRegistry = Depends(get_import_jobs),
    last_event_id: str | None = Header(default=None),
) -> StreamingResponse:
    """Server-sent events for the area's background import: one per stage, ending after `completed`
    or `failed`. Replays what the job has published (everything, or what follows `Last-Event-ID`),
    then follows it live. Subscribers never affect the job."""
    job = jobs.get(area.id)
    if job is None:
        raise ApiError(404, "import_job_not_found", f"no background import of area {area.id} is running or recent")
    after = int(last_event_id) if last_event_id and last_event_id.isdigit() else 0
    return StreamingResponse(
        _event_stream(job, after),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _event_stream(job: ImportJob, after: int) -> AsyncIterator[str]:
    idle = 0.0
    while True:
        events, done = job.events_after(after)
        for event in events:
            after = event.id
            idle = 0.0
            yield f"id: {event.id}\nevent: {event.stage}\ndata: {json.dumps(event.data, separators=(',', ':'))}\n\n"
        if done and not events:
            return
        if not events:
            await asyncio.sleep(POLL_SECONDS)
            idle += POLL_SECONDS
            if idle >= KEEP_ALIVE_SECONDS:
                idle = 0.0
                yield ": keep-alive\n\n"


@router.get("/import-areas", response_model=ImportAreaListOut)
def list_import_areas(
    status: ImportStatus | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
) -> ImportAreaListOut:
    """Import areas, most recently imported first, so a client can reopen any of them."""
    rows = ImportAreaRepository(session).list_recent(status=status, limit=limit)
    return ImportAreaListOut(import_areas=[import_area_out(area, block_count) for area, block_count in rows])


@router.get("/import-areas/{import_area_id}", response_model=ImportAreaOut)
def get_import_area(
    area: ImportArea = Depends(import_area_dependency), session: Session = Depends(get_session)
) -> ImportAreaOut:
    block_count = ImportAreaRepository(session).block_count(area.id)
    return import_area_out(area, block_count)


@router.delete("/import-areas/{import_area_id}", status_code=204)
def delete_import_area(
    area: ImportArea = Depends(import_area_dependency),
    session: Session = Depends(get_session),
    jobs: ImportJobRegistry = Depends(get_import_jobs),
) -> Response:
    """Hard-deletes the area and everything derived from it. Refused while its import runs, and
    while a completed or importing area covers it: that area borrows this one's features."""
    if jobs.is_running(area.id):
        raise _import_in_progress(area.id)
    areas = ImportAreaRepository(session)
    covering = areas.areas_covering(area.bbox, exclude_id=area.id)
    if covering:
        names = ", ".join(other.place_name or str(other.id) for other in covering)
        raise ApiError(
            409,
            "import_area_in_use",
            f"import area {area.id} is borrowed from by {len(covering)} larger area(s): {names}",
            {"covering_areas": [{"id": str(other.id), "name": other.place_name} for other in covering]},
        )
    areas.delete(area.id)
    session.commit()
    return Response(status_code=204)


@router.get("/import-areas/{import_area_id}/map-data", response_model=MapDataOut)
def get_map_data(
    mode: ExportMode = Query(ExportMode.FILTER),
    scope: TracedBoundary | None = Depends(scope_boundary),
    area: ImportArea = Depends(completed_import_area),
    composed_area_ids: list[uuid.UUID] = Depends(composed_import_area_ids),
    session: Session = Depends(get_session),
) -> MapDataOut:
    """Filter mode returns whole entities that intersect the scope. Segments keep their full
    geometry, and the nodes they end at are always included, so the result stays routable.
    Clip mode cuts every geometry at the scope (the boundary, or the bounding box), which is a
    picture: distances and areas still describe the whole entity.

    The area composes the completed areas inside its rectangle: their buildings, POIs, area
    features, and whole blocks join its own, each feature naming its `import_area_id`, so the
    response is one complete place. Where both hold a feature, the area's own copy wins."""
    segments = RoadSegmentRepository(session).list_for_import_area_with_street(area.id)
    # Cross-sections read the whole area (a direction is inferred from a road's reverse
    # twin), so they are computed before the scope narrows the segments.
    cross_sections = cross_sections_by_segment(segments)
    nodes = NavigableNodeRepository(session).list_for_import_area(area.id)
    owner_ids = [area.id, *composed_area_ids]
    block_repository = BlockRepository(session)
    blocks = [
        *block_repository.list_for_import_area(area.id),
        *block_repository.list_composable(composed_area_ids, area.id),
    ]
    buildings = _composed(BuildingRepository(session), owner_ids)
    pois = _composed(PointOfInterestRepository(session), owner_ids)
    area_features = _composed(AreaFeatureRepository(session), owner_ids)

    # Generated content. Block properties count against everything the area composes, before the
    # scope narrows the layers; the layers are narrowed with the others below.
    generations = GenerationRepository(session)
    runs = {owner_id: generations.get_run(owner_id) for owner_id in owner_ids}
    own_run = runs[area.id]
    block_ids = {block.id for block in blocks}
    # An inner area's run may have built on a block the outer area holds whole instead: that block
    # is not composed, and the outer area's own run covers it.
    generated = [building for building in generations.list_buildings(owner_ids) if building.block_id in block_ids]
    zones = generations.list_zones(area.id)
    block_extras = _block_generation_properties(session, blocks, buildings, generated, runs, generations, owner_ids)
    generation_out = (
        generation_run_out(own_run, stale_reasons(session, area, own_run)) if own_run is not None else None
    )

    if scope is None:
        scope_out = ScopeOut(type=ScopeType.IMPORT_AREA, id=area.id, composed_area_ids=composed_area_ids)
        projection = local_projection_for(area.bbox.ring())
    else:
        scope_out = ScopeOut(type=ScopeType.BOUNDARY, id=scope.id, composed_area_ids=composed_area_ids)
        projection = local_projection_for(scope.polygon)
        in_scope = ids_intersecting_boundary(session, area.id, scope.id, composed_area_ids)
        segments = [entry for entry in segments if entry.segment.id in in_scope.road_segments]
        endpoint_ids = {node_id for entry in segments for node_id in (entry.segment.from_node_id, entry.segment.to_node_id)}
        nodes = [node for node in nodes if node.id in in_scope.navigable_nodes or node.id in endpoint_ids]
        blocks = [block for block in blocks if block.id in in_scope.blocks]
        buildings = [building for building in buildings if building.id in in_scope.buildings]
        pois = [poi for poi in pois if poi.id in in_scope.pois]
        area_features = [feature for feature in area_features if feature.id in in_scope.area_features]
        generated = [building for building in generated if building.id in in_scope.generated_buildings]
        zones = [zone for zone in zones if zone.id in in_scope.generation_zones]

    elevations = ElevationRepository(session)
    stored_grid = elevations.get_grid(area.id)
    base_elevations: dict = {}
    for owner_id in owner_ids:
        base_elevations.update(elevations.building_bases(owner_id))
    segment_heights = elevations.segment_heights(area.id)

    layers = {
        "road_segments": [
            segment_feature(entry, cross_sections[entry.segment.id], segment_heights.get(entry.segment.id))
            for entry in segments
        ],
        "navigable_nodes": [node_feature(node) for node in nodes],
        "blocks": [block_feature(block, block_extras[block.id]) for block in blocks],
        "buildings": [building_feature(building, base_elevations.get(building.id)) for building in buildings],
        "pois": [poi_feature(poi) for poi in pois],
        "area_features": [area_feature_feature(feature) for feature in area_features],
        "generated_buildings": [generated_building_feature(building) for building in generated],
        "generation_zones": [generation_zone_feature(zone) for zone in zones],
    }
    if mode is ExportMode.CLIP:
        layers = _clipped(layers, clip_to_scope(session, area.id, scope.id if scope else None, composed_area_ids))
        if stored_grid is not None:
            layers["road_segments"] = _resampled(layers["road_segments"], stored_grid)

    return MapDataOut(
        scope=scope_out,
        mode=mode,
        projection=projection_out(projection),
        elevation=elevation_out(stored_grid),
        generation=generation_out,
        **{name: feature_collection(features) for name, features in layers.items()},
    )


def _block_generation_properties(
    session: Session,
    blocks: list,
    buildings: list,
    generated: list,
    runs: dict,
    generations: GenerationRepository,
    owner_ids: list,
) -> dict:
    """Per block, the generation properties of its feature: its eligibility, its real and generated
    building counts, whether it was a reference in its area's current run and which block it learned
    from, its style (null without a run), and its feedback."""
    real_counts: dict = {}
    for building in buildings:
        if building.block_id is not None:
            real_counts[building.block_id] = real_counts.get(building.block_id, 0) + 1
    generated_counts: dict = {}
    for building in generated:
        generated_counts[building.block_id] = generated_counts.get(building.block_id, 0) + 1
    assignments: dict = {}
    reference_ids: set = set()
    for run in runs.values():
        if run is not None:
            assignments.update(run.assignments())
            reference_ids.update(generations.fingerprints(run.id))
    feedback = {}
    for owner_id in owner_ids:
        for entry in BlockFeedbackRepository(session).list_for_import_area(owner_id):
            feedback[entry.feedback.block_id] = entry.feedback

    properties = {}
    for block in blocks:
        assignment = assignments.get(block.id)
        properties[block.id] = block_generation_properties(
            eligibility=eligibility(block).value,
            real_building_count=real_counts.get(block.id, 0),
            generated_building_count=generated_counts.get(block.id, 0),
            is_reference=block.id in reference_ids,
            reference_block_id=assignment.reference_block_id if assignment is not None else None,
            style=assignment.style.value if assignment is not None else None,
            feedback=feedback.get(block.id),
        )
    return properties


def _composed(repository, owner_ids: list) -> list:
    """One layer from the area's own features and then its inner areas', each source id once."""
    return compose_by_source_id(
        (repository.list_for_import_area(owner_id) for owner_id in owner_ids), lambda feature: feature.source_id
    )


def _clipped(layers: dict[str, list[Feature]], clipped: ClippedGeometries) -> dict[str, list[Feature]]:
    """Swaps in each feature's clipped geometry, dropping features with nothing left inside."""
    result = {}
    for name, features in layers.items():
        geometries = getattr(clipped, name)
        result[name] = [
            feature.model_copy(update={"geometry": geometries[feature.id]})
            for feature in features
            if feature.id in geometries
        ]
    for block in result["blocks"]:
        block.properties = {**block.properties, "buildable_area": clipped.block_buildable_areas.get(block.id)}
    return result


def _vertices(geometry: dict) -> list[Coordinate]:
    """A (Multi)LineString's vertices in order, the parts of a MultiLineString flattened."""
    lines = [geometry["coordinates"]] if geometry["type"] == "LineString" else geometry["coordinates"]
    return [Coordinate(latitude=lat, longitude=lon) for line in lines for lon, lat in line]


def _resampled(segments: list[Feature], stored: StoredGrid) -> list[Feature]:
    """Clipping cuts a segment's geometry, so its stored vertex heights no longer line up: sample
    the exact grid and the smoothed grid again at the clipped vertices."""
    smooth = smoothed(stored.grid, stored.smoothing_meters)
    result = []
    for feature in segments:
        vertices = _vertices(feature.geometry)
        properties = {
            **feature.properties,
            "elevation_exact": [stored.grid.sample(vertex) for vertex in vertices],
            "elevation_smoothed": [smooth.sample(vertex) for vertex in vertices],
        }
        result.append(feature.model_copy(update={"properties": properties}))
    return result
