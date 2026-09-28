## Purpose

Lets a user trace named, non-rectangular shapes over an imported area that narrow it for queries and exports, without changing anything that was imported.

## ADDED Requirements

### Requirement: An import area SHALL hold any number of named traced boundaries
The system SHALL persist traced boundaries: each one belongs to one import area and has a name and a single-ring polygon in SRID 4326. A name SHALL be unique within its import area, and the same name MAY be used in different import areas. The import area's original bounding box SHALL remain readable alongside its boundaries.

#### Scenario: Several boundaries over one import area
- **WHEN** two boundaries with different names are created for the same import area
- **THEN** both can be fetched by id and listed for that area, and the area's bounding box is unchanged

#### Scenario: Duplicate name
- **WHEN** a boundary is created with a name that already exists in the same import area
- **THEN** creation fails with a duplicate-name error and the existing boundary is unchanged

### Requirement: A traced boundary SHALL be a valid polygon that narrows its import area
The system SHALL reject a boundary whose name is blank, whose ring is not closed, has fewer than three distinct vertices, repeats a vertex, has zero area, or intersects itself, or whose polygon is not covered by its import area's bounding box. The error SHALL name the rule that failed. A boundary MAY touch or coincide with the bounding box's edge. The database SHALL enforce validity and containment itself, so a write that bypasses the application is also rejected.

#### Scenario: Self-intersecting polygon
- **WHEN** a boundary is created with a bow-tie ring
- **THEN** creation fails naming the `self_intersecting` rule, and nothing is stored

#### Scenario: Polygon extending outside the import area
- **WHEN** a boundary is created with a vertex outside the import area's bounding box
- **THEN** creation fails naming the `outside_import_area` rule, and nothing is stored

#### Scenario: Boundary equal to the whole rectangle
- **WHEN** a boundary is created whose ring is the import area's bounding box
- **THEN** it is stored

#### Scenario: Direct insert bypassing the application
- **WHEN** a self-intersecting or out-of-bounds polygon is inserted into the table directly
- **THEN** the database rejects the insert

### Requirement: Traced boundaries SHALL NOT change imported or derived data
Creating or deleting a traced boundary SHALL leave the import area's entities, their counts, and its derived blocks unchanged. Re-importing an import area SHALL keep its traced boundaries.

#### Scenario: Create and delete are non-destructive
- **WHEN** a boundary is created and then deleted for an imported area
- **THEN** the area's entity counts and block ids are identical before creation, after creation, and after deletion

#### Scenario: Re-import keeps boundaries
- **WHEN** an area with a boundary is re-imported
- **THEN** the boundary still exists with the same id, name, and polygon
