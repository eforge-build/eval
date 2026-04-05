---
title: Side-by-Side Variant Comparison Analysis for Eval Harness
created: 2026-04-05
---

# Side-by-Side Variant Comparison Analysis for Eval Harness

## Problem / Motivation

The eval harness runs the same fixture+PRD scenarios across different backends/models (claude-sdk, pi/nemotron, pi/codex, pi/gemma4). Today, results are produced per-scenario but there is no mechanism to compare variants of the same eval side-by-side. The monitor DB already captures rich metrics — tokens, cost, timing, per-agent/per-model breakdowns, review quality, tool usage — sufficient for structured comparison without inspecting generated code.

Additionally, the codebase has accumulated duplicated type definitions across `analyze.ts` and `build-result.ts`, and scenario parsing is done via inline `node -e` calls in bash. There is a desire to lay groundwork for eventual migration from bash to TypeScript and to enable optional LLM-assisted narrative insights on comparison data.

## Goal

Create a comparison module that groups eval results by fixture+PRD, compares variants across multiple dimensions (pass/fail, cost, tokens, duration, cache efficiency, agent breakdown, review quality, tool usage), and outputs structured JSON plus a human-readable table — while also extracting shared types and creating a reusable scenario loader as foundational steps toward a bash-to-TypeScript migration.

## Approach

Create a new `lib/compare.ts` module following the same pattern as `lib/analyze.ts` (shebang entry point, pure functions, writes JSON + prints table). Extract shared types first into `lib/types.ts`. Create a shared scenario YAML loader in `lib/scenarios.ts` as the first piece of the bash→TS migration. Expose comparison results via a new MCP tool for interactive LLM-assisted narrative insights rather than adding a separate API call module.

### Key Technical Decisions

1. **Group by fixture+PRD (inferred)** rather than requiring explicit YAML changes. Optional `compareGroup` field available for overrides.
2. **Variant labels auto-derived** from `configOverlay.backend` + model ID. Optional `variantLabel` field available for overrides.
3. **Compare.ts prints its own table** rather than delegating formatting to bash — aligns with TS migration direction.
4. **LLM insights via MCP tool** (interactive) rather than a separate API call module — simpler, no new dependency, leverages existing Claude Code session.
5. **result.json not modified** — comparison module joins result data with scenario YAML at comparison time. Enriching result.json with fixture/prd metadata is a possible follow-up.

### Implementation Steps

#### Step 1: Extract shared types → `lib/types.ts`

Move duplicated interfaces from `analyze.ts` and `build-result.ts` into a shared module:
- `AgentAggregate`, `ModelAggregate`, `ReviewMetrics`, `ScenarioMetrics`, `ExpectationCheck`, `ScenarioResult`
- `Severity`, `Observation`, `Trend` (analysis-specific but useful to share)

Update imports in:
- `lib/analyze.ts` (lines 14–66)
- `lib/build-result.ts` (lines 34–57+)

#### Step 2: Create scenario loader → `lib/scenarios.ts`

A shared YAML parser that returns typed scenario metadata. This is the first piece of the bash→TS migration since `run.sh` currently parses scenarios via inline `node -e` calls.

```typescript
interface ScenarioMeta {
  id: string;
  fixture: string;
  prd: string;
  compareGroup?: string;     // explicit override
  variantLabel?: string;     // explicit override
  configOverlay?: {
    backend?: string;
    agents?: { models?: { max?: string | { provider?: string; id?: string } } };
  };
}

function loadScenarios(yamlPath: string): ScenarioMeta[]
function deriveGroupId(s: ScenarioMeta): string      // → "todo-api::docs/add-health-check.md"
function deriveVariantLabel(s: ScenarioMeta): string  // → "claude-sdk" or "pi/nemotron"
```

Uses the `yaml` package already in devDependencies.

#### Step 3: Create comparison module → `lib/compare.ts`

**Grouping**: Load scenarios from YAML, load `result.json` files from the run dir, group by `compareGroup` or inferred `(fixture, prd)`. Skip groups with <2 variants.

**Dimension comparisons** (each a pure function returning a `ComparisonDimension`):
- `comparePassFail()` — which variants passed/failed
- `compareCost()` — cost ranking, best/worst delta (handle $0 gracefully)
- `compareTokens()` — total and input/output breakdown
- `compareDuration()` — wall-clock time ranking
- `compareCacheEfficiency()` — cacheRead/input ratio
- `compareAgentBreakdown()` — per-agent token/cost distribution
- `compareReviewQuality()` — issue count, severity distribution, accept/reject
- `compareToolUsage()` — tool invocation patterns

**Output**:
- Writes `comparison.json` to the run directory (alongside `analysis.json`)
- Prints a human-readable comparison table to stdout

**CLI**: `npx tsx lib/compare.ts <run-dir> <scenarios-yaml-path>`

#### Step 4: Integrate into `run.sh`

After line 588 (the analysis block), add:

```bash
echo ""
echo "Running variant comparison..."
npx tsx "$SCRIPT_DIR/lib/compare.ts" "$run_dir" "$SCENARIOS_FILE" 2>/dev/null || true
```

No new flags — runs automatically, is a no-op when no comparison groups exist.

#### Step 5: Add `eval_compare` MCP tool

In `mcp-server/index.ts`, add a tool that reads and returns `comparison.json` for a given run timestamp. This lets a Claude Code session generate LLM narrative insights on-the-fly from the structured data, without needing a separate API call in the harness itself.

### Edge Cases

- **Partial runs** (filtered scenarios): groups with <2 variants are silently skipped.
- **$0 cost models**: use absolute difference, not ratio, when one variant is free.
- **Different agent names across backends**: show each variant's agent breakdown independently rather than trying to align by role.

### Key Files

| File | Action |
|------|--------|
| `lib/types.ts` | **Create** — shared type definitions |
| `lib/scenarios.ts` | **Create** — YAML loader + grouping/label derivation |
| `lib/compare.ts` | **Create** — comparison engine + CLI entry point |
| `lib/analyze.ts` | **Modify** — import types from `lib/types.ts` |
| `lib/build-result.ts` | **Modify** — import types from `lib/types.ts` |
| `run.sh` | **Modify** — add comparison invocation after line 588 |
| `mcp-server/index.ts` | **Modify** — add `eval_compare` tool |
| `scenarios.yaml` | **No change** — optional fields can be added later per-scenario |

## Scope

### In Scope

- Extract shared TypeScript type definitions into `lib/types.ts`
- Create a reusable scenario YAML loader in `lib/scenarios.ts` with group/label derivation
- Build a comparison module (`lib/compare.ts`) that groups variants by fixture+PRD and compares across eight dimensions: pass/fail, cost, tokens, duration, cache efficiency, agent breakdown, review quality, and tool usage
- Output `comparison.json` and a human-readable table to stdout
- Integrate comparison invocation into `run.sh` (automatic, no-op when no groups exist)
- Add an `eval_compare` MCP tool to expose comparison results interactively

### Out of Scope

- **`lib/compare-insights.ts`** (headless LLM-generated narrative insights module) — deferred to future work. The MCP tool achieves the same thing interactively without adding `@anthropic-ai/sdk` as a dependency.
- Modifying `result.json` schema — comparison module joins result data with scenario YAML at comparison time; enriching result.json with fixture/prd metadata is a possible follow-up.
- Changes to `scenarios.yaml` — optional `compareGroup` and `variantLabel` fields can be added later per-scenario but are not required now (auto-inference handles it).
- Full bash-to-TypeScript migration of `run.sh` — only the scenario loader is migrated in this effort.

## Acceptance Criteria

1. **Type-check passes**: `pnpm type-check` succeeds with all new and modified TypeScript files (`lib/types.ts`, `lib/scenarios.ts`, `lib/compare.ts`, `lib/analyze.ts`, `lib/build-result.ts`).
2. **Full eval produces comparison output**: Running `./run.sh` results in `comparison.json` appearing in the results directory and a comparison table printed to stdout after the analysis block.
3. **Filtered multi-variant eval shows group comparison**: Running `./run.sh todo-api-errand-health-check pi-todo-api-errand-health-check` (two variants of the same fixture+PRD) produces comparison output showing the group.
4. **Single-scenario eval silently skips comparison**: Running `./run.sh todo-api-errand-health-check` completes without comparison output and without errors (groups with <2 variants are silently skipped).
5. **MCP tool returns comparison data**: Running `pnpm mcp-server` and calling the `eval_compare` tool with a valid run timestamp returns the contents of `comparison.json`.
6. **Shared types are used consistently**: `lib/analyze.ts` and `lib/build-result.ts` import type definitions from `lib/types.ts` with no remaining duplicated interface definitions.
7. **Scenario loader correctly derives groups and labels**: `deriveGroupId` produces `"<fixture>::<prd>"` format; `deriveVariantLabel` extracts backend/model info from `configOverlay`; explicit `compareGroup`/`variantLabel` overrides take precedence when present.
8. **$0 cost edge case handled**: When one variant has $0 cost, the cost comparison uses absolute difference rather than ratio.
9. **No new dependencies required**: The implementation uses the `yaml` package already in devDependencies; no new packages are added.
