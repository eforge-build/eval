---
title: Update Eval Harness for eforge Config Changes
created: 2026-03-29
status: pending
---

# Update Eval Harness for eforge Config Changes

## Problem / Motivation

Two recent eforge engine changes have broken the eval harness:

1. **Config file location**: `findConfigFile()` now walks directories looking for `eforge/config.yaml`. The legacy `eforge.yaml` path only triggers a stderr warning and returns `null` — it is **not loaded**. All three fixtures and the config overlay logic in the eval harness still write to the old path, meaning no configuration is picked up at runtime.

2. **Pi backend model class requirement**: All agent roles now default to model class `max`. The pi backend has no built-in model class defaults (all `undefined`). `resolveAgentConfig()` throws if it can't resolve a model on a non-claude-sdk backend. The pi scenario `configOverlay` entries don't set `agents.models.max`, so all 5 pi scenarios will crash.

## Goal

Align the eval harness with the current eforge engine expectations so that all fixtures use the new config path (`eforge/config.yaml`) and all pi scenarios supply the required `agents.models.max` model class, restoring a fully functional eval pipeline.

## Approach

### 1. Move fixture configs: `eforge.yaml` → `eforge/config.yaml`

Move (git mv) for all three fixtures — content stays identical:

- `fixtures/todo-api/eforge.yaml` → `fixtures/todo-api/eforge/config.yaml`
- `fixtures/notes-api/eforge.yaml` → `fixtures/notes-api/eforge/config.yaml`
- `fixtures/workspace-api/eforge.yaml` → `fixtures/workspace-api/eforge/config.yaml`

### 2. Update config overlay path in `lib/run-scenario.sh`

In the inline TypeScript (lines 43–52):

- Change `join(ws, 'eforge.yaml')` → `join(ws, 'eforge', 'config.yaml')`
- Add `mkdirSync` import and call `mkdirSync(join(ws, 'eforge'), { recursive: true })` before reading

### 3. Add `agents.models.max` to all 5 pi scenario configOverlays in `scenarios.yaml`

Each pi scenario's `configOverlay` becomes:

```yaml
configOverlay:
  backend: pi
  pi:
    provider: openrouter
    model: nvidia/nemotron-3-super-120b-a12b:free
  agents:
    models:
      max: nvidia/nemotron-3-super-120b-a12b:free
```

Affected scenarios:
- `pi-todo-api-errand-health-check`
- `pi-todo-api-errand-skip`
- `pi-todo-api-excursion-jwt-auth`
- `pi-notes-api-excursion-search`
- `pi-workspace-api-excursion-engagement`

## Scope

**In scope:**

| File | Change |
|------|--------|
| `fixtures/todo-api/eforge.yaml` | git mv → `eforge/config.yaml` |
| `fixtures/notes-api/eforge.yaml` | git mv → `eforge/config.yaml` |
| `fixtures/workspace-api/eforge.yaml` | git mv → `eforge/config.yaml` |
| `lib/run-scenario.sh` | Update overlay target path + add `mkdirSync` |
| `scenarios.yaml` | Add `agents.models.max` to 5 pi configOverlays |

**Out of scope:** N/A

## Acceptance Criteria

- All three fixture configs exist at the new path (`eforge/config.yaml` within each fixture directory) with identical content; no files remain at the legacy `eforge.yaml` paths.
- The config overlay logic in `lib/run-scenario.sh` writes to `eforge/config.yaml` inside the workspace directory, creating the `eforge/` subdirectory if it does not exist.
- All 5 pi scenario configOverlays in `scenarios.yaml` include `agents.models.max: nvidia/nemotron-3-super-120b-a12b:free`.
- `pnpm type-check` passes with no TypeScript errors in eval lib code.
- `./run.sh --dry-run pi-todo-api-errand-health-check` completes successfully, writing the config overlay to `eforge/config.yaml` with the `agents.models.max` key present.
- Inspecting the generated workspace config (e.g., `cat /tmp/eforge-eval-pi-todo-api-*/eforge/config.yaml`) confirms the correct path and content.
