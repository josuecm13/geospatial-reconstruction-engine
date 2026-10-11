import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.domain.enums import SceneTheme, TimeOfDay
from app.persistence.models import SiteSettingModel

FEATURED_AREA_KEY = "featured_area_id"
LANDING_THEME_KEY = "landing_theme"


class SiteSettingsRepository:
    """Key/value settings for the whole deployment. The caller commits."""

    def __init__(self, session: Session):
        self.session = session

    def get(self, key: str) -> Any | None:
        model = self.session.get(SiteSettingModel, key)
        return model.value if model is not None else None

    def set(self, key: str, value: Any) -> None:
        model = self.session.get(SiteSettingModel, key)
        if model is None:
            self.session.add(SiteSettingModel(key=key, value=value))
        else:
            model.value = value
        self.session.flush()

    def delete(self, key: str) -> None:
        model = self.session.get(SiteSettingModel, key)
        if model is not None:
            self.session.delete(model)
            self.session.flush()

    def featured_area_id(self) -> uuid.UUID | None:
        value = self.get(FEATURED_AREA_KEY)
        return uuid.UUID(value) if value else None

    def set_featured_area_id(self, import_area_id: uuid.UUID | None) -> None:
        """Null clears the setting."""
        if import_area_id is None:
            self.delete(FEATURED_AREA_KEY)
        else:
            self.set(FEATURED_AREA_KEY, str(import_area_id))

    def clear_featured_area_if(self, import_area_id: uuid.UUID) -> None:
        """For deleting an area: clears the setting only when it names this area."""
        if self.featured_area_id() == import_area_id:
            self.delete(FEATURED_AREA_KEY)

    def landing_theme(self) -> tuple[SceneTheme, TimeOfDay] | None:
        value = self.get(LANDING_THEME_KEY)
        if not value:
            return None
        return SceneTheme(value["theme"]), TimeOfDay(value["time_of_day"])

    def set_landing_theme(self, value: tuple[SceneTheme, TimeOfDay] | None) -> None:
        """Null clears the setting."""
        if value is None:
            self.delete(LANDING_THEME_KEY)
        else:
            theme, time_of_day = value
            self.set(LANDING_THEME_KEY, {"theme": theme.value, "time_of_day": time_of_day.value})
