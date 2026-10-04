# Milestones

The roadmap lives in GitHub. Each milestone from 7.1 on is a [GitHub milestone](https://github.com/josuecm13/geospatial-reconstruction-engine/milestones)
with a tracking issue: the issue holds the milestone's why, deliverables, acceptance checks and open
questions, and its sub-issues, in order, are the plan (`AGENTS.md` → "Backlog and issues"). This file
only lists the milestones in order and links to them. Milestones are taken in number order, compared as
version numbers. Design rules that outlive a milestone live in `docs/architecture.md`, and each shipped
milestone's decisions live in its archived OpenSpec change's `design.md`.

| # | Milestone | Status | Links |
|---|-----------|--------|-------|
| 0 | Repository and architecture baseline | complete | — |
| 1 | Runtime, database, and geographic validation | complete | [`bootstrap-python-runtime-and-db`](openspec/changes/archive/2026-09-16-bootstrap-python-runtime-and-db/) |
| 2 | Domain model and persistence schema | complete | [`domain-model-and-persistence-schema`](openspec/changes/archive/2026-09-16-domain-model-and-persistence-schema/) |
| 3 | OSM adapter and fixture-driven ingestion | complete | [`add-fixture-driven-osm-ingestion`](openspec/changes/archive/2026-09-19-add-fixture-driven-osm-ingestion/) |
| 4–6 | Spatial queries, road graph, routing | complete | [`add-spatial-queries-road-graph-and-routing`](openspec/changes/archive/2026-09-19-add-spatial-queries-road-graph-and-routing/) · #1 |
| 7 | Application API | complete | [`add-application-api`](openspec/changes/archive/2026-09-25-add-application-api/) · #2 |
| 7.1 | Street cross-sections | complete | #25 · #31, #32, #33 · [`add-street-cross-sections`](openspec/changes/archive/2026-09-27-add-street-cross-sections/) |
| 7.2 | Buildable blocks | complete | #26 · #39, #40, #41 · [`add-buildable-blocks`](openspec/changes/archive/2026-09-27-add-buildable-blocks/) |
| 8 | Custom traced import-area boundaries | complete | #21 · #53, #56–#59 · [`add-traced-import-boundaries`](openspec/changes/archive/2026-09-27-add-traced-import-boundaries/) |
| 8.1 | Building attributes from source | complete | #22 · #73 · [`add-building-attributes-from-source`](openspec/changes/archive/2026-09-30-add-building-attributes-from-source/) |
| 9 | Live import and the showcase client | complete | #27 · #99, #120 · [`add-live-import-and-showcase-client`](openspec/changes/archive/2026-10-03-add-live-import-and-showcase-client/) |
| 10 | Terrain elevation | next | #105 |
| 11 | Generated block content | planned | #23 |
| 12 | Renderable asset semantics | planned | #24 |

When a milestone completes, set its status here and add its PRs and archived change to its row. Its
completion note (what shipped, verification, decisions, what was deferred) goes on its tracking issue
as the closing comment.
