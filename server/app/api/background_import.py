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
    feature_collection,
    import_area_out,
    poi_feature,
    projection_out,
    segment_feature,
)
from app.domain.bounding_box import BoundingBox
from app.domain.cross_section import cross_sections_by_segment
from app.domain.import_area import ImportArea
from app.domain.local_projection import local_projection_for
from app.ingestion.jobs import ImportJob
from app.ingestion.overpass import OverpassClient
from app.ingestion.service import OSMIngestionService
from app.persistence.repositories.area_feature import AreaFeatureRepository
from app.persistence.repositories.block import BlockRepository
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
            return {"element_count": info["element_count"]}
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


def background_import_work(
    bbox: BoundingBox,
    payload: dict | None,
    overpass: OverpassClient,
    session_scope: SessionScope,
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
                completed = import_area_out(
                    result.import_area, result.block_count, result.linked_building_count, result.skipped_restriction_count
                )
                job.emit("completed", _dump(completed))
            except Exception as exc:
                session.rollback()
                _, code, message, details = describe_error(exc)
                if code == "internal_error":
                    logger.exception("background import of area %s failed unexpectedly", job.area_id)
                job.emit("failed", {"code": code, "message": message, "details": details})

    return work
