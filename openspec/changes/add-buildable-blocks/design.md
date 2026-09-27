## Context

`BlockDerivationService.derive_for_import_area` polygonizes the noded union of an area's road
segments and stores each face as a block, bounded by the segments the face covers. The generated
street width is a pure domain function computed on read (`cross_sections_by_segment`). Segment
ids are stable under reconcile, because a segment is upserted by `(road, from_node, to_node)`.
Ingestion already accepts roads whose envelope only intersects the bbox, so segments can extend
past its edge.

## Goals / Non-Goals

**Goals:** buildable area and median flag per block; edge blocks closed against the bbox; block ids
stable across unchanged re-imports.

**Non-Goals:** exposing blocks' new fields over the API (Milestone 8's export); traced boundaries
(Milestone 8); anything that attaches content to blocks (Milestone 11).

## Decisions

- **Buildable area is stored at derivation, not computed on read.** It's a geometry that later
  spatial queries and exports use, and derivation already runs in the import's unit of work.
  Because widths are code constants, changing a width needs `rederive_for_import_area` rather than
  a re-import.
- **Half-width = half the whole road's generated width.** `SegmentCrossSection.width_meters` is the
  width of both directions together, so each bounding segment is buffered by `width_meters / 2` on
  geography (meters). A road's reverse twin has the same geometry and width, so it adds nothing.
  Buffers use round caps, which approximate a curb radius at corners.
- **A median is flagged, not dropped.** A block is `is_median` when its buildable area is empty, or
  vanishes under an inward buffer of `MIN_BUILDABLE_WIDTH_METERS / 2` (nowhere is it 5 m wide).
  Keeping the row keeps the topology and building links intact, and consumers filter on the flag.
  An empty buildable area is stored as `NULL`, with area 0.
- **Edge blocks come from polygonizing the bbox ring together with the segments.** Faces are kept
  only if they lie inside the bbox (`ST_PointOnSurface` within the bbox). A face is clipped when
  part of its exterior isn't along a road, which means that part is along the ring. A clipped
  face is kept only if a road segment that crosses the bbox (not covered by it) runs along its
  exterior. That drops what is left of the box around loops that stay inside it or merely touch
  its edge, so an area whose roads never cross the edge derives the same blocks as before. Faces
  outside the bbox, formed by roads that leave and re-enter it, are no longer blocks. "Along" is
  tested within a ~0.1 mm buffer, because noding computes crossing points in floating point.
- **Bounding segments of any block** are the segments the face covers, plus the segments that
  share a line with the face's boundary. The second group catches a segment that crosses the bbox
  edge and so extends past the face. The order is still by position along the exterior ring. On a
  clipped block the recorded segments don't close a loop, because the bbox stretch has no segment.
- **Block id = `uuid5(namespace, "<import_area_id>:<sorted segment ids>")`**, computed by a pure
  domain function. Two faces with the same segment set, a degenerate case, get their position in
  a stable ordering appended to the key. The id depends on the segment set, not on geometry, so
  moving a node without changing any segment keeps the id. Changing which segments bound a block
  (adding, removing, or splitting a road) changes it. Following that, blocks are still cleared
  before the segment sweep and re-inserted, because no foreign key cascades. An unchanged block
  comes back under the same id; only its `created_at` resets.

## Risks / Trade-offs

- Clear-and-reinsert under stable ids works until something references blocks with a foreign key
  (Milestone 11). That milestone will need an in-place reconcile of blocks.
- Round-cap buffers slightly over-trim convex corners, which is acceptable for a generated
  representation.
