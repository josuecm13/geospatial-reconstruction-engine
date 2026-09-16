## Context

See `proposal.md` for motivation. The full schema (tables, enums, constraints, indexes, and the reasoning behind lane direction and dense turn movements) was already designed collaboratively and is recorded in `docs/schema.md` — this design references it rather than restating it. Milestone 1 established the runtime, PostGIS, and Alembic scaffold this change builds on (`server/alembic/`, `server/app/`).

## Goals / Non-Goals

**Goals:**
- Implement `docs/schema.md` exactly, as ordered Alembic migrations.
- Provide SQLAlchemy/GeoAlchemy2 models plus repository interfaces for every entity, so Milestone 3 (ingestion) has something concrete to write against.
- Provide a callable block-derivation service (`ST_Polygonize` over the road graph, then building containment) with its own tests against fixture segment data.
- Cover idempotent-upsert and turn-movement-integrity behavior with tests against a real PostGIS instance (`docker compose up -d`), per Milestone 2's acceptance checks.

**Non-Goals:**
- No OSM adapter or ingestion pipeline (Milestone 3) — nothing in this change reads from OSM.
- No API endpoints (Milestone 7).
- No graph traversal or routing logic (Milestones 5–6) — `road_segments`/`turn_movements` exist as queryable data only.
- No automatic triggering of block derivation on any schedule or ingestion event (see Open Questions).
- No multi-provider merge logic — the schema supports multiple providers structurally, but only one provider is exercised by this change's tests.

## Decisions

- **Repositories return domain objects, not ORM models.** One repository per aggregate (`ImportAreaRepository`, `RoadGraphRepository`, `BlockRepository`, `BuildingRepository`, etc.) translates SQLAlchemy rows into plain domain dataclasses before returning them. Alternative considered: return SQLAlchemy models directly — rejected because it couples every future consumer (ingestion, API) to ORM lazy-loading/session semantics and violates the existing boundary rule in `docs/architecture.md` ("repository interfaces that do not expose OSM-specific types"); it also matches the pattern `server/app/domain/bounding_box.py` already set in Milestone 1 (framework-agnostic domain code).
- **Turn-movement integrity is enforced by a Postgres trigger**, not application code alone. Milestone 2's acceptance criteria explicitly require "turn movements enforce valid segment-to-intersection relationships" at the schema level; a trigger guarantees this even for a future direct-SQL write that bypasses the repository. Alternative: validate only in the repository — rejected as insufficient against that acceptance criterion, and the trigger logic is only two equality checks.
- **Block derivation uses plain `ST_Polygonize` over unioned `road_segments.geom`**, not the `postgis_topology` extension (already enabled in the DB, bundled with the `postgis/postgis` image). `ST_Polygonize` is the simplest correct approach at the bounded ≤1 km² scale this project targets. Topology tables add real complexity (`TopoGeometry` management, an editing API) that isn't justified yet — revisit only if real imported data produces gaps/slivers `ST_Polygonize` can't handle.
- **UUID primary keys via Postgres 16's built-in `gen_random_uuid()`** (no `pgcrypto` extension needed). Source ids (OSM ids) are stored as `source_id`, never reused as the primary key, so application identity never depends on a provider's id scheme.
- **`created_at`/`updated_at` on every table**, server-defaulted (`DEFAULT now()`) with `updated_at` maintained via a shared trigger — negligible cost, standard audit trail.

## Risks / Trade-offs

- [Dense `turn_movements` rows could grow large at complex/many-legged intersections] → Acceptable at the project's bounded ≤1 km² scale; revisit only if a real import produces pathological intersection counts.
- [`ST_Polygonize` is sensitive to imprecise or dangling OSM linework — could miss or merge blocks] → This change's tests use hand-built segment fixtures, not real OSM data, so this risk is deferred to Milestone 3 ingestion testing, not resolved here.
- [Postgres enum types are the least flexible option for evolving category lists] → Accepted trade-off (already decided); `ALTER TYPE ... ADD VALUE` is a normal, low-risk migration when a new category value is needed.
- [A DB trigger duplicates a rule that could live only in application code] → Accepted given the explicit Milestone 2 acceptance criterion; kept intentionally minimal to limit duplication risk.

## Migration Plan

All changes ship as ordered, additive Alembic migrations under `server/alembic/versions/` (new enum types, then tables in dependency order, then the turn-movement trigger) — no existing tables are altered. Rollback is `alembic downgrade` per migration, dropping the trigger and tables in reverse dependency order before their enum types.

## Open Questions

- Whether block derivation should run automatically at the end of every import or be invoked as an explicit step (API/CLI) is not resolved here — it doesn't affect this change's schema, models, or tests, since no ingestion pipeline or API exists yet. The derivation logic is exposed as a plain callable service function; Milestone 3 or Milestone 7 can wire it up however makes sense once that context exists.
