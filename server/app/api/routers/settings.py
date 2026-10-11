"""Site settings: which import area the landing page features, and the theme it is drawn in."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.api.errors import ApiError
from app.domain.enums import ImportStatus, SceneTheme, TimeOfDay
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


class LandingTheme(BaseModel):
    theme: SceneTheme
    time_of_day: TimeOfDay


class LandingThemeBody(BaseModel):
    # Required but nullable: null clears the setting. An unknown theme or time fails validation (422 invalid_request).
    landing_theme: LandingTheme | None


@router.get("/settings/landing-theme", response_model=LandingThemeBody)
def get_landing_theme(session: Session = Depends(get_session)) -> LandingThemeBody:
    stored = SiteSettingsRepository(session).landing_theme()
    return LandingThemeBody(landing_theme=LandingTheme(theme=stored[0], time_of_day=stored[1]) if stored else None)


@router.put("/settings/landing-theme", response_model=LandingThemeBody)
def put_landing_theme(body: LandingThemeBody, session: Session = Depends(get_session)) -> LandingThemeBody:
    chosen = body.landing_theme
    SiteSettingsRepository(session).set_landing_theme(None if chosen is None else (chosen.theme, chosen.time_of_day))
    session.commit()
    return body
