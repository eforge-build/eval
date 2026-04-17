# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

End-to-end evaluation harness for [eforge](https://github.com/eforge-build/eforge). Runs eforge against fixture projects, validates the output compiles and tests pass, and checks behavioral expectations (mode selection, build stages, skip detection).

## Prerequisites

- Node.js >= 22.6.0 (required for native `node:sqlite` — used to read the monitor DB)
- `eforge` on PATH (or set `EFORGE_BIN` to a local build)
- `pnpm` for dependency installation

## Commands

```bash
pnpm install                                              # Install dependencies
pnpm type-check                                           # TypeScript type-check (lib/**/*.ts)
./run.sh --backend claude-sdk --all                       # Run all scenarios with claude-sdk
./run.sh --backend claude-sdk <scenario-id>               # Run a single scenario
./run.sh --backend claude-sdk,pi-nemotron <scenario-id>   # Run with multiple backends (parallel)
./run.sh --backend claude-sdk --dry-run                   # Set up workspaces without running eforge
./run.sh --backend claude-sdk --env-file .env             # Source env vars (e.g. Langfuse credentials)
./run.sh --cleanup                                        # Remove all results
```

## Architecture

The harness is a TypeScript pipeline:

1. **`run.sh`** — Thin wrapper that delegates to `npx tsx lib/runner.ts`.
2. **`scenarios.yaml`** — Defines **what to build**: fixture, PRD, validation commands, and behavioral expectations. Contains no backend configuration.
3. **`eforge/backends/*.yaml`** — Defines **how to build**: one plain eforge [backend profile](../eforge/packages/engine/src/config.ts) file per backend (e.g. `claude-sdk.yaml`, `pi-nemotron.yaml`). Names come from filenames; selected at run time via `--backend`.
4. **`backend-envs.yaml`** — Maps backend names to env files (for API keys etc.). Backends without an entry here run without a custom env file.
5. **`lib/runner.ts`** — Main orchestrator. Cross-products scenarios with selected backends, groups backends of the same scenario for parallel execution, pins the backend profile into each workspace, runs eforge, validates, and checks expectations.
6. **`lib/build-result.ts`** — Builds `result.json` from eforge logs and the shared SQLite monitor DB (`results/monitor.db`). Extracts token usage, cost, phase durations, per-agent/per-model breakdowns, review metrics, and the backend profile used.
7. **`lib/check-expectations.ts`** — Checks scenario expectations (mode, build stages, skip) against monitor DB. Writes an `expectations` key into `result.json`.
8. **`lib/compare.ts`** — Side-by-side backend comparison across eight dimensions (cost, tokens, duration, etc.).

### Backend isolation

Eforge resolves the active backend profile via a 5-step precedence chain: project marker → project config → user marker (`~/.config/eforge/.active-backend`) → user config → none. The eval runner pins the selected backend at **step 1** by copying its profile into each temp workspace's `eforge/backends/` and writing `eforge/.active-backend`. This isolates eval results from whatever a developer has configured at user scope.

### Data flow

```
scenarios.yaml ────┐
                    ├─► runner.ts ─► cross-product ─► for each (scenario, backend):
eforge/backends/ ──┤                                    ├─ copy fixture to /tmp
backend-envs.yaml ─┘                                    ├─ copy backend profile + write .active-backend
                                                        ├─ eforge run <prd>
                                                        ├─ validation commands
                                                        ├─ build-result.ts (reads monitor.db)
                                                        ├─ check-expectations.ts
                                                        └─ results/<timestamp>/<id>/result.json
                                                     ─► summary.json + comparison.json
```

### Fixtures

Fixture projects live in `fixtures/<name>/` as plain source trees (no `.git`). Each scenario in `scenarios.yaml` references a fixture and a PRD file within it. The harness copies the fixture to a temp dir and initializes a fresh git repo before running eforge.

Current fixtures: `todo-api`, `workspace-api`, `notes-api`.

### Expectations

Scenarios can define `expect` in `scenarios.yaml` to assert behavioral properties:
- `mode` — expected orchestration mode (errand, excursion, expedition)
- `buildStagesContain` / `buildStagesExclude` — assert presence/absence of build stages
- `skip` — expect eforge to skip (PRD already satisfied)

### Results

Results are gitignored. Each run creates `results/<timestamp>/` containing per-scenario `result.json`, `eforge.log`, validation logs, and an aggregate `summary.json`. Old runs are pruned to keep the most recent 50. Each `result.json` records the backend name + full profile used for reproducibility.
