"""Gives completed import areas their elevation: the terrain grid, building bases, and road heights.

Run from `server/` against the dev database (see HOW_TO_RUN.md):

    set -a; . ./.env; set +a
    PYTHONPATH=. python scripts/backfill_elevation.py          # areas without a grid
    PYTHONPATH=. python scripts/backfill_elevation.py --all    # re-analyse every completed area

Honours `ELEVATION_URL` like the app. It fetches no OSM data and changes no entity id or geometry,
and running it twice changes nothing. One area at a time, committed per area; a failed area is
reported and the rest still run.
"""

import argparse
import sys

from sqlalchemy.orm import Session

from app.api.dependencies import get_elevation_source
from app.config.database import make_engine
from app.config.logging import configure_logging
from app.config.settings import load_settings
from app.ingestion.elevation_analysis import ElevationAnalysis
from app.persistence.repositories.import_area import ImportAreaRepository


def backfill(session: Session, source, areas, report=print) -> tuple[int, int, int]:
    """Analyses each area, committing per area. Returns (changed, unchanged, failed)."""
    changed = unchanged = failed = 0
    for area in areas:
        try:
            result = ElevationAnalysis(session, source).analyse(area)
            session.commit()
        except Exception as exc:
            session.rollback()
            failed += 1
            report(f"{area.id}: failed ({type(exc).__name__}: {exc})")
            continue
        if result.changed:
            changed += 1
        else:
            unchanged += 1
        report(f"{area.id}: version {result.version}, {'changed' if result.changed else 'unchanged'}")
    report(f"{changed} changed, {unchanged} unchanged, {failed} failed")
    return changed, unchanged, failed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--all", action="store_true", help="re-analyse every completed area, not only those without a grid")
    arguments = parser.parse_args()
    configure_logging()
    source = get_elevation_source()
    if source is None:
        print("ELEVATION_URL disables elevation; nothing to do")
        return 0
    engine = make_engine(load_settings())
    with Session(engine) as session:
        areas = ImportAreaRepository(session).list_completed(without_elevation=not arguments.all)
        print(f"{len(areas)} completed import areas to analyse")
        _, _, failed = backfill(session, source, areas)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
