## Context

`import_areas` stores a rectangle (four numeric bounds plus a `bbox` polygon) and is reused on
re-import through `get_or_create`, so its id and `bbox` never change. Ingestion's reconcile sweep
deletes only the entity tables it imports, and blocks are cleared and re-derived on every import.
The domain `Polygon` type is a single ring of `Coordinate`s with no holes.

## Goals / Non-Goals

**Goals:** named, non-rectangular boundaries over an import area; boundaries that never change
imported or derived data; scoping queries and exports to a boundary; filter and clip export modes
with local projection metadata.

**Non-Goals:** polygons with holes or multiple parts; editing a boundary in place (delete and
create instead); building heights (Milestone 10); mesh formats.

## Decisions

- **Boundaries live in their own table, `traced_boundaries`**, keyed to `import_areas` by FK and
  unique on `(import_area_id, name)`. Nothing else references it, and ingestion never touches it,
  so creating or deleting a boundary can't change imported data, and a re-import keeps an area's
  boundaries.
- **Validation happens twice, with the application first.** A pure domain function
  (`validate_traced_boundary`) checks the name and ring, and raises `InvalidTracedBoundary`
  carrying the rule that failed: `blank_name`, `too_few_vertices`, `not_closed`, `degenerate`
  (zero area or a repeated vertex), `self_intersecting`, or `outside_import_area`. The database
  enforces the geometric rules as a backstop, so a write that skips the repository can't store a
  bad shape:
  - a CHECK constraint `ST_IsValid(geom) AND ST_IsSimple(geom)`;
  - a trigger, following the `turn_movements` precedent, that requires
    `ST_CoveredBy(geom, import_areas.bbox)`, because a CHECK can't read another table. It raises
    `check_violation`, so both backstops surface as an `IntegrityError`.
  Closure is checked in the domain because shapely and PostGIS both close a ring silently.
- **Containment means covered-by, not strictly within.** A boundary may touch or coincide with the
  rectangle's edge, so a boundary that covers the whole rectangle is valid. #50 depends on that.
  The rectangle is convex, so the domain checks containment as "every vertex is inside or on the
  rectangle".
- **Self-intersection is checked planar, on longitude and latitude.** Import areas are at most
  1 km across, so the planar test agrees with PostGIS's, which is also planar on SRID 4326. Any
  contact between non-adjacent edges counts, including a single touching point, which matches
  `ST_IsValid`'s ring self-intersection rule.
- **A duplicate name is its own error**, `DuplicateTracedBoundaryName`, raised when the unique
  constraint fires inside a savepoint. #48 maps it to a 409.
- **Scope = boundary intersects entity** (#49, #50). An entity belongs to a boundary's scope when
  its geometry intersects the boundary. That's what filter-mode export returns whole. Clip mode
  (#51) then intersects the geometry with the boundary.
- **Projection origin = the scope's centroid** (#50), with meters-per-degree factors for latitude
  and longitude at that latitude.

## Risks / Trade-offs

- The domain and PostGIS implement validity separately. A disagreement on an edge case shows up as
  an `IntegrityError` rather than an `InvalidTracedBoundary`. It's still rejected, just with a
  less specific message.
