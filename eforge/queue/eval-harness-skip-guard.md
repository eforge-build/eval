---
title: Eval Harness Skip Guard
created: 2026-04-15
---

# Eval Harness Skip Guard

## Problem / Motivation

The eval harness currently marks scenarios as **passed** when `eforgeExitCode === 0` and all validation steps pass, regardless of whether eforge actually produced output. A recent run demonstrated the failure: the planner agent emitted plans as chat output but never invoked Write, eforge printed `Skipped: No plans generated`, exited 0, and the harness ran `pnpm install / type-check / test` against an untouched fixture — all trivially passed. Scenario reported as success despite zero work being done.

`eval/lib/check-expectations.ts` already detects `plan:skip` events via `hasSkipEvent()` and records expectation results in `result.json`. But `eval/lib/runner.ts:138-144` (`isScenarioPassed`) does not consult expectation results — the comment explicitly says *"Expectations (mode, build stages) are informational — reported as observations, not pass/fail gates."* That comment encoded an intentional choice for `mode` (judgment call) but accidentally applies to `skip` too (not a judgment call — if the scenario expected work and got none, it failed).

## Goal

Make unexpected `plan:skip` a hard scenario failure. When a scenario expects real work (indicated by an `expect.mode` or `validate` steps), an implicit `expect.skip: false` should apply, and a `plan:skip` event during the run should fail the scenario even when `eforgeExitCode === 0`.

## Approach

Two small changes in `/Users/markschaake/projects/eforge-build/eval/`:

1. **Gate `isScenarioPassed` on `skip` expectation results.** Modify `eval/lib/runner.ts:138-144` so the function also requires no `skip` check to have failed. Other expectation types (`mode`, `buildStagesContain`, `buildStagesExclude`) stay informational — the comment's original intent is preserved for those. `skip` graduates to a gating check because a skip mismatch is never a judgment call.

2. **Apply implicit `expect.skip: false` when meaningful.** Modify `eval/lib/check-expectations.ts:130-200` so that when a scenario declares `expect.mode` or has non-empty `validate` steps and has not explicitly set `expect.skip`, the checker implicitly adds a `skip: false` check. Scenarios that legitimately expect a skip (e.g., "prd already implemented" fixtures) must continue to declare `expect.skip: true` explicitly.

3. **Audit `eval/scenarios.yaml`.** Add explicit `expect.skip: true` to any scenario that intentionally exercises the skip path, so the new implicit default doesn't flip those scenarios to failing.

### Why this shape

- Reuses the existing `hasSkipEvent()` infrastructure in `check-expectations.ts:78-108` — no new detection code.
- Keeps expectation-checking logic centralized in `check-expectations.ts`; only the pass/fail gate in `runner.ts` needs behavior change.
- Scenarios that already declare `expect.skip` behavior are untouched. Only scenarios that were silent on `skip` get the implicit `false` default, and only when they have evidence they expected work (`mode` or `validate`).
- The `eforgeExitCode === 0 && validation passed` gate stays — this change is additive: failed expectations.skip now also gates.

## Scope

### In scope

- `eval/lib/runner.ts` — extend `isScenarioPassed` to also fail on skip expectation mismatch.
- `eval/lib/check-expectations.ts` — implicit `expect.skip: false` when scenario has `expect.mode` or non-empty `validate`.
- `eval/scenarios.yaml` — audit scenarios; add explicit `skip: true` where intentional.
- Rerun the failing scenario (`workspace-api-excursion-engagement--pi-gemma4`) to confirm it now fails loudly instead of silently passing.

### Out of scope

- Changes to eforge engine behavior (tracked in a separate PRD). This change makes the harness detect the problem even if the engine still emits `plan:skip` silently.
- New expectation types (`mustNotSkip`, tool-usage thresholds, etc.). The existing `skip` expectation is sufficient.
- Gating `mode` or build-stage expectations — those remain informational per the existing comment's original intent.

## Acceptance Criteria

- `eval/lib/runner.ts` `isScenarioPassed` returns `false` when the scenario's `expectations.skip` check failed, even if `eforgeExitCode === 0` and validation passed.
- `eval/lib/check-expectations.ts` inserts an implicit `skip: false` check when: (a) `expect.skip` was not explicitly set AND (b) either `expect.mode` is defined or `validate` steps exist. The implicit check is recorded in `result.json` like any other check, tagged clearly (e.g., `implicit: true`) so authors can see why it fired.
- Scenarios in `eval/scenarios.yaml` that intentionally test the skip path (if any) declare `expect.skip: true` explicitly. An audit pass confirms no intentional-skip scenario was silently broken by the change.
- Re-running the original failing scenario produces a failed result with a clear reason: the skip expectation mismatched.
- All other existing scenarios that currently pass continue to pass after the change.
- A brief doc update (comment in `runner.ts` or `check-expectations.ts`) records that `skip` is a gating expectation and why.
