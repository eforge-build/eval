---
title: Eval Flywheel Infrastructure
created: 2026-03-28
status: pending
---

# Eval Flywheel Infrastructure

## Problem / Motivation

The eval harness currently captures rich metrics per scenario (tokens, cost, duration, pass/fail, review issues, per-agent breakdowns) but results are terminal — there is no analysis, no queryability, and no feedback loop. This means valuable signal in the monitor DB goes unexamined, patterns across runs are invisible, and there is no way for Claude Code to interact with eval data or kick off runs programmatically.

## Goal

Add an analysis layer, MCP server, and harness enhancements to the eval repo so that eval results are queryable from Claude Code and programmatic pattern detection runs after every sweep.

## Approach

Three layers of capability are added:

1. **Richer signal extraction** — Extend `lib/build-result.ts` to pull review issue details, evaluation verdict details, and tool usage summaries from the monitor SQLite DB's existing event JSON into `result.json`.
2. **Programmatic pattern detection** — A new `lib/analyze.ts` module with pure-function detectors (review calibration, cost efficiency, profile selection, temporal regression) that run after each eval sweep, producing `analysis.json`. A companion `lib/history.ts` module provides cross-run trend data by scanning the `results/` directory.
3. **MCP server** — A new MCP server (using `@modelcontextprotocol/sdk`) exposes tools for running evals, querying results, viewing observations, and pulling trend data, making all eval data accessible from Claude Code sessions.
4. **Harness enhancements** — `run.sh` gains `--repeat N` and `--compare <timestamp>` flags for statistical confidence and regression detection.

### 1. Extend `lib/build-result.ts` — Richer Metric Extraction

The monitor SQLite DB already stores full event JSON. Currently `build-result.ts` only extracts aggregate counts. Extend it to also extract:

**Review issue details** from `build:review:complete` events:
- The event data already contains the full `ReviewIssue[]` array with `{ severity, category, file, description, fix }`
- Add a `reviewIssues` array to the metrics in `result.json` containing `{ severity, category, file, description }` for each issue (omit `fix` text to keep results compact)

**Evaluation verdict details** from `build:evaluate:complete` events:
- Currently only extracts `accepted`/`rejected` counts
- Also extract per-verdict detail if available: `{ file, action, reason }` (the eforge event may or may not carry this yet — extract what's there, gracefully handle missing data)

**Tool usage summary** from `agent:tool_use` events:
- Per-agent-role: list of tools used and call count
- Add `toolUsage: Record<string, Record<string, number>>` to metrics (keyed by agent role, then tool name)

### 2. Create `lib/analyze.ts` — Programmatic Pattern Detectors

New TypeScript module. Reads all `result.json` files from a run directory (and optionally from prior runs via history). Produces `analysis.json` alongside `summary.json`.

**Types:**

```typescript
interface Observation {
  detector: string;       // e.g., "review-calibration"
  signal: string;         // e.g., "high-reject-ratio"
  severity: 'info' | 'warning' | 'attention';
  value: number | string;
  context: Record<string, unknown>;  // supporting data
  message: string;        // human-readable explanation
}

interface AnalysisReport {
  runTimestamp: string;
  eforgeVersion: string;
  scenarioCount: number;
  observations: Observation[];
  trends: Trend[];  // only populated when history available
}

interface Trend {
  metric: string;
  direction: 'improving' | 'stable' | 'degrading';
  values: Array<{ timestamp: string; value: number }>;
}
```

**Detectors** (each is a pure function: `(results: ScenarioResult[]) => Observation[]`):

1. **Review calibration**: Compute `rejectRatio = rejected / (accepted + rejected)` across all scenarios. Flag if > 0.5. Compute severity distribution — flag if > 80% of issues are a single severity. Flag scenarios with zero review issues (potential under-review).

2. **Cost efficiency**: Compute per-agent cost share as percentage of total. Flag any agent consuming > 40%. Compute cache hit rate per agent (`cacheRead / input`) — flag if < 20%. Compute tokens-per-turn per agent — flag outliers (> 2x the median for that role across scenarios).

3. **Profile selection**: Count profile selections across scenarios. Flag expectation mismatches (where `expectations.checks` for mode failed). Identify recurring custom profile names — flag any name appearing 3+ times as a builtin candidate.

4. **Temporal regression** (requires history): Compare current run's pass rate and cost to the previous run. Flag any scenario that passed before but fails now. Flag cost increases > 20%.

**Integration into `run.sh`:** After printing the summary table, invoke `analyze.ts` with the run directory path. Print a concise "Observations" section showing any `warning` or `attention` severity items.

### 3. Create `lib/history.ts` — Cross-Run History Index

Scans the `results/` directory for timestamped run directories. For each, reads `summary.json` and extracts: timestamp, eforgeVersion, eforgeCommit, passed count, total count, total cost. Writes `results/history.json`.

Rebuilt from scratch each time (no incremental updates — the directory IS the source of truth). Called by `analyze.ts` when it needs trend data.

```typescript
interface HistoryEntry {
  timestamp: string;
  eforgeVersion: string;
  eforgeCommit: string;
  passed: number;
  total: number;
  costUsd: number;
}

interface History {
  runs: HistoryEntry[];
}
```

### 4. Harness Enhancements to `run.sh`

**`--repeat N` flag:** Run each scenario N times (default 1, as today). For each scenario, report pass rate (e.g., "2/3") rather than single binary. In `summary.json`, add `passRate` field per scenario alongside existing pass/fail. Each repeat gets its own `result.json` in a sub-directory (e.g., `<scenario-id>/run-1/result.json`, `<scenario-id>/run-2/result.json`). The scenario-level `result.json` becomes an aggregate.

**`--compare <timestamp>` flag:** After the current run completes, load the baseline run's `summary.json` and diff:
- Scenarios that regressed (passed in baseline, failed now)
- Scenarios that improved (failed in baseline, passed now)
- Cost delta (total and per-scenario)
- Token efficiency delta

Print a comparison table after the normal summary.

### 5. MCP Server

New MCP server in the eval repo (e.g., `mcp-server/` directory or `lib/mcp-server.ts`). Uses the MCP SDK (`@modelcontextprotocol/sdk`).

**Tools:**

- **`eval_run`** — Start an eval run. Parameters: `scenarios` (optional `string[]` to filter), `repeat` (optional number, default 1), `compare` (optional timestamp string for baseline comparison). Spawns `run.sh` as a subprocess with appropriate flags. Returns `{ runId: string, status: 'started' }` immediately since evals are long-running.

- **`eval_run_status`** — Check status of a running or completed eval. Parameters: `runId` (string). Returns status (`running`/`completed`/`failed`), and if completed, the summary stats and path to results.

- **`eval_runs`** — List available completed runs. No required parameters. Returns array of `{ timestamp, eforgeVersion, passed, total, costUsd }`.

- **`eval_results`** — Get scenario results for a run. Parameters: `timestamp` (string), `compare` (optional timestamp for side-by-side diff). Returns scenario results array, or if comparing, a diff with regressions/improvements highlighted.

- **`eval_observations`** — Get programmatic detector output. Parameters: `timestamp` (string). Returns the `analysis.json` observations for that run.

- **`eval_scenario_detail`** — Drill into a specific scenario. Parameters: `timestamp` (string), `scenario` (string). Returns full detail: review issues with categories, evaluation verdicts, agent metrics, tool usage, validation results, duration breakdown.

- **`eval_history`** — Trend data. Parameters: `metric` (string, e.g., `"passRate"`, `"costUsd"`, `"cacheHitRate"`), `limit` (optional number of recent runs). Returns time series.

The server should be configurable via `.mcp.json` in the eforge project (since that's where Claude Code sessions run). The server path points to the eval repo.

## Scope

### In Scope

- Extending `lib/build-result.ts` to extract review issue details, evaluation verdict details, and tool usage summaries into `result.json`
- New `lib/analyze.ts` module with four pattern detectors (review calibration, cost efficiency, profile selection, temporal regression) producing `analysis.json`
- New `lib/history.ts` module for cross-run history index (`results/history.json`)
- `--repeat N` flag on `run.sh` with per-repeat sub-directories and aggregate pass rate reporting
- `--compare <timestamp>` flag on `run.sh` with regression/improvement/cost diff table
- New MCP server with seven tools (`eval_run`, `eval_run_status`, `eval_runs`, `eval_results`, `eval_observations`, `eval_scenario_detail`, `eval_history`)
- Integration of analysis output into `run.sh` post-summary

### Out of Scope

N/A

## Acceptance Criteria

- Running the existing eval suite produces `result.json` files that now include a `reviewIssues` array (with `severity`, `category`, `file`, `description` per issue) and a `toolUsage` map (keyed by agent role, then tool name → call count).
- Evaluation verdict details (`{ file, action, reason }`) are extracted when present in eforge events; missing data is handled gracefully without errors.
- Running `analyze.ts` against existing results produces an `analysis.json` with well-formed `Observation` objects; observations make sense given the data.
- Running with `--repeat 3` on a single scenario reports pass rate (e.g., "2/3"), creates sub-directories (`<scenario-id>/run-1/result.json`, etc.), and populates `passRate` in `summary.json`.
- Running with `--compare <timestamp>` against a prior run prints a comparison table showing regressions, improvements, cost deltas, and token efficiency deltas.
- The MCP server starts successfully and each tool (`eval_run`, `eval_run_status`, `eval_runs`, `eval_results`, `eval_observations`, `eval_scenario_detail`, `eval_history`) returns correct responses when called manually.
- Integration test: `eval_run` kicks off a single-scenario run, `eval_run_status` can be polled until complete, and results are then accessible via `eval_results` and `eval_scenario_detail`.
- The `run.sh` post-summary output includes a concise "Observations" section showing any `warning` or `attention` severity items from the analysis.
- `lib/history.ts` correctly scans `results/` for timestamped run directories, rebuilds `results/history.json` from scratch, and the temporal regression detector uses this data for trend comparisons.
