## 1. Traced boundaries (#47)

- [x] 1.1 Domain `TracedBoundary` and `validate_traced_boundary` with table-driven tests and a purity test; mutation-check each rule
- [x] 1.2 Migration creating `traced_boundaries` (unique name per area, GiST index, validity CHECK, containment trigger); model
- [x] 1.3 `TracedBoundaryRepository`: create / get / list-for-area / delete, and `DuplicateTracedBoundaryName`
- [x] 1.4 Tests: CRUD; each rule rejected through the repository; direct inserts rejected by both backstops; counts and blocks unchanged by create and delete; re-import keeps boundaries; mutation-check the backstops
- [x] 1.5 `traced-boundaries` spec delta; update `docs/schema.md`

## 2. Boundary endpoints (#48)

- [ ] 2.1 `POST` / `GET` (list and one) / `DELETE` under `/import-areas/{id}/boundaries`, with error codes; spec delta for `import-area-api`
- [ ] 2.2 Update `docs/client-features.md`

## 3. Scoped spatial queries (#49)

- [ ] 3.1 Optional boundary scope on `SpatialQueryService` and on `nearby` / `within-bbox` / `nearest`; spec deltas
- [ ] 3.2 Update `docs/client-features.md`

## 4. Scope export, filter mode (#50)

- [ ] 4.1 `map-data` with `boundary_id`, `scope`, `mode`, `projection`; complete block properties; spec delta
- [ ] 4.2 Update `docs/client-features.md`

## 5. Scope export, clip mode (#51)

- [ ] 5.1 `mode=clip`, with multi-part serialization; spec delta
- [ ] 5.2 Update `docs/client-features.md` and `MILESTONES.md` (Milestone 8 status); archive the change
