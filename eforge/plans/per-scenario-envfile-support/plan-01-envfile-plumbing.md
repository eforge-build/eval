---
id: plan-01-envfile-plumbing
name: Per-Scenario envFile Plumbing
dependsOn: []
branch: per-scenario-envfile-support/envfile-plumbing
---

# Per-Scenario envFile Plumbing

## Architecture Context

The eval harness uses a bash pipeline: `scenarios.yaml` → `parse_scenarios()` (TSV) → read loop in `run.sh` → `run_scenario()` in `lib/run-scenario.sh`. Per-scenario configuration already flows through this pipeline via `configOverlay` (7th TSV column, exported as `SCENARIO_CONFIG_OVERLAY`). The `envFile` field follows the identical pattern as an 8th TSV column exported as `SCENARIO_ENV_FILE`.

## Implementation

### Overview

Add an optional `envFile` field to `scenarios.yaml` entries that specifies a path (relative to the eval project root) to an env file sourced before the eforge invocation. Wire it through the TSV parsing pipeline in `run.sh` and source it in `lib/run-scenario.sh`.

### Key Decisions

1. **Follow the `configOverlay` pattern exactly** — add as 8th TSV column in `parse_scenarios()`, destructure in the read loop, export as `SCENARIO_ENV_FILE`. This maintains consistency with the existing per-scenario data flow.
2. **Source after global `--env-file` and before eforge invocation** — per-scenario env vars override global ones, matching the precedence described in the PRD.
3. **Fail fast on missing env file** — follow the existing fixture-not-found error pattern (lines 23-29 of `lib/run-scenario.sh`) with `write_error_result` and `return 1`.

## Scope

### In Scope
- Adding `envFile` field to the 5 `pi-*` scenarios in `scenarios.yaml`
- Propagating `envFile` as 8th TSV column through `run.sh`'s `parse_scenarios()` and read loop
- Exporting `SCENARIO_ENV_FILE` alongside existing `SCENARIO_CONFIG_OVERLAY`
- Sourcing the per-scenario env file in `lib/run-scenario.sh` before eforge invocation
- Error handling for missing env files
- Adding `env/` to `.gitignore`

### Out of Scope
- Creating `env/pi.env` with actual secrets (manual step, gitignored)
- Changes to `mcp-server/index.ts`
- Changes to non-PI scenarios
- Changes to TypeScript types (none exist; parsing is dynamic)

## Files

### Modify
- `scenarios.yaml` — Add `envFile: env/pi.env` to all 5 `pi-*` scenario entries (ids: `pi-todo-api-errand-health-check`, `pi-todo-api-errand-skip`, `pi-todo-api-excursion-jwt-auth`, `pi-notes-api-excursion-search`, `pi-workspace-api-excursion-engagement`)
- `run.sh` — Two changes: (1) In `parse_scenarios()` (line 24), add `envFile` as 8th TSV column: `const envFile = s.envFile || '';` and append to the `console.log` join. (2) In the read loop (line 383), add `env_file` to the destructure and export it as `SCENARIO_ENV_FILE` after line 385.
- `lib/run-scenario.sh` — Insert env file sourcing block after the `EFORGE_TRACE_TAGS` export (line 76) and before the eforge invocation (line 80). Use `set -a && source && set +a` with error handling for missing files.
- `.gitignore` — Add `env/` entry to gitignore the env directory

## Verification

- [ ] `grep -c 'envFile:' scenarios.yaml` returns `5` (only PI scenarios have the field)
- [ ] `parse_scenarios()` output contains 8 tab-separated columns (verify by running `bash -c 'source run.sh; parse_scenarios' | head -1 | awk -F'\t' '{print NF}'` returns 8) — or by inspecting the inline TypeScript `console.log` call has 8 array elements
- [ ] Running `./run.sh --dry-run pi-todo-api-errand-health-check` with `env/pi.env` containing `TEST_VAR=hello` prints "Sourcing env file: env/pi.env" in output
- [ ] Running `./run.sh --dry-run pi-todo-api-errand-health-check` WITHOUT `env/pi.env` on disk prints "ERROR: Scenario env file not found: env/pi.env" and writes an error result
- [ ] Running `./run.sh --dry-run todo-api-errand-health-check` (non-PI scenario, no envFile) completes without env file sourcing
- [ ] `grep 'env/' .gitignore` returns a match
- [ ] `pnpm type-check` passes with no regressions
