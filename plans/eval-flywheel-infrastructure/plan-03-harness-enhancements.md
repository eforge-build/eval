---
id: plan-03-harness-enhancements
name: Harness Enhancements
depends_on: [plan-02-analysis-history]
branch: eval-flywheel-infrastructure/harness-enhancements
---

# Harness Enhancements

## Architecture Context

With the analysis and history modules built, this plan integrates them into the harness pipeline and adds two new flags (`--repeat N` and `--compare <timestamp>`) to `run.sh`. The `--repeat` flag enables statistical confidence by running each scenario multiple times, while `--compare` enables regression detection against a prior run. Post-summary, the analysis module runs automatically and observations are printed.

## Implementation

### Overview

Three changes to the harness:
1. **`--repeat N` flag** — Run each scenario N times with sub-directory result storage and aggregate pass rate
2. **`--compare <timestamp>` flag** — Load a baseline run's summary and print a comparison table
3. **Analysis integration** — After summary, invoke `analyze.ts` and print warning/attention observations

### Key Decisions

1. **Repeat sub-directory structure**: Each repeat gets `<scenario-id>/run-<N>/result.json`. The scenario-level `result.json` becomes an aggregate containing `passRate` and references to individual runs. This preserves backward compatibility — a single run (repeat=1) still produces `<scenario-id>/result.json` at the top level (no sub-directory).
2. **Pass rate reporting**: The summary table shows "2/3" style pass rates when repeat > 1, and the existing PASS/FAIL when repeat = 1. `summary.json` gains a `passRate` field per scenario.
3. **Compare table**: Printed after the normal summary. Shows scenario-by-scenario regression/improvement status, cost delta (absolute and percentage), and token efficiency delta.
4. **Analysis runs after summary but before compare** so observations can inform the comparison context.
5. **`run-scenario.sh` remains unchanged** — the repeat loop lives in `run.sh`'s main loop. Each repeat calls `run_scenario()` with a different output directory.

## Scope

### In Scope
- `--repeat N` flag parsing in `run.sh` (default 1)
- Repeat loop in `run.sh` main scenario iteration
- Sub-directory structure for repeat results (`<scenario-id>/run-<N>/result.json`)
- Aggregate result.json at scenario level with `passRate` field
- `passRate` field in `summary.json` per scenario
- `eforgeCommit` field added to `summary.json` (needed by `history.ts` in plan-02; currently only present in individual `result.json` files)
- Summary table updated to show pass rate when repeat > 1
- `--compare <timestamp>` flag parsing in `run.sh`
- Comparison table printing (regressions, improvements, cost deltas, token efficiency deltas)
- Post-summary invocation of `npx tsx lib/analyze.ts <run-dir>`
- Printing warning/attention observations from analysis.json after summary
- Help text updated with new flags

### Out of Scope
- Changes to `build-result.ts`
- Changes to `analyze.ts` or `history.ts` (already built in plan-02)
- MCP server

## Files

### Modify
- `run.sh` — Add `--repeat N` and `--compare <timestamp>` argument parsing; add repeat loop wrapping `run_scenario()` calls with sub-directory management; add scenario-level aggregate result.json generation (with `passRate`); add `passRate` and `eforgeCommit` to summary.json per scenario; update `print_summary()` to show pass rate when repeat > 1; add `print_comparison()` function for `--compare` output; add post-summary `analyze.ts` invocation; add observations printing from `analysis.json`; update help text

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `./run.sh --help` shows `--repeat N` and `--compare <timestamp>` in the help output
- [ ] When `--repeat 1` (or no flag), the result directory structure is unchanged: `<scenario-id>/result.json` at the top level with no `run-N` sub-directories
- [ ] When `--repeat 3` is used, each scenario has `<scenario-id>/run-1/result.json`, `<scenario-id>/run-2/result.json`, `<scenario-id>/run-3/result.json` sub-directories
- [ ] When `--repeat 3` is used, a scenario-level aggregate `<scenario-id>/result.json` exists with a `passRate` field (e.g., `0.67` for 2/3 passes)
- [ ] The `summary.json` contains a `passRate` field per scenario when `--repeat` > 1
- [ ] The summary table prints pass rate as "N/M" format (e.g., "2/3") when repeat > 1
- [ ] `--compare <timestamp>` loads `results/<timestamp>/summary.json` and prints a comparison table to stdout
- [ ] The comparison table shows scenarios that regressed (passed before, failed now) and scenarios that improved (failed before, passed now)
- [ ] The comparison table shows cost delta (total and per-scenario) and token efficiency delta
- [ ] After the summary table, `analyze.ts` is invoked and `analysis.json` is written to the run directory
- [ ] Warning and attention severity observations from `analysis.json` are printed to stdout after the summary
