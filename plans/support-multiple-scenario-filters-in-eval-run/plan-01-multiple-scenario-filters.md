---
id: plan-01-multiple-scenario-filters
name: Support Multiple Scenario Filters
depends_on: []
branch: support-multiple-scenario-filters-in-eval-run/multiple-scenario-filters
---

# Support Multiple Scenario Filters

## Architecture Context

The eval harness has a two-layer invocation path: `mcp-server/index.ts` accepts `scenarios: string[]` and spawns `run.sh` with positional args. Currently both layers only support a single scenario filter — the MCP server passes only `scenarios[0]`, and `run.sh` stores the positional arg in a scalar `filter` variable. This plan fixes both layers to support multiple scenario IDs end-to-end.

## Implementation

### Overview

Convert `run.sh` from a single `filter` string variable to a `filters` bash array, update argument parsing to append each positional arg, update scenario matching to check membership in the array, and update error messaging. In `mcp-server/index.ts`, spread all scenario IDs as positional args instead of passing only the first.

### Key Decisions

1. Use a bash array (`filters`) rather than a delimited string — cleaner iteration and membership checking, no delimiter collision risk.
2. Preserve backward compatibility: when no filters are provided, all scenarios run (empty array = no filtering).

## Scope

### In Scope
- `run.sh`: convert `filter` to `filters` array, update parsing, matching, help text, and error message
- `mcp-server/index.ts`: spread all scenario IDs as positional args, remove misleading comment

### Out of Scope
- Changes to `scenarios.yaml` format
- Changes to `run-scenario.sh` or result-building scripts
- Glob/regex pattern matching for scenario IDs

## Files

### Modify
- `run.sh` — Convert `filter` variable to `filters` array (line 271), update argument parsing to append (line 306), update help text (line 292), replace single-value filter check with array membership loop (lines 383-386), update "no scenario found" error to print full filter list (lines 505-508)
- `mcp-server/index.ts` — Replace `args.push(scenarios[0])` with `args.push(...scenarios)` (line 77), remove comment about only first being used (lines 74-75)

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `./run.sh --help` output contains `[SCENARIO_ID...]` (with ellipsis)
- [ ] `./run.sh --dry-run` with no filter argument sets up all scenarios (backward compatibility)
- [ ] `./run.sh --dry-run nonexistent` prints error message containing "No scenarios found matching: nonexistent"
- [ ] In `mcp-server/index.ts`, the `scenarios` array is spread with `...scenarios` (not indexed with `[0]`)
- [ ] `run.sh` line that was `filter="$1"` now reads `filters+=("$1")`
- [ ] `run.sh` scenario loop checks membership in the `filters` array using a loop, not a single string comparison
