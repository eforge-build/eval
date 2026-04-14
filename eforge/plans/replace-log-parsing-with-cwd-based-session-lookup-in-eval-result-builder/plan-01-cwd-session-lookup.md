---
id: plan-01-cwd-session-lookup
name: Replace log-parsing with cwd-based session lookup
depends_on: []
branch: replace-log-parsing-with-cwd-based-session-lookup-in-eval-result-builder/cwd-session-lookup
---

# Replace log-parsing with cwd-based session lookup

## Architecture Context

The eval harness runs eforge against fixture projects in isolated workspaces (created via `mkdtempSync` in `lib/runner.ts:432`) and then reads the shared `results/monitor.db` SQLite database to extract per-run metrics. Today, `lib/build-result.ts` and `lib/check-expectations.ts` recover the current invocation's `run_id`s by regex-scraping `Run: <uuid>` lines from eforge's stdout log. When that log doesn't contain those lines (e.g., the variant crashed fast), a `hasFilter` ternary in every query silently degrades to an unfiltered scan of the shared DB — producing catastrophically inflated metrics (observed: 40.3M tokens / $44.25 for an 18-second failed run).

The eforge monitor schema already exposes the right correlation keys: each `runs` row has a `session_id` (one per `eforge run` invocation, spans all phases) and a `cwd` (the workspace the invocation ran in). Since the eval runner guarantees a unique workspace per variant via `mkdtempSync`, `cwd → session_id → run_ids` is a deterministic lookup.

This plan replaces the log-parsing path with that lookup and removes the `hasFilter` / unfiltered-query fallback by construction.

## Implementation

### Overview

1. Introduce and export a `resolveRunIds(dbPath, workspace)` helper from `lib/build-result.ts`.
2. Refactor `extractMetrics` to early-return `undefined` when `runIds` is empty and unconditionally bind `...runIds` on every query (delete `hasFilter` ternaries at lines 47, 59, 122, 162, 190, 217).
3. Replace the log-regex block in `buildResult` with a call to `resolveRunIds` using the new required `workspace` opt; populate `langfuseTraceId` and `eforgeSessionId` from the resolved `sessionId`.
4. Refactor `lib/check-expectations.ts` symmetrically: accept `workspace` instead of `runIds`, import the shared `resolveRunIds`, drop every `hasFilter` branch in `readPipelineEvent` and `hasSkipEvent`.
5. Update `lib/runner.ts`: delete the log-parse block at lines 499-508, pass `workspace` into `buildResult` and `checkExpectations`.
6. Add optional `eforgeSessionId?: string` to `ScenarioResult` in `lib/types.ts`.
7. Update CLI entry points in `build-result.ts` and `check-expectations.ts` to accept `workspace` as a required positional argument (replacing optional trailing run-id args in check-expectations).

### Key Decisions

1. **Export `resolveRunIds` from `build-result.ts` and import in `check-expectations.ts`** — avoids duplicating the DB lookup helper across two files. Matches the spec's preference for a shared export.
2. **`workspace` is required on `BuildResultOpts` and `CheckExpectOpts`** — per the source spec. A missing workspace would silently re-introduce unfiltered scans, so making it required is load-bearing.
3. **Use `sessionId` as `langfuseTraceId`** — Langfuse traces at the session level, so the session_id is more semantically correct than the first run_id. Single-line reversion is trivial if verification step 4 shows Langfuse expects run_id.
4. **Early-return in `extractMetrics` when `runIds.length === 0`** — no query path can run without a filter. This is the structural guarantee that removes the catastrophic inflation bug.

## Scope

### In Scope
- `lib/build-result.ts`: add `resolveRunIds` helper (exported); remove log regex; require `workspace` in `BuildResultOpts`; drop `hasFilter` branches in `extractMetrics`; early-return when empty.
- `lib/check-expectations.ts`: import `resolveRunIds`; replace `runIds` with `workspace` in `CheckExpectOpts`; resolve internally; drop `hasFilter` branches in `readPipelineEvent` and `hasSkipEvent`.
- `lib/runner.ts`: delete log-parse block (lines 499-508); pass `workspace` to `buildResult` and `checkExpectations` instead of `runIds`.
- `lib/types.ts`: add `eforgeSessionId?: string` to `ScenarioResult`.
- CLI entry points of `build-result.ts` and `check-expectations.ts` updated to accept `workspace` positionally.

### Out of Scope
- Any changes to eforge itself (schema, CLI flags, env vars, sidecar files).
- Langfuse integration beyond swapping the `langfuseTraceId` source.
- Changes to `lib/compare.ts`, `lib/analyze.ts`, `lib/history.ts`, or any other downstream consumers that only read `result.json`.
- Backfill/repair of existing results in `results/`.

## Files

### Modify
- `lib/build-result.ts` — add and export `resolveRunIds`; rewrite `extractMetrics` query sites to unconditionally bind `...runIds` after early-return; add required `workspace` to `BuildResultOpts`; replace log-regex block in `buildResult` with resolver call; set `langfuseTraceId` and `eforgeSessionId` from `sessionId`; update CLI entry.
- `lib/check-expectations.ts` — import `resolveRunIds` from `./build-result.js`; change `CheckExpectOpts` to `{ resultFile, expectConfig, monitorDbPath, workspace }`; resolve `runIds` once at top of `checkExpectations` and pass into `readPipelineEvent` / `hasSkipEvent` (or inline the resolution into a single DB open); drop all `hasFilter` ternaries; update CLI to accept `<workspace>` positionally.
- `lib/runner.ts` — delete lines 499-508 (log-parse); replace `runIds` argument with `workspace` at the `buildResult` and `checkExpectations` call sites (lines 511-526 and 532-537).
- `lib/types.ts` — add optional `eforgeSessionId?: string` to `ScenarioResult` interface (line 71-85 area).

## Verification

- [ ] `pnpm type-check` exits 0 with no errors in `lib/**/*.ts`.
- [ ] `grep -n "hasFilter" lib/build-result.ts lib/check-expectations.ts` returns zero matches.
- [ ] `grep -n "Run:\\\\s" lib/build-result.ts lib/runner.ts` returns zero matches (log regex fully removed).
- [ ] `lib/build-result.ts` exports a function named `resolveRunIds` that accepts `(dbPath: string, workspace: string)` and returns `{ sessionId?: string; runIds: string[] }`.
- [ ] `BuildResultOpts` has `workspace: string` as a required (non-optional) field.
- [ ] `CheckExpectOpts` has `workspace: string` as a required field and no `runIds` field.
- [ ] `ScenarioResult` in `lib/types.ts` includes `eforgeSessionId?: string`.
- [ ] `extractMetrics` returns `undefined` when the resolved `runIds` array is empty (no query executes against the DB in that branch).
- [ ] Running `./run.sh --variant claude-sdk,pi-codex notes-api-excursion-refactor-store` produces a `result.json` for the failing claude-sdk variant with no `metrics` key (or with all zero/empty aggregates) and a pi-codex `result.json` whose token/cost totals match the prior known-good values (~441k tokens, ~$0.57) within 5%.
- [ ] A successful single-variant `result.json` contains an `eforgeSessionId` field matching exactly one row returned by `SELECT DISTINCT session_id FROM runs WHERE cwd = '<workspace>'` against `results/monitor.db`.
- [ ] `SELECT session_id, count(*) FROM runs WHERE cwd = '<workspace>' GROUP BY session_id` against `results/monitor.db` after a run returns exactly one row with count ≥ 1.
