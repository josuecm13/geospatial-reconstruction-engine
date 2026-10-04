# Geospatial Reconstruction Engine

[![CI](https://github.com/josuecm13/geospatial-reconstruction-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/josuecm13/geospatial-reconstruction-engine/actions/workflows/ci.yml)

A self-contained learning and portfolio project that imports a map area no larger than 1 km × 1 km from OpenStreetMap, converts it into an application-owned PostGIS model, builds a road graph, and routes between two coordinates.

OpenStreetMap is only an external source. The database schema, domain entities, graph, and routing behavior are owned by this project.

## First milestone

- Validate and import a bounded geographic area.
- Store roads, navigable nodes and segments, buildings, POIs, and parks in PostgreSQL/PostGIS.
- Query normalized geographic objects spatially.
- Build a directed road graph from road segments.
- Route between two coordinates with a replaceable routing strategy.
- Render imported data and a route in a minimal web map.

## Design

The architecture is recorded in [docs/architecture.md](docs/architecture.md), and the milestones are listed in order in [MILESTONES.md](MILESTONES.md), each linking to its tracking issue, where the plan lives.

## Status

Milestones 0–9 are complete: persistence, OSM fixture ingestion with block derivation and reconciling re-import, spatial queries, road graph, routing, an HTTP API in front of all of it, logical streets with generated cross-sections, buildable blocks, and traced boundaries with scoped queries and GeoJSON export. Milestone 8.1 added building heights from source, and Milestone 9 the live import and the showcase client: pick a place on a 2D map, import it live, and explore it as a low-poly 3D scene. Next is terrain elevation (Milestone 10, #105). See [HOW_TO_RUN.md](HOW_TO_RUN.md) to try it.

To run it end to end, follow [docs/runbook.md](docs/runbook.md); [docs/walkthrough.md](docs/walkthrough.md) tours the client.

## Backlog

Work is tracked as [GitHub issues](https://github.com/josuecm13/geospatial-reconstruction-engine/issues), grouped by [milestones](https://github.com/josuecm13/geospatial-reconstruction-engine/milestones) that mirror `MILESTONES.md`. Every change starts from an issue and closes it from its PR; the workflow is described in [AGENTS.md](AGENTS.md#backlog-and-issues).
