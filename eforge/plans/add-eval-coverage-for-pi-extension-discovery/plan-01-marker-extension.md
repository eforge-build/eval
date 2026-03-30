---
id: plan-01-marker-extension
name: Add Pi Marker Extension and Validation
depends_on: []
branch: add-eval-coverage-for-pi-extension-discovery/marker-extension
---

# Add Pi Marker Extension and Validation

## Architecture Context

The eval harness runs eforge against fixture projects and validates behavioral expectations. Pi backend scenarios load Pi extensions from `.pi/extensions/` subdirectories via jiti (raw TypeScript). No eval coverage currently verifies extension discovery and loading. This plan adds a minimal marker extension to the `todo-api` fixture and a validation check on the existing Pi scenario.

## Implementation

### Overview

Create a marker Pi extension in the `todo-api` fixture that writes a `.pi-extension-loaded` file when its factory executes. Add a validation command to the `pi-todo-api-errand-health-check` scenario to confirm the file exists after the run.

### Key Decisions

1. **Reuse existing scenario** — Adding validation to `pi-todo-api-errand-health-check` avoids extra API cost while still covering the extension loading path.
2. **Marker file approach** — Writing a file via `writeFileSync` is the simplest observable side effect to validate extension execution. `process.cwd()` resolves to the workspace because the harness `cd`s there before running eforge.
3. **No `ExtensionAPI` usage** — The factory receives an `ExtensionAPI` parameter but ignores it; the goal is only to prove the factory was called.

## Scope

### In Scope
- New marker extension file at `fixtures/todo-api/.pi/extensions/marker/index.ts`
- One additional `test -f .pi-extension-loaded` validation on the existing Pi scenario

### Out of Scope
- New eval scenarios
- New fixtures
- Changes to the eval harness scripts or TypeScript helpers
- Testing extension include/exclude filtering

## Files

### Create
- `fixtures/todo-api/.pi/extensions/marker/index.ts` — Minimal Pi extension factory that writes `.pi-extension-loaded` to the workspace root

### Modify
- `scenarios.yaml` — Add `test -f .pi-extension-loaded` to the `pi-todo-api-errand-health-check` scenario's `validate` list, after the existing hook events check

## Verification

- [ ] `fixtures/todo-api/.pi/extensions/marker/index.ts` exists and exports a default function that calls `writeFileSync` to create `.pi-extension-loaded`
- [ ] `scenarios.yaml` `pi-todo-api-errand-health-check` scenario `validate` list contains `test -f .pi-extension-loaded`
- [ ] `pnpm type-check` passes with no errors
