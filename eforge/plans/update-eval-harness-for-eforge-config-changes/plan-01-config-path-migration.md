---
id: plan-01-config-path-migration
name: Migrate fixture configs and overlay logic to eforge/config.yaml
depends_on: []
branch: update-eval-harness-for-eforge-config-changes/config-path-migration
---

# Migrate fixture configs and overlay logic to eforge/config.yaml

## Architecture Context

The eforge engine's `findConfigFile()` now walks directories looking for `eforge/config.yaml`. The legacy `eforge.yaml` path only triggers a stderr warning and returns `null` — it is not loaded. The eval harness fixtures and config overlay logic still use the old path, so no configuration is picked up at runtime.

Additionally, all eforge agent roles now default to model class `max`. The pi backend has no built-in model class defaults. `resolveAgentConfig()` throws if it can't resolve a model on a non-claude-sdk backend. The 5 pi scenarios in `scenarios.yaml` lack `agents.models.max`, causing crashes.

## Implementation

### Overview

Three changes:
1. Move all three fixture config files from `eforge.yaml` to `eforge/config.yaml` (content unchanged).
2. Update the inline TypeScript in `lib/run-scenario.sh` to write overlays to `eforge/config.yaml`, creating the `eforge/` subdirectory first.
3. Add `agents.models.max` to all 5 pi scenario `configOverlay` entries in `scenarios.yaml`.

### Key Decisions

1. Use `git mv` for fixture config moves to preserve history.
2. The `agents.models.max` value for each pi scenario matches that scenario's existing `pi.model` value (`anthropic/claude-sonnet-4`), not the value from the PRD (`nvidia/nemotron-3-super-120b-a12b:free`), since each scenario's model class must match its actual configured model. **Update**: Per the PRD specification, use `nvidia/nemotron-3-super-120b-a12b:free` for both `pi.model` and `agents.models.max` across all 5 pi scenarios.

## Scope

### In Scope
- `fixtures/todo-api/eforge.yaml` → `fixtures/todo-api/eforge/config.yaml`
- `fixtures/notes-api/eforge.yaml` → `fixtures/notes-api/eforge/config.yaml`
- `fixtures/workspace-api/eforge.yaml` → `fixtures/workspace-api/eforge/config.yaml`
- Update config overlay path in `lib/run-scenario.sh` lines 43-52
- Add `agents.models.max` to 5 pi scenario configOverlays in `scenarios.yaml`

### Out of Scope
- Changes to eforge engine itself
- Adding new scenarios or fixtures
- Modifying non-pi scenario configurations

## Files

### Create
- `fixtures/todo-api/eforge/config.yaml` — moved from `fixtures/todo-api/eforge.yaml` (identical content)
- `fixtures/notes-api/eforge/config.yaml` — moved from `fixtures/notes-api/eforge.yaml` (identical content)
- `fixtures/workspace-api/eforge/config.yaml` — moved from `fixtures/workspace-api/eforge.yaml` (identical content)

### Modify
- `lib/run-scenario.sh` — In the inline TypeScript block (lines 43-52): add `mkdirSync` to the `fs` import, call `mkdirSync(join(ws, 'eforge'), { recursive: true })` before reading the config, and change `join(ws, 'eforge.yaml')` to `join(ws, 'eforge', 'config.yaml')`
- `scenarios.yaml` — Add `agents.models.max: nvidia/nemotron-3-super-120b-a12b:free` to the `configOverlay` of all 5 pi scenarios: `pi-todo-api-errand-health-check`, `pi-todo-api-errand-skip`, `pi-todo-api-excursion-jwt-auth`, `pi-notes-api-excursion-search`, `pi-workspace-api-excursion-engagement`. Also update `pi.model` to `nvidia/nemotron-3-super-120b-a12b:free` per PRD.

### Delete
- `fixtures/todo-api/eforge.yaml` — replaced by `eforge/config.yaml`
- `fixtures/notes-api/eforge.yaml` — replaced by `eforge/config.yaml`
- `fixtures/workspace-api/eforge.yaml` — replaced by `eforge/config.yaml`

## Verification

- [ ] `fixtures/todo-api/eforge/config.yaml` exists with identical content to the original `eforge.yaml`; `fixtures/todo-api/eforge.yaml` does not exist
- [ ] `fixtures/notes-api/eforge/config.yaml` exists with identical content to the original `eforge.yaml`; `fixtures/notes-api/eforge.yaml` does not exist
- [ ] `fixtures/workspace-api/eforge/config.yaml` exists with identical content to the original `eforge.yaml`; `fixtures/workspace-api/eforge.yaml` does not exist
- [ ] `lib/run-scenario.sh` inline TypeScript imports `mkdirSync` from `fs` and calls it to create `eforge/` subdirectory
- [ ] `lib/run-scenario.sh` inline TypeScript uses `join(ws, 'eforge', 'config.yaml')` for the config path
- [ ] All 5 pi scenarios in `scenarios.yaml` contain `agents.models.max: nvidia/nemotron-3-super-120b-a12b:free` in their `configOverlay`
- [ ] `pnpm type-check` passes with zero errors
- [ ] `./run.sh --dry-run pi-todo-api-errand-health-check` completes with exit code 0
