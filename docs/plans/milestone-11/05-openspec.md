# 05 — The Milestone 11 OpenSpec change (#23)

Model: haiku. Branch: `work/m11-openspec`, from the tip of `origin/feat/23-generated-block-content`.
One commit, and don't push. Docs only. Don't run `openspec validate` or any suite (CI does);
`openspec --help` and `openspec list` are fine.

Source of truth: `docs/plans/milestone-11/00-decisions-and-contract.md` (the "contract"), which is
up to date, including the road-density rule for `sparse`, and `docs/architecture.md` → "Generated
block content". Don't add decisions that aren't there.

Create `openspec/changes/add-generated-block-content/`, using the project schema
`openspec/schemas/milestone-driven/` (read `schema.yaml` and `templates/`). Mirror the structure,
tone and delta format of `openspec/changes/archive/2026-10-10-add-terrain-elevation/`, including its
`.openspec.yaml`.

- **`proposal.md`:**
  - Why: link #23 rather than restate it.
  - What Changes: bullets for generation, block feedback, block outlines and selection, the Set
    point tool, and the featured place. Note that the owner chose **no sub-issues**: everything ships
    in PR #140 under #23.
  - Capabilities: new `block-generation`, `block-feedback` and `site-settings`; modified
    `import-area-api`, `osm-fixture-ingestion` and `showcase-client`.
- **`design.md`:** the decisions with short rationale, pointing to `docs/architecture.md` rather than
  copying it. Cover:
  - eligibility;
  - suitability (excluded land, informal and sparse styles: sparse by road density, because mapped
    building coverage measures OSM completeness, not ruralness);
  - references (frontage measured by casting rays inward from the street line, the 0.70 coverage
    threshold, matching within 500 m);
  - the generator (determinism, feedback, calibration);
  - storage and staleness;
  - the layering (pure domain plus a shapely `app/generation/` package);
  - the alternatives rejected: per-block generation, machine learning, excluding all constrained
    land, deriving no clipped faces, and authentication now.
- **`tasks.md`:** `## 1. Work` with checkboxes:
  - [x] 1.1 Eligibility, land-use kinds, suitability, references and matching
  - [x] 1.2 Generator, storage, generation and feedback API, map-data
  - [x] 1.3 Client: generate/show/hide, generated colour, block outlines, selection and feedback, zones
  - [x] 1.4 Set point tool shared by orbit and walk
  - [x] 1.5 Featured place setting and "Show on landing"
  - [ ] 1.6 Close out: tracking issue note, MILESTONES.md row, archive the change
- **`specs/`** delta specs with `## ADDED` / `## MODIFIED Requirements`, each requirement with
  `#### Scenario:` WHEN/THEN blocks. Read `openspec/specs/<capability>/spec.md` before writing any
  MODIFIED block, and copy the full current requirement text, changing only what this change alters.
  - **`block-generation`** (new, with a `## Purpose`):
    - eligibility;
    - suitability exclusions and styles;
    - reference fingerprints and threshold;
    - matching within 500 m with defaults;
    - one deterministic run per area over every eligible block;
    - no writes to observed tables, and deleting a run restores OSM-only;
    - nothing outside eligible blocks, in excluded land, in setbacks, or overlapping real buildings;
    - staleness on road or terrain change;
    - CI makes no live call.
  - **`block-feedback`** (new): put, clear and list feedback; a count obeyed exactly; no-buildings
    gives zero; calibration of similar blocks within 500 m; orphaned feedback reported, never
    misapplied.
  - **`site-settings`** (new): the featured area get and set (404, 409), null clears it, deleting the
    area clears it, and the landing page's fallback order.
  - **`import-area-api`:** ADDED the generation endpoints (POST, GET, DELETE, with every status in
    contract §8), and the map-data `generation`, `generated_buildings` and `generation_zones` layers
    and the new block properties.
  - **`osm-fixture-ingestion`:** ADDED the five land-use kinds and their tags.
  - **`showcase-client`:**
    - ADDED Generate/Regenerate and Show generated, the generated colour, inset dashed block
      outlines by eligibility, block selection with counts and feedback, zone shading, the export
      following visibility, the Set point tool (orbit, walk start, reset, the two tools excluding each
      other), and Show on landing with the featured badge.
    - MODIFIED the requirement that mentions "Show buildable area", if one does (search the living
      spec), since Show blocks replaces it.

Commit message:
```
docs: open the Milestone 11 OpenSpec change (#23)

Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>
```

Report: the SHA, `git show --stat`, and anything in the contract you found ambiguous.
