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
pnpm install                          # Install dependencies
pnpm type-check                       # TypeScript type-check (lib/**/*.ts)
./run.sh                              # Run all scenarios
./run.sh <scenario-id>                # Run a single scenario by ID
./run.sh --dry-run                    # Set up workspaces without running eforge
./run.sh --env-file .env              # Source env vars (e.g. Langfuse credentials)
./run.sh --cleanup                    # Remove all results
```

## Architecture

The harness is a bash-driven pipeline with TypeScript helpers for structured result building:

1. **`run.sh`** — Entry point. Parses `scenarios.yaml` via `npx tsx`, iterates scenarios, writes `results/<timestamp>/summary.json`, prints a summary table.
2. **`lib/run-scenario.sh`** — Sourced by `run.sh`. Per-scenario logic: copies fixture to `/tmp/`, inits a git repo, runs `eforge run <prd> --auto --verbose --foreground --no-monitor`, runs validation commands, preserves `orchestration.yaml`.
3. **`lib/build-result.ts`** — Builds `result.json` from eforge logs and the shared SQLite monitor DB (`results/monitor.db`). Extracts token usage, cost, phase durations, per-agent/per-model breakdowns, and review metrics from monitor events.
4. **`lib/check-expectations.ts`** — Checks scenario expectations (mode, build stages, skip) against `orchestration.yaml` and monitor DB. Writes an `expectations` key into `result.json`.

### Data flow

```
scenarios.yaml → run.sh → run_scenario() → eforge (in /tmp workspace)
                                          → validation commands
                                          → build-result.ts (reads monitor.db)
                                          → check-expectations.ts (reads orchestration.yaml)
                                          → results/<timestamp>/<scenario>/result.json
                           → summary.json
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

Results are gitignored. Each run creates `results/<timestamp>/` containing per-scenario `result.json`, `eforge.log`, validation logs, and an aggregate `summary.json`. Old runs are pruned to keep the most recent 50.
