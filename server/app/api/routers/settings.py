"""Site settings: which import area the landing page features."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.api.errors import ApiError
from app.domain.enums import ImportStatus
from app.persistence.repositories.import_area import ImportAreaRepository
from app.persistence.repositories.site_settings import SiteSettingsRepository

router = APIRouter(tags=["settings"])


class FeaturedAreaBody(BaseModel):
    # Required but nullable: null clears the setting.
    import_area_id: uuid.UUID | None


@router.get("/settings/featured-area", response_model=FeaturedAreaBody)
def get_featured_area(session: Session = Depends(get_session)) -> FeaturedAreaBody:
    return FeaturedAreaBody(import_area_id=SiteSettingsRepository(session).featured_area_id())


@router.put("/settings/featured-area", response_model=FeaturedAreaBody)
def put_featured_area(body: FeaturedAreaBody, session: Session = Depends(get_session)) -> FeaturedAreaBody:
    if body.import_area_id is not None:
        area = ImportAreaRepository(session).get(body.import_area_id)
        if area is None:
            raise ApiError(404, "import_area_not_found", f"import area {body.import_area_id} not found")
        if area.status is not ImportStatus.COMPLETED:
            raise ApiError(
                409,
                "import_area_not_ready",
                f"import area {area.id} is not ready (status={area.status.value})",
            )
    SiteSettingsRepository(session).set_featured_area_id(body.import_area_id)
    session.commit()
    return FeaturedAreaBody(import_area_id=body.import_area_id)
