---
id: plan-02-comparison-module-and-integration
name: Comparison Module, run.sh Integration, and MCP Tool
depends_on: [plan-01-shared-types-and-scenario-loader]
branch: side-by-side-variant-comparison-analysis-for-eval-harness/comparison-module-and-integration
---

# Comparison Module, run.sh Integration, and MCP Tool

## Architecture Context

With shared types in `lib/types.ts` and the scenario loader in `lib/scenarios.ts` (from plan-01), this plan builds the core comparison engine. The module groups eval results by fixture+PRD, compares variants across eight dimensions, outputs `comparison.json` and a human-readable table. It integrates into `run.sh` after the analysis block (line 589) and adds an MCP tool for interactive access.

The comparison module follows the same pattern as `lib/analyze.ts`: shebang entry point, pure functions, writes JSON + prints table. Each comparison dimension is a pure function returning a typed result, making the module testable and extensible.

## Implementation

### Overview

Create `lib/compare.ts` with grouping logic and eight dimension comparators. Integrate into `run.sh` as a no-op-safe invocation after analysis. Add `eval_compare` tool to `mcp-server/index.ts`.

### Key Decisions

1. **Grouping uses `deriveGroupId` from `lib/scenarios.ts`** — joins scenario YAML metadata with `result.json` files by matching scenario IDs. Groups with fewer than 2 variants are silently skipped (no output, no error).
2. **Each dimension comparator is a pure function** accepting an array of `{ label: string, result: ScenarioResult }` and returning a typed dimension result. This makes individual dimensions independently testable.
3. **Cost comparison uses absolute difference when any variant has $0 cost** — avoids division-by-zero in ratio calculations. When all variants have non-zero cost, also includes a ratio (cheapest as baseline).
4. **Agent breakdown shows each variant's agents independently** — does not attempt to align agents across backends since different backends may use different agent configurations. Each variant entry lists its agents with token/cost totals.
5. **Table output uses fixed-width columns** similar to the existing `print_summary` pattern in `run.sh` — scenario group header, then one row per variant per dimension. Color-coded pass/fail using ANSI escape codes.
6. **MCP tool `eval_compare`** takes a `timestamp` parameter (matching existing `eval_results` pattern) and returns the contents of `comparison.json`. Returns an error message if no comparison file exists (e.g., single-variant run).

### Comparison Output Schema

```typescript
interface ComparisonGroup {
  groupId: string;        // e.g., "todo-api::docs/add-health-check.md"
  fixture: string;
  prd: string;
  variants: string[];     // ordered variant labels
  dimensions: {
    passFail: PassFailComparison;
    cost: CostComparison;
    tokens: TokenComparison;
    duration: DurationComparison;
    cacheEfficiency: CacheEfficiencyComparison;
    agentBreakdown: AgentBreakdownComparison;
    reviewQuality: ReviewQualityComparison;
    toolUsage: ToolUsageComparison;
  };
}

interface ComparisonReport {
  runTimestamp: string;
  groupCount: number;
  groups: ComparisonGroup[];
}
```

Each dimension comparison follows a consistent pattern:
```typescript
interface VariantValue<T> {
  variant: string;
  value: T;
}

// Example: CostComparison
interface CostComparison {
  ranked: VariantValue<number>[];  // sorted cheapest-first
  bestVariant: string;
  worstVariant: string;
  absoluteDelta: number;           // worst - best
  ratio?: number;                  // worst/best (omitted when best is $0)
}
```

## Scope

### In Scope
- Create `lib/compare.ts` with grouping and eight dimension comparators
- Output `comparison.json` to the run directory
- Print a human-readable comparison table to stdout
- Integrate invocation into `run.sh` after line 589
- Add `eval_compare` MCP tool to `mcp-server/index.ts`

### Out of Scope
- LLM-generated narrative insights (the MCP tool enables this interactively via Claude Code)
- Modifications to `result.json` schema
- Changes to `scenarios.yaml` (auto-inference handles grouping)
- Headless `compare-insights.ts` module

## Files

### Create
- `lib/compare.ts` — Comparison engine with shebang entry point. CLI: `npx tsx lib/compare.ts <run-dir> <scenarios-yaml-path>`. Imports `ScenarioResult`, `ScenarioMetrics`, `AgentAggregate`, `ModelAggregate`, `ReviewMetrics` from `./types.js` and `loadScenarios`, `deriveGroupId`, `deriveVariantLabel` from `./scenarios.js`. Contains: `groupVariants()` (joins scenarios with results, groups by fixture+PRD), eight `compare*()` pure functions, `buildComparisonReport()` (orchestrates all dimensions), `printComparisonTable()` (ANSI-formatted table output), and a `main()` entry point that writes `comparison.json` and prints the table.

### Modify
- `run.sh` — Add 4 lines after line 589 (after the analysis `fi` block, before the `--compare` section): echo header, invoke `npx tsx "$SCRIPT_DIR/lib/compare.ts" "$run_dir" "$SCENARIOS_FILE"` with stderr suppressed and `|| true` for graceful failure.
- `mcp-server/index.ts` — Add `eval_compare` tool registration before the `// --- Start server ---` comment (line 341). Takes `timestamp: z.string()` parameter. Reads `comparison.json` from `results/<timestamp>/`. Returns JSON content or error if file doesn't exist. Follows the same pattern as `eval_observations` (lines 243–261).

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `npx tsx lib/compare.ts <run-dir-with-multi-variant-results> scenarios.yaml` writes `comparison.json` to the run directory and prints a table to stdout
- [ ] `comparison.json` contains a `groups` array where each group has `groupId`, `fixture`, `prd`, `variants`, and `dimensions` keys
- [ ] Running `npx tsx lib/compare.ts <run-dir-with-single-variant> scenarios.yaml` produces no `comparison.json` (no groups with ≥2 variants) and exits with code 0
- [ ] `run.sh` contains `lib/compare.ts` invocation between the analysis block (line ~589) and the `--compare` section (line ~591)
- [ ] The `run.sh` comparison invocation uses `|| true` so a compare failure does not abort the run
- [ ] `mcp-server/index.ts` registers an `eval_compare` tool that accepts a `timestamp` string parameter
- [ ] The `eval_compare` MCP tool returns `{ isError: true }` with an explanatory message when `comparison.json` does not exist for the given timestamp
- [ ] When a variant has `$0` cost and another has `$0.50` cost, the cost comparison's `absoluteDelta` is `0.5` and `ratio` is omitted (not `Infinity`)
- [ ] Groups with only 1 variant are excluded from `comparison.json` — the `groupCount` reflects only groups with ≥2 variants
- [ ] Each dimension comparator handles missing `metrics` on a `ScenarioResult` (e.g., when eforge failed before producing monitor data) by marking that variant as "no data" rather than crashing
