## Context

`RoadSegment.lane_count` is per direction and `None` when the source is silent. It is set by
`osm_adapter._split_lanes`, and `_segments_for_road` puts it on each directed segment. A two-way
way yields a forward and a reverse segment for every piece, while a one-way way yields only the
permitted direction. Streets are upserted one per way, keyed by the way's source id.

## Goals / Non-Goals

**Goals:** a generated, explainable cross-section per road; provenance a consumer can see; streets
as logical groups with stable ids.

**Non-Goals:** per-lane turn arrows (`turn:lanes`), parking and sidewalks, stored or randomized
lanes (those belong to Milestone 11), exposing the street id in the API, and buildable area
(Milestone 7.2).

## Decisions

1. **Computed on read, never stored.** Widths are constants in `app/domain/cross_section.py`, so
   changing one needs no re-import. The alternative was storing the values on `road_segments`,
   which would go stale and need a migration.
2. **Lane widths.** `narrow` 2.75 m, `normal` 3.25 m, `wide` 3.65 m. These are common urban
   design values; the milestone asks for "constants", not particular numbers.
3. **Defaults per direction.** A tagged direction keeps its tag. An untagged direction gets 1 on a
   two-way road. On a one-way road it gets 2 in the travel direction and 0 against it. So a fully
   untagged street always totals two lanes, and a half-tagged two-way road keeps its tagged side.
4. **One-way is inferred on read** from the segments. A road is one-way when none of its segments
   has a reverse twin on the same road, meaning from/to swapped. This mirrors exactly how
   ingestion emits segments, and avoids a new column.
5. **The cross-section uses the road's own classification**, not its street's. They are equal
   today, but they can differ once streets group ways. The map-data read therefore also selects
   `roads.classification`.
6. **Provenance per direction.** Each segment reports `tagged` when its own direction's lane
   count came from the source, and `defaulted` otherwise. Width is a road-level value, since it
   covers both directions.
7. **API naming.** On map-data, `lane_count` becomes the generated count for the segment's
   direction and the raw value moves to `source_lane_count`. Consumers get the generated view by
   default, and the raw value stays distinguishable.
8. **Street grouping.** This is union-find over ways:
   - Named ways whose normalized names match (casefolded, with whitespace collapsed) join when they
     share a node.
   - Two same-named one-way ways also join as a divided road when their overall headings are at
     least 135° apart and some vertex of one lies within 30 m of a vertex of the other.
   - Unnamed ways stay alone.
   - The group key is the members' sorted source ids joined with `+`. It becomes the street's
     `source_id`, and the id is `uuid5(namespace, "<import_area_id>:<group key>")`. This makes it
     deterministic even across fresh databases, with no schema change.
   - A group's classification is its most significant member's.

## Risks / Trade-offs

- **The map-data `lane_count` meaning changes.** There is no external consumer yet (the viewer
  arrives in Milestone 9), and the raw value remains available as `source_lane_count`.
- **Vertex-distance pairing can miss** long divided roads whose carriageways are sparse in
  vertices. When that happens they stay separate streets, which is today's behavior, so nothing
  gets worse.
- **Group keys change when a way joins or leaves a street**, so that street's id changes. Only
  *unchanged* re-imports promise stability.
