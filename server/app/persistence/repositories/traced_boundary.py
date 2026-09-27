import uuid

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain.geometry import Polygon
from app.domain.import_area import ImportArea
from app.domain.traced_boundary import TracedBoundary, validate_traced_boundary
from app.persistence.geometry import geom_to_polygon, polygon_to_geom
from app.persistence.models import TracedBoundaryModel

_UNIQUE_NAME_CONSTRAINT = "uq_traced_boundaries_import_area_name"


class DuplicateTracedBoundaryName(ValueError):
    """Raised when an import area already has a boundary with the requested name."""


class TracedBoundaryRepository:
    def __init__(self, session: Session):
        self.session = session

    def create(self, import_area: ImportArea, name: str, polygon: Polygon) -> TracedBoundary:
        """Validates before writing, so a bad shape is reported by rule (`InvalidTracedBoundary`)
        rather than by the database's CHECK constraint or containment trigger."""
        name = validate_traced_boundary(name, polygon, import_area.bbox)
        model = TracedBoundaryModel(import_area_id=import_area.id, name=name, geom=polygon_to_geom(polygon))
        try:
            # A savepoint, so a duplicate name rolls back only this insert.
            with self.session.begin_nested():
                self.session.add(model)
                self.session.flush()
        except IntegrityError as exc:
            if _UNIQUE_NAME_CONSTRAINT in str(exc.orig):
                raise DuplicateTracedBoundaryName(
                    f"import area {import_area.id} already has a boundary named {name!r}"
                ) from exc
            raise
        return self._to_domain(model)

    def get(self, boundary_id: uuid.UUID) -> TracedBoundary | None:
        model = self.session.get(TracedBoundaryModel, boundary_id)
        return self._to_domain(model) if model is not None else None

    def list_for_import_area(self, import_area_id: uuid.UUID) -> list[TracedBoundary]:
        models = self.session.execute(
            select(TracedBoundaryModel)
            .where(TracedBoundaryModel.import_area_id == import_area_id)
            .order_by(TracedBoundaryModel.name)
        ).scalars().all()
        return [self._to_domain(model) for model in models]

    def delete(self, boundary_id: uuid.UUID) -> bool:
        result = self.session.execute(delete(TracedBoundaryModel).where(TracedBoundaryModel.id == boundary_id))
        return result.rowcount > 0

    @staticmethod
    def _to_domain(model: TracedBoundaryModel) -> TracedBoundary:
        return TracedBoundary(
            id=model.id,
            import_area_id=model.import_area_id,
            name=model.name,
            polygon=geom_to_polygon(model.geom),
            created_at=model.created_at,
        )
