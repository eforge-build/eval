---
title: Replace log-parsing with cwd-based session lookup in eval result builder
created: 2026-04-14
---

# Replace log-parsing with cwd-based session lookup in eval result builder

## Problem / Motivation

When two variants ran in parallel and one (claude-sdk) failed fast — before eforge emitted its `Run: <uuid>` line into the log — the eval harness reported wildly inflated metrics for the failed variant. claude-sdk failed after 18s but was credited with 40.3M tokens and $44.25, matching the lifetime sum of all rows in the shared `results/monitor.db`. pi-codex, which actually ran, reported the correct 441k tokens / $0.57.

Root cause: `lib/build-result.ts` recovers the current run's IDs by regex-matching `Run: <uuid>` in eforge's stdout log. When the log lacks that line (fast crash, format change), `runIds` is empty and a fallback at line 33-36 degrades every downstream query to *unfiltered* — aggregating every event ever recorded in the shared DB.

Log-parsing was introduced in commit `d793674` as the least-bad option at the time: eforge auto-generates run IDs internally and has no CLI flag, env var, or sidecar file to expose them. It also emits *multiple* `Run:` lines per invocation because each phase gets its own `run_id`.

But eforge's monitor schema already has the right correlation key: `runs.session_id`. It's generated once per `eforge run` invocation (`packages/eforge/src/cli/index.ts:304`) and stamped onto every `runs` row that invocation produces — spanning all phases. And the eval runner already gives each variant a unique `mkdtempSync` workspace (`lib/runner.ts:432`) stored in `runs.cwd`. So: **look up the session by cwd, not by log-scraping.**

## Goal

Replace brittle log-parsing in the eval result builder with a deterministic `cwd → session_id → run_ids` lookup against `monitor.db`, eliminating the unfiltered-query fallback that causes catastrophic metric inflation on fast-failing variants.

## Approach

Resolve run IDs by querying the monitor DB directly using the variant's unique workspace (`cwd`) as the key. Use `runs.session_id` as the stable per-invocation correlation key. Delete the `hasFilter` branching entirely so no unfiltered query code path can exist.

### Relevant schema (read-only, in eforge source)

From `packages/monitor/src/db.ts:83-120`:

- `runs(id TEXT PK, session_id TEXT, plan_set, command, status, started_at, completed_at, cwd TEXT NOT NULL, pid)` — `session_id` and `cwd` both indexed.
- `events(id, run_id TEXT, type, plan_id, agent, data, timestamp)` — only `run_id`, no session_id.

### 1. `lib/build-result.ts`

Replace the log-parsing block (lines 260-271) and the `hasFilter` plumbing (lines 33-36) with a single resolver:

```ts
function resolveRunIds(dbPath: string, workspace: string): { sessionId?: string; runIds: string[] } {
  if (!existsSync(dbPath)) return { runIds: [] };
  let db: DatabaseSync;
  try { db = new DatabaseSync(dbPath, { readOnly: true }); }
  catch { return { runIds: [] }; }
  try {
    const tableCheck = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='runs'`
    ).get() as { name: string } | undefined;
    if (!tableCheck) return { runIds: [] };

    const sessionRow = db.prepare(
      `SELECT session_id FROM runs WHERE cwd = ? AND session_id IS NOT NULL LIMIT 1`
    ).get(workspace) as { session_id: string } | undefined;
    if (!sessionRow) return { runIds: [] };

    const runRows = db.prepare(
      `SELECT id FROM runs WHERE session_id = ?`
    ).all(sessionRow.session_id) as Array<{ id: string }>;
    return { sessionId: sessionRow.session_id, runIds: runRows.map(r => r.id) };
  } finally { db.close(); }
}
```

Then in `extractMetrics`: early-return `undefined` when `runIds.length === 0`. With that guard, every existing query site (lines 47, 59, 122, 162, 190, 217) drops its `hasFilter` ternary and becomes `stmt.all(...runIds)` unconditionally. The dangerous unfiltered fallback is removed by construction.

Update `BuildResultOpts` to add `workspace: string` (required); remove nothing else from its shape. Inside `buildResult`, replace the log regex block with:

```ts
const { sessionId, runIds } = resolveRunIds(monitorDbPath ?? '', workspace);
if (sessionId) {
  result.langfuseTraceId = sessionId;        // session is the Langfuse trace root
  result.eforgeSessionId = sessionId;        // new, for debugging
}
if (monitorDbPath && runIds.length > 0) {
  const metrics = extractMetrics(monitorDbPath, runIds);
  if (metrics) result.metrics = metrics;
}
```

(Langfuse already traces at the session level, so using `sessionId` as `langfuseTraceId` is more correct than the previous "first run_id" heuristic. If verification shows Langfuse expects a run_id specifically, revert that one line and keep the first run_id.)

### 2. `lib/runner.ts`

- Delete lines 499-508 (the `runIds` log parse).
- Pass `workspace` into `buildResult` (line 511-526) — new required field on `BuildResultOpts`.
- Pass `workspace` instead of `runIds` into `checkExpectations` (line 532-537).

### 3. `lib/check-expectations.ts`

- Change signature: `workspace: string` replaces `runIds: string[]`.
- Inline the same `resolveRunIds` helper (or export it from `build-result.ts` and import here to avoid duplication — prefer the shared export).
- Drop all `hasFilter` ternaries (lines 56-58, 63, 93-95, 100). Every query binds `...runIds` unconditionally after the early-return guard.
- CLI entry at line 217 — switch `runIdArgs` to a `workspace` arg.

### `ScenarioResult` type

Add optional `eforgeSessionId?: string` to `lib/types.ts` (wherever `ScenarioResult` lives) so the new field is typed.

## Scope

### In scope

- `lib/runner.ts` — stop log-parsing `runIds`; pass `workspace` (cwd) to downstream calls instead. Already in scope at line 432.
- `lib/build-result.ts` — replace the log-regex path with a `cwd → session_id → run_ids` lookup against `monitor.db`. Delete the unfiltered-query fallback entirely.
- `lib/check-expectations.ts` — same replacement: accept `workspace` instead of `runIds`, resolve run_ids internally, drop the `hasFilter` branches.
- `lib/types.ts` — add optional `eforgeSessionId?: string` to `ScenarioResult`.

### Out of scope

- Changes to eforge itself (schema, CLI flags, env vars, sidecar files).
- Changes to Langfuse integration beyond swapping the `langfuseTraceId` source (reversible single-line change if verification fails).

## Acceptance Criteria

### What this fixes and why it's strictly better

- **No log parsing.** Immune to eforge log-format changes, colorization, stderr routing.
- **Works for fast crashes that still wrote a `runs` row** — as long as eforge got as far as registering the invocation, we find it. (If it crashed before that, there is no data to attribute anyway, which is correct.)
- **No unfiltered-query code path exists.** The `hasFilter` branching is deleted.
- **session_id is the semantically correct key.** One invocation, all phases, one ID. Exposed in `result.json` for human debugging.
- **cwd is guaranteed unique** per variant per invocation (`mkdtempSync`), so the `SELECT ... WHERE cwd = ?` lookup is unambiguous.

### Verification

1. `pnpm type-check` — no type regressions.
2. Re-run the failing scenario that exposed the bug:
   ```bash
   ./run.sh --variant claude-sdk,pi-codex notes-api-excursion-refactor-store
   ```
   Expected: claude-sdk `FAIL` with empty/zero metrics columns (no `metrics` key in its `result.json`); pi-codex unchanged at ~441k tokens / $0.57.
3. Inspect a successful single-variant run's `result.json` — should contain `eforgeSessionId`, `metrics`, and per-agent/per-model aggregates matching what was there before (regression check).
4. Spot-check that `langfuseTraceId` in the new `result.json` matches what Langfuse actually uses as a trace root for that run. If not, revert that one line to first run_id.
5. Manually inspect `results/monitor.db` after a run: `SELECT session_id, count(*) FROM runs WHERE cwd = '<workspace>' GROUP BY session_id` should return exactly one session with ≥1 run.
