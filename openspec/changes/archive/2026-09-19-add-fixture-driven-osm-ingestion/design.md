## Context

The existing persistence layer owns the normalized GeoDB schema and domain repositories, while `import_area_lifecycle`, `road_graph_persistence`, and `turn_movement_modeling` already define the destination behavior. This change introduces the boundary that turns a provider-shaped OSM payload into those existing models. See [proposal.md](proposal.md) for motivation and [the delta spec](specs/osm-fixture-ingestion/spec.md) for observable requirements.

## Goals / Non-Goals

**Goals:**

- Make OSM translation independently testable with deterministic, local fixture payloads.
- Keep OSM types and tag vocabulary confined to an adapter and its intermediate import records.
- Persist a complete enough road network to preserve direction, lane counts, and source turn restrictions.
- Make a repeated import converge on the same normalized entities and outcome counts.

**Non-Goals:**

- Live Overpass/API requests, retry policies, provider credentials, or rate-limit handling.
- Full OSM tag coverage, public-transport routing, pedestrian rules, lane-level turn connectivity, or traffic-signal behavior.
- Public HTTP endpoints, graph traversal, routing, or visualization.
- Changing the existing persistence schema except when an implementation-discovered correctness gap cannot be addressed through the current model.

## Decisions

### Parse OSM into provider-neutral import records before persistence

The adapter accepts an Overpass-style JSON fixture and produces typed, application-owned records for supported features. The ingestion service consumes only these records and the existing domain repositories.

This makes fixtures faithful to the external source without coupling downstream code to OSM keys or element IDs. Passing raw payload dictionaries through the service was rejected because it would spread source-specific branching into persistence and make a future provider replacement expensive.

### Scope the first adapter to an explicit supported tag set

Road ways are accepted for the supported `highway` classifications already represented by `RoadClassification`. Building polygons, POI nodes/areas, and park/green-area polygons map to the current enums. Unsupported tags are ignored; malformed data for a feature that is otherwise supported is an error.

An open-ended tag bag was rejected because the project deliberately owns a constrained domain model. A strict failure for every unsupported OSM element was rejected because ordinary OSM payloads contain many irrelevant features.

### Derive directed segments from topology, then apply directional lanes

The ingestion service builds road topology from the source way's ordered node references, splitting at endpoints and shared/intersection nodes. A two-way way produces an ordered segment in each direction; a one-way way produces only its permitted direction. The adapter retains source-way orientation long enough to map `lanes:forward` and `lanes:backward` to the correct directed segment's single `lane_count`.

Storing forward/backward fields in the domain was rejected because direction is already inherent in `RoadSegment`. Guessing a missing count as one was rejected because unknown data must remain distinguishable from an observed count.

### Generate dense turn candidates before applying restrictions

After segments persist, the ingestion service asks the existing turn-movement component to generate every plausible transition at each imported intersection. It resolves each supported restriction relation through its `from` way, `via` node, and `to` way to the relevant directed segment pair, then updates candidate permissions. `only_*` restrictions prohibit the other applicable candidates for the same incoming segment at that intersection.

Generating only explicit restrictions was rejected because downstream routing would need default-allow logic and could not query a complete transition graph. Ignoring unresolved restrictions was rejected because it can silently produce an unsafe route; the import fails with source identifiers and the unresolved member role in the error.

### Make the import transactional and report an application-level result

One database transaction encloses area lifecycle updates, source entity upserts, segment/movement generation, and count calculation. On success it marks the import completed and returns an `ImportResult`; on an ingestion error it rolls back entity writes, marks the import area failed in a separate short transaction, then surfaces an actionable domain error.

Partial success was rejected because it would make reruns and graph semantics hard to reason about. Returning raw repository models was rejected because callers need a stable import summary independent of persistence internals.

## Risks / Trade-offs

- [Source fixtures use variations not covered by the initial tag mapping] → Keep fixtures representative, document supported mappings, and add mapping cases only alongside an explicit spec change.
- [Way splitting may not capture every geometric crossing in OSM] → Start with shared-node topology; detect non-noded crossings as unsupported data rather than inventing intersections. Add geometry noding only when a later change requires it.
- [Restriction relation resolution is ambiguous on multi-segment ways] → Resolve via ordered way membership and the stated via node; fail when this cannot identify exactly one incoming/outgoing segment.
- [A failed rerun leaves previously completed data intact] → Preserve the last committed normalized dataset while status reports the latest failed attempt; document this result in the import error and do not expose it as a successful current import.

## Migration Plan

1. Add adapter, ingestion, fixture, and test modules without changing existing database contracts.
2. Run the complete server test suite against an empty PostGIS database and fixture imports.
3. Validate the OpenSpec change before implementation and after all tasks are complete.
4. If the feature is rolled back, remove the new service modules and tests; no schema rollback is expected unless a separately justified migration is added.

## Open Questions

- Block derivation remains deferred: this milestone persists road topology and buildings but does not decide whether block derivation runs automatically after a successful import or through a later explicit action.
