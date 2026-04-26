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
pnpm install                                                  # Install dependencies
pnpm type-check                                               # TypeScript type-check (lib/**/*.ts)
./run.sh --profile claude-sdk-4-7 --all                       # Run all scenarios with the 4-7 SDK profile
./run.sh --profile claude-sdk-4-7 <scenario-id>               # Run a single scenario
./run.sh --profile claude-sdk-4-7,pi-anthropic-4-7 <scenario-id>  # Run with multiple profiles (parallel)
./run.sh --profile claude-sdk-4-7 --dry-run                   # Set up workspaces without running eforge
./run.sh --profile claude-sdk-4-7 --env-file .env             # Source env vars (e.g. Langfuse credentials)
./run.sh --profile claude-sdk-4-7 --score-quality --all       # Add LLM-as-judge quality scoring (absolute + pairwise)
./run.sh --cleanup                                            # Remove all results
```

## Architecture

The harness is a TypeScript pipeline:

1. **`run.sh`** — Thin wrapper that delegates to `npx tsx lib/runner.ts`.
2. **`scenarios.yaml`** — Defines **what to build**: fixture, PRD, validation commands, and behavioral expectations. Contains no profile configuration.
3. **`eforge/profiles/*.yaml`** — Defines **how to build**: one plain eforge profile file per profile (e.g. `claude-sdk-4-7.yaml`, `pi-anthropic-4-7.yaml`). Names come from filenames; selected at run time via `--profile`.
4. **`profile-envs.yaml`** — Maps profile names to env files (for API keys etc.). Profiles without an entry here run without a custom env file. Accepts `envFiles: [...]` (list) or `envFile: <single>` (sugar) per entry.
5. **`lib/runner.ts`** — Main orchestrator. Cross-products scenarios with selected profiles, groups profiles of the same scenario for parallel execution, pins the profile into each workspace, runs eforge, validates, and checks expectations.
6. **`lib/build-result.ts`** — Builds `result.json` from eforge logs and the shared SQLite monitor DB (`results/monitor.db`). Extracts token usage, cost, phase durations, per-agent/per-model breakdowns, review metrics, and the profile used.
7. **`lib/check-expectations.ts`** — Checks scenario expectations (mode, build stages, skip) against monitor DB. Writes an `expectations` key into `result.json`.
8. **`lib/compare.ts`** — Side-by-side profile comparison across eight dimensions (cost, tokens, duration, etc.), plus an optional ninth `quality` dimension when `--score-quality` is set or when any input `result.json` already carries `quality.absolute`.
9. **`lib/score-quality.ts`** — LLM-as-judge module. `scoreAbsolute()` runs per scenario after expectations and before workspace cleanup; `scorePairwise()` runs from `compare.ts` for each scenario group with ≥2 profiles. Calls go through `@anthropic-ai/claude-agent-sdk`'s one-shot `query()` with tools disabled.

### Profile isolation

Eforge resolves the active profile via a 3-step precedence chain: project marker (`eforge/.active-profile`) → user marker (`~/.config/eforge/.active-profile`) → none. The eval runner pins the selected profile at **step 1** by copying its file into each temp workspace's `eforge/profiles/` and writing `eforge/.active-profile`. This isolates eval results from whatever a developer has configured at user scope.

### Data flow

```
scenarios.yaml ────┐
                    ├─► runner.ts ─► cross-product ─► for each (scenario, profile):
eforge/profiles/ ──┤                                    ├─ copy fixture to /tmp
profile-envs.yaml ─┘                                    ├─ copy profile + write .active-profile
                                                        ├─ eforge run <prd>
                                                        ├─ validation commands
                                                        ├─ build-result.ts (reads monitor.db)
                                                        ├─ check-expectations.ts
                                                        ├─ (--score-quality) snapshot prd.md + diff.patch
                                                        ├─ (--score-quality) score-quality.ts (absolute)
                                                        └─ results/<timestamp>/<id>/result.json
                                                     ─► summary.json + comparison.json
                                                        (compare.ts also runs pairwise quality scoring
                                                         when --score-quality is set or quality.absolute
                                                         is present in any input result.json)
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

Results are gitignored. Each run creates `results/<timestamp>/` containing per-scenario `result.json`, `eforge.log`, validation logs, and an aggregate `summary.json`. Old runs are pruned to keep the most recent 50. Each `result.json` records the profile name + full config used for reproducibility under `profile: { name, config, envFiles }`.

### Quality scoring (LLM-as-judge)

Opt-in with `--score-quality` on `run.sh`. Per scenario, an absolute rubric (PRD adherence, code quality, test quality, change discipline) is captured into `result.json.quality.absolute`. During `compare.ts`, profiles in the same scenario group are scored pairwise into `comparison.json.groups[].dimensions.quality`.

Snapshots (`<scenarioDir>/quality/{prd.md,diff.patch}`) are written before workspace cleanup, so `compare.ts` can re-score from an existing results dir without re-running eforge. Re-invoking `npx tsx lib/compare.ts <existing-results-dir> --score-quality` regenerates pairwise scores from those snapshots.

Auth: judge calls go through `@anthropic-ai/claude-agent-sdk`, which uses Claude Code's host auth (subscription if logged in) and falls back to `ANTHROPIC_API_KEY`. If neither is available, `scoreAbsolute()` throws an error naming both. Configuration lives in `judge.yaml` at the eval root (model, max output tokens, per-dimension weights summing to 1.0, `maxDiffBytes`). Diffs larger than `maxDiffBytes` are truncated with a `TRUNCATED` marker and `inputs.diffTruncated: true` is recorded. The judge runs with `allowedTools: []` so it has no file or shell access.
