---
id: plan-02-analysis-history
name: Analysis and History Modules
depends_on: [plan-01-richer-metrics]
branch: eval-flywheel-infrastructure/analysis-history
---

# Analysis and History Modules

## Architecture Context

With richer metrics now available in `result.json` (review issues, verdicts, tool usage), this plan creates the programmatic analysis layer. Two new TypeScript modules provide pattern detection across scenario results and cross-run trend tracking. These modules are pure functions with no side effects beyond file I/O, making them testable and composable.

## Implementation

### Overview

Create two new TypeScript modules:
1. `lib/analyze.ts` — Reads all `result.json` files from a run directory, runs four pattern detectors, and writes `analysis.json` alongside `summary.json`
2. `lib/history.ts` — Scans `results/` for timestamped run directories, reads each `summary.json`, and writes `results/history.json`

Both are CLI scripts invocable via `npx tsx`.

### Key Decisions

1. **Detectors are pure functions** with signature `(results: ScenarioResult[]) => Observation[]`. This keeps them testable and composable. The temporal regression detector additionally accepts `History` for cross-run comparison.
2. **History is rebuilt from scratch each time** — no incremental updates. The `results/` directory IS the source of truth. This avoids stale index bugs at the cost of scanning ~50 directories (the max kept by pruning).
3. **`analyze.ts` calls `history.ts` internally** when it needs trend data for the temporal regression detector. The history module exports a `buildHistory()` function.
4. **ScenarioResult type mirrors the result.json shape** from `build-result.ts`. Rather than importing from build-result.ts (which is a CLI script, not a library), we define a compatible interface in analyze.ts that reads the JSON.
5. **Severity levels**: `info` for informational observations, `warning` for concerning patterns, `attention` for issues requiring human review.

## Scope

### In Scope
- `lib/analyze.ts` with four detectors: review calibration, cost efficiency, profile selection, temporal regression
- `lib/history.ts` with `buildHistory()` and CLI entry point
- `Observation`, `AnalysisReport`, `Trend`, `HistoryEntry`, `History` type definitions
- Writing `analysis.json` to the run directory
- Writing `results/history.json`
- Reading `result.json` and `summary.json` files

### Out of Scope
- Changes to `run.sh` (integration happens in plan-03)
- Changes to `build-result.ts`
- MCP server

## Files

### Create
- `lib/analyze.ts` — Pattern detection module with four detectors; CLI entry point accepts run directory path as argument; reads all `result.json` files from subdirectories; outputs `analysis.json`
- `lib/history.ts` — Cross-run history index; CLI entry point accepts results directory path; scans timestamped subdirectories for `summary.json`; outputs `results/history.json`; exports `buildHistory()` function for use by analyze.ts

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `lib/analyze.ts` is executable via `npx tsx lib/analyze.ts <run-dir>` and exits 0 when given a directory containing at least one subdirectory with a `result.json` file
- [ ] `lib/analyze.ts` writes `analysis.json` to the specified run directory
- [ ] The `analysis.json` output contains `runTimestamp`, `scenarioCount`, `observations` (array), and `trends` (array) fields
- [ ] Each observation in the output has `detector`, `signal`, `severity` (one of `info`/`warning`/`attention`), `value`, `context`, and `message` fields
- [ ] The review calibration detector flags when `rejectRatio > 0.5` across all scenarios
- [ ] The review calibration detector flags when > 80% of review issues share a single severity level
- [ ] The review calibration detector flags scenarios with zero review issues
- [ ] The cost efficiency detector flags any agent consuming > 40% of total cost
- [ ] The cost efficiency detector flags agents with cache hit rate (`cacheRead / inputTokens`) below 20%
- [ ] The profile selection detector flags expectation mismatches (scenarios where the `expectations.checks` for mode failed)
- [ ] The temporal regression detector compares current run pass rate and cost against the previous run from history when history data exists
- [ ] `lib/history.ts` is executable via `npx tsx lib/history.ts <results-dir>` and exits 0
- [ ] `lib/history.ts` writes `history.json` to the specified results directory containing a `runs` array
- [ ] Each entry in `history.json` has `timestamp`, `eforgeVersion`, `eforgeCommit`, `passed`, `total`, and `costUsd` fields
