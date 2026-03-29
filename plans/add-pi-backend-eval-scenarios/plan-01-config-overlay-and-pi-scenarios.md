---
id: plan-01-config-overlay-and-pi-scenarios
name: Config Overlay Mechanism and Pi Backend Scenarios
depends_on: []
branch: add-pi-backend-eval-scenarios/config-overlay-and-pi-scenarios
---

# Config Overlay Mechanism and Pi Backend Scenarios

## Architecture Context

The eval harness runs eforge against fixture projects by copying them to `/tmp/`, initializing a git repo, and invoking `eforge run`. Currently there is no mechanism to inject configuration into the workspace before eforge runs. To test the Pi backend (which requires `backend: pi` in `eforge.yaml`), we need a config overlay mechanism that merges scenario-defined config into the fixture's `eforge.yaml` at runtime, without duplicating fixture directories.

## Implementation

### Overview

This plan adds three things:
1. A `configOverlay` field in `scenarios.yaml` that gets parsed, passed through the pipeline, and shallow-merged into `eforge.yaml` in the workspace before eforge runs.
2. Five Pi backend scenarios reusing existing fixtures (`todo-api`, `notes-api`, `workspace-api`).
3. `.env` added to `.gitignore` for OpenRouter credentials.

### Key Decisions

1. **Shallow merge** — The overlay replaces top-level keys in `eforge.yaml`. This matches the PRD's design and keeps the implementation simple. Deep merge is explicitly out of scope.
2. **Tab-separated field passing** — `configOverlay` is serialized as a JSON string and added as a 7th tab-separated field in `parse_scenarios()` output, following the existing pattern for `expect_json`.
3. **Environment variable for overlay** — `SCENARIO_CONFIG_OVERLAY` is exported so `run-scenario.sh` can access it. This follows the existing pattern of `DRY_RUN` and `ENV_FILE`.
4. **yaml package reuse** — The inline TypeScript for merging uses the `yaml` package already in `devDependencies`.

## Scope

### In Scope
- `configOverlay` field parsing in `run.sh` `parse_scenarios()`
- Passing `configOverlay` through to `run_scenario()` via environment variable
- Shallow-merging overlay into `eforge.yaml` in `lib/run-scenario.sh` (after fixture copy, before eforge run)
- Five Pi backend scenarios in `scenarios.yaml` (errand health-check, errand skip, excursion jwt-auth, excursion search, excursion engagement)
- Adding `.env` to `.gitignore`

### Out of Scope
- Deep merge of config overlays
- New fixture projects
- Modifying the scenario filter to support prefix matching (currently exact-match only; the PRD's `./run.sh pi-` example would require filter changes not in scope)
- Changes to `--compare` flag or analysis detectors
- Pi backend engine wiring in eforge itself (prerequisite, separate PRD)

## Files

### Modify
- `run.sh` — Update `parse_scenarios()` to extract `configOverlay` as a 7th TSV field (JSON string, or empty `{}`). Update the `while IFS` read loop to capture the 7th field. Export `SCENARIO_CONFIG_OVERLAY` before calling `run_scenario()`.
- `lib/run-scenario.sh` — After copying fixture to workspace (line 36) and before git init (line 41), add a block that checks `SCENARIO_CONFIG_OVERLAY` and shallow-merges it into `eforge.yaml` using inline TypeScript via `npx tsx -e`.
- `scenarios.yaml` — Append 5 Pi backend scenarios with `configOverlay: { backend: pi, pi: { provider: openrouter, model: anthropic/claude-sonnet-4 } }`.
- `.gitignore` — Add `.env` entry.

## Detail

### `parse_scenarios()` change in `run.sh`

Current output fields (6): `id \t fixture \t prd \t validate \t description \t expect_json`

New output fields (7): `id \t fixture \t prd \t validate \t description \t expect_json \t config_overlay_json`

The TypeScript inline script adds:
```javascript
const configOverlay = JSON.stringify(s.configOverlay || {});
console.log([s.id, s.fixture, s.prd, validate, s.description, expect, configOverlay].join('\t'));
```

### Main loop change in `run.sh`

The `while IFS` read changes from:
```bash
while IFS=$'\t' read -r id fixture prd validate description expect_json; do
```
to:
```bash
while IFS=$'\t' read -r id fixture prd validate description expect_json config_overlay_json; do
```

Before calling `run_scenario`, export the overlay:
```bash
export SCENARIO_CONFIG_OVERLAY="${config_overlay_json:-{}}"
```

### Config overlay application in `lib/run-scenario.sh`

Between fixture copy and git init, add:
```bash
# Step 1b: Apply config overlay (if any)
if [[ "${SCENARIO_CONFIG_OVERLAY:-}" != "{}" && -n "${SCENARIO_CONFIG_OVERLAY:-}" ]]; then
  echo "  Applying config overlay..."
  (cd "$workspace" && npx tsx -e "
    import { readFileSync, writeFileSync, existsSync } from 'fs';
    import { parse, stringify } from 'yaml';
    const base = existsSync('eforge.yaml') ? parse(readFileSync('eforge.yaml', 'utf8') || '{}') : {};
    const overlay = JSON.parse(process.argv[1]);
    writeFileSync('eforge.yaml', stringify({ ...base, ...overlay }));
  " "$SCENARIO_CONFIG_OVERLAY")
fi
```

Note: The `npx tsx -e` must run with cwd set to the workspace so file operations target the correct directory. The subshell `(cd "$workspace" && ...)` ensures this.

### Pi scenarios in `scenarios.yaml`

Five scenarios appended after existing scenarios, each with identical `configOverlay`:
```yaml
configOverlay:
  backend: pi
  pi:
    provider: openrouter
    model: anthropic/claude-sonnet-4
```

Expectations mirror their Claude SDK counterparts since mode selection is PRD-driven, not backend-driven.

### `.gitignore` addition

Add `.env` on a new line. This ensures OpenRouter API keys are never committed.

## Verification

- [ ] `parse_scenarios()` output includes 7 tab-separated fields for scenarios with `configOverlay`, and 7 fields (with `{}` as 7th) for scenarios without
- [ ] For a scenario with `configOverlay`, the workspace's `eforge.yaml` contains the merged `backend: pi` and `pi:` keys after overlay application
- [ ] For a scenario without `configOverlay`, no `eforge.yaml` is created or modified in the workspace (existing behavior preserved)
- [ ] If the fixture already has an `eforge.yaml` with `hooks` defined, the overlay preserves `hooks` (shallow merge only replaces top-level keys present in the overlay)
- [ ] `.env` appears in `.gitignore`
- [ ] `pnpm type-check` passes (no TypeScript errors in lib/ files)
- [ ] All 5 Pi scenario entries in `scenarios.yaml` have valid YAML syntax and parse without errors
- [ ] Running `./run.sh --dry-run pi-todo-api-errand-health-check` sets up the workspace with `eforge.yaml` containing `backend: pi`
