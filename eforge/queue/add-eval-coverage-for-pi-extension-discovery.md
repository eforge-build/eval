---
title: Add Eval Coverage for Pi Extension Discovery
created: 2026-03-30
status: pending
---

# Add Eval Coverage for Pi Extension Discovery

## Problem / Motivation

There is no eval coverage verifying that Pi extensions are discovered and loaded when using the Pi backend. The extension discovery system (`discoverPiExtensions()`) auto-discovers extensions from `.pi/extensions/` subdirectories, and the Pi backend loads them via the Pi SDK's `discoverAndLoadExtensions()` — but this path has never been validated end-to-end in the eval harness.

## Goal

Add a marker Pi extension to the `todo-api` fixture and validate it loads during Pi backend eval scenarios. When the extension factory executes, it writes a marker file to the workspace. A validation step confirms the file exists.

## Approach

### 1. Add marker extension to `todo-api` fixture

Create `fixtures/todo-api/.pi/extensions/marker/index.ts`:

```typescript
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default function marker() {
  writeFileSync(join(process.cwd(), '.pi-extension-loaded'), 'marker');
}
```

- This is a minimal Pi extension — a subdirectory with an `index.ts` that exports a default factory function.
- The Pi SDK loads it via jiti (raw TypeScript, no compilation needed).
- The factory receives an `ExtensionAPI` parameter but it is not needed here — the function simply writes a marker file to prove the factory executed.
- `process.cwd()` is the workspace directory because the eval harness `cd`s into the workspace before running eforge.
- Claude SDK scenarios using the same `todo-api` fixture are unaffected because Pi extensions only load for the Pi backend (`isCoding && !this.bare` guard in `pi.ts`).

### 2. Add validation to existing Pi scenario

In `scenarios.yaml`, add `test -f .pi-extension-loaded` to the `pi-todo-api-errand-health-check` scenario's `validate` list. This follows the same pattern as the existing hook events check on that scenario (`test -f .eforge/hook-events.log && grep -q EFORGE_CWD .eforge/hook-events.log`).

No new scenario is needed — this avoids additional API cost while still verifying the extension loading path.

## Scope

**In scope:**
- New marker extension file in `todo-api` fixture
- One additional validation command on the existing scenario

**Out of scope:**
- New eval scenarios
- New fixtures
- Changes to the eval harness itself
- Testing include/exclude filtering (covered by unit tests in the eforge repo)

## Acceptance Criteria

1. `fixtures/todo-api/.pi/extensions/marker/index.ts` exists with a valid Pi extension factory that writes `.pi-extension-loaded`.
2. The `pi-todo-api-errand-health-check` scenario validates `test -f .pi-extension-loaded`.
3. Running the scenario with the Pi backend produces a passing validation for the marker file check.
