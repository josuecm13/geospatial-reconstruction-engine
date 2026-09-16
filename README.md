# Geospatial Reconstruction Engine

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

The initial architecture is recorded in [docs/architecture.md](docs/architecture.md), and the progressive implementation plan is tracked in [MILESTONES.md](MILESTONES.md).

## Status

Repository initialization and architecture planning are complete. Implementation starts with the project runtime, database migrations, and geographic validation.
