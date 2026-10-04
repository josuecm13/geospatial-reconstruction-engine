## Why

<!-- 2-4 sentences the milestone section doesn't already say, then the links. -->

See #<tracking issue>.

## What Changes

<!-- One bullet per GitHub issue; its acceptance criteria are the detail. -->
- **<short name> (#<n>)**: <one sentence>

## Capabilities

### New Capabilities
<!-- Capabilities being introduced. Replace <name> with kebab-case identifier (e.g., user-auth, data-export, api-rate-limiting). Each creates specs/<name>/spec.md -->
- `<name>`: <brief description of what this capability covers>

### Modified Capabilities
<!-- Existing capabilities whose REQUIREMENTS are changing (not just implementation).
     Only list here if spec-level behavior changes. Each needs a delta spec file.
     Use existing spec names from openspec/specs/. Leave empty if no requirement
     changes. A change with no capabilities at all (pure refactor, tooling, docs)
     must set `skip_specs: true` in its .openspec.yaml - openspec validate rejects
     a zero-delta change without that marker. Do not invent a requirement just to
     satisfy validation. -->
- `<existing-name>`: <what requirement is changing>

## Impact

<!-- Short list: affected code areas, APIs, dependencies, docs -->
