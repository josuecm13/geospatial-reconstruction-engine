"""Times each step of an import on a 1 km² city payload, then rolls everything back.

Run from `server/` against the dev database (see HOW_TO_RUN.md):

    set -a; . ./.env; set +a
    PYTHONPATH=. python scripts/benchmark_import.py [payload.json.gz]

The payload is recorded Overpass output for Berlin Mitte, committed under
`tests/fixtures/overpass/`. The import runs under provider "benchmark", inside an outer
transaction that is rolled back, so no area, road or block it creates is kept. It is a
measurement, not a test: CI doesn't run it.
"""

import gzip
import json
import sys
import time
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy.orm import Session

from app.config.database import make_engine
from app.config.logging import configure_logging
from app.config.settings import load_settings
from app.domain.bounding_box import BoundingBox, Coordinate
from app.ingestion.service import OSMIngestionService

DEFAULT_PAYLOAD = Path(__file__).resolve().parent.parent / "tests/fixtures/overpass/berlin_mitte_1km2.json.gz"
# The bounding box the payload was fetched for.
MITTE = BoundingBox(Coordinate(52.526332, 13.3930821), Coordinate(52.5344644, 13.4090037))


def main() -> None:
    configure_logging()
    payload_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PAYLOAD
    with gzip.open(payload_path, "rt") as payload_file:
        payload = json.load(payload_file)

    timings: dict[str, float] = {}

    @contextmanager
    def step_timer(step: str):
        started = time.perf_counter()
        try:
            yield
        finally:
            timings[step] = timings.get(step, 0.0) + time.perf_counter() - started

    engine = make_engine(load_settings())
    with engine.connect() as connection:
        outer = connection.begin()
        try:
            # The service commits; with savepoints those commits release a savepoint instead.
            with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
                started = time.perf_counter()
                result = OSMIngestionService(session, step_timer=step_timer).import_fixture(
                    MITTE, payload, provider="benchmark"
                )
                total = time.perf_counter() - started
        finally:
            outer.rollback()

    print(
        f"{payload_path.name}: {result.road_count} roads, {result.building_count} buildings, "
        f"{result.block_count} blocks"
    )
    for step, seconds in timings.items():
        print(f"  {step:<18}{seconds:7.1f} s")
    print(f"  {'other':<18}{total - sum(timings.values()):7.1f} s")
    print(f"  {'total':<18}{total:7.1f} s   (rolled back)")


if __name__ == "__main__":
    main()
