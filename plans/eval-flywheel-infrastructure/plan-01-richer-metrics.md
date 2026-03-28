---
id: plan-01-richer-metrics
name: Richer Metric Extraction
depends_on: []
branch: eval-flywheel-infrastructure/richer-metrics
---

# Richer Metric Extraction

## Architecture Context

The eval harness captures rich event data in the monitor SQLite DB but `build-result.ts` only extracts aggregate counts for reviews and evaluations. This plan extends the extraction to include review issue details, evaluation verdict details, and per-agent tool usage summaries. These richer metrics form the foundation for the analysis layer in subsequent plans.

## Implementation

### Overview

Extend `lib/build-result.ts` to extract three new data categories from the monitor DB's existing event JSON:
1. Review issue details from `build:review:complete` events
2. Evaluation verdict details from `build:evaluate:complete` events
3. Tool usage summaries from `agent:tool_use` events

All new fields are added to the `Metrics` interface and populated in `extractMetrics()`.

### Key Decisions

1. **Review issues omit the `fix` field** to keep `result.json` compact. The `fix` field contains large code diffs that inflate file size without adding analytical value. Only `severity`, `category`, `file`, and `description` are kept.
2. **Evaluation verdict extraction is defensive** — the eforge event schema may not yet carry per-verdict detail. Extract `{ file, action, reason }` when present; produce an empty array when the data shape doesn't match. No errors on missing data.
3. **Tool usage is keyed `Record<string, Record<string, number>>`** (agent role -> tool name -> call count). This mirrors the existing `agents` aggregation pattern and enables per-agent tool analysis in the analysis layer.

## Scope

### In Scope
- Adding `reviewIssues` array to the `Metrics` interface with `{ severity, category, file, description }` per issue
- Adding `evaluationVerdicts` array to the `Metrics` interface with `{ file, action, reason }` per verdict (gracefully empty when data unavailable)
- Adding `toolUsage: Record<string, Record<string, number>>` to the `Metrics` interface
- Querying `agent:tool_use` events from the monitor DB and aggregating by agent role and tool name
- Extracting per-issue detail from the existing `build:review:complete` event data (which already contains the `ReviewIssue[]` array)
- Extracting per-verdict detail from `build:evaluate:complete` event data when available

### Out of Scope
- Changes to `run.sh` or `run-scenario.sh`
- New TypeScript modules (analyze.ts, history.ts)
- MCP server
- Changes to summary.json aggregation

## Files

### Modify
- `lib/build-result.ts` — Add `ReviewIssueDetail`, `EvaluationVerdict` interfaces; extend `Metrics` interface with `reviewIssues`, `evaluationVerdicts`, `toolUsage` fields; add extraction logic in `extractMetrics()` for `build:review:complete` issue details, `build:evaluate:complete` verdict details, and `agent:tool_use` tool counts

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] The `Metrics` interface contains a `reviewIssues` field typed as `Array<{ severity: string; category: string; file: string; description: string }>`
- [ ] The `Metrics` interface contains an `evaluationVerdicts` field typed as `Array<{ file: string; action: string; reason: string }>`
- [ ] The `Metrics` interface contains a `toolUsage` field typed as `Record<string, Record<string, number>>`
- [ ] The `extractMetrics` function queries `agent:tool_use` events and aggregates counts by agent role and tool name
- [ ] The `extractMetrics` function extracts per-issue `{ severity, category, file, description }` from `build:review:complete` event data and does NOT include the `fix` field
- [ ] The `extractMetrics` function extracts per-verdict `{ file, action, reason }` from `build:evaluate:complete` event data; when verdict detail is missing from the event JSON, the `evaluationVerdicts` array is empty (no errors thrown)
- [ ] The return value of `extractMetrics` includes all three new fields in the returned object
