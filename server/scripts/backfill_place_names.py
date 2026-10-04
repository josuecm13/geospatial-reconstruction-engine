"""Names the import areas that have no place name yet, by reverse geocoding each box's centre.

Run from `server/` against the dev database (see HOW_TO_RUN.md):

    set -a; . ./.env; set +a
    PYTHONPATH=. python scripts/backfill_place_names.py

Honours `GEOCODER_URL` like the app. Waits at least a second between requests, as Nominatim's
usage policy asks.
"""

import time

from sqlalchemy.orm import Session

from app.api.dependencies import get_geocoder
from app.api.place_lookup import bbox_center
from app.config.database import make_engine
from app.config.logging import configure_logging
from app.config.settings import load_settings
from app.persistence.repositories.import_area import ImportAreaRepository

PAUSE_SECONDS = 1.1


def main() -> None:
    configure_logging()
    geocoder = get_geocoder()
    if geocoder is None:
        print("GEOCODER_URL disables lookups; nothing to do")
        return
    engine = make_engine(load_settings())
    with Session(engine) as session:
        areas = ImportAreaRepository(session)
        pending = areas.list_without_place()
        print(f"{len(pending)} import areas without a place name")
        for index, area in enumerate(pending):
            if index:
                time.sleep(PAUSE_SECONDS)
            name, context = geocoder.reverse(*bbox_center(area.bbox))
            if name is None and context is None:
                print(f"{area.id}: no name found")
                continue
            areas.set_place(area.id, name, context)
            session.commit()
            print(f"{area.id}: {name} ({context})")


if __name__ == "__main__":
    main()
