---
id: plan-01-skip-guard
name: Gate scenario pass on skip expectation and apply implicit skip=false
depends_on: []
branch: eval-harness-skip-guard/skip-guard
---

# Gate scenario pass on skip expectation and apply implicit skip=false

## Architecture Context

The eval harness (`lib/runner.ts`) currently decides scenario pass/fail using only `eforgeExitCode === 0` plus validation step results. `lib/check-expectations.ts` already detects `plan:skip` events via `hasSkipEvent()` and records the `skip` check in `result.json` under `expectations.checks`, but `isScenarioPassed` ignores expectation results entirely. The comment on `isScenarioPassed` states expectations are informational because `mode` / build stage choices are judgment calls. That reasoning applies to `mode` and build-stage checks, but not to `skip` — a skip mismatch is a factual mismatch, not a judgment call.

This plan promotes the `skip` expectation to a gating expectation and introduces an implicit `skip: false` default for scenarios that have evidence they expected real work (`expect.mode` defined or non-empty `validate` steps). All other expectation types remain informational, preserving the original comment's intent.

## Implementation

### Overview

Three focused edits in `lib/` plus a scenarios audit:

1. Extend `ExpectationCheck` in `lib/types.ts` with an optional `implicit?: boolean` field so authors can see which checks were auto-added.
2. Modify `checkExpectations` in `lib/check-expectations.ts` to synthesize an implicit `skip: false` check when (a) `expectConfig.skip` is `undefined` and (b) `expectConfig.mode !== undefined` OR the scenario has non-empty `validate` steps. To detect validate steps, add a new field `hasValidateSteps: boolean` to `CheckExpectOpts` and pass it from `runner.ts`. The synthesized check is tagged `implicit: true`. Also tag the existing explicit `skip` check with `implicit: false` for symmetry.
3. Modify `isScenarioPassed` in `lib/runner.ts` to additionally require that no `skip` check in `r.expectations.checks` has `passed === false`. `mode`, `buildStagesContain`, and `buildStagesExclude` checks remain informational. Update the comment to document that `skip` is now a gating expectation.
4. Audit `scenarios.yaml`. `todo-api-errand-skip` already sets `skip: true`. Every other scenario has `mode` + `validate` and so will pick up the implicit `skip: false` — desired behavior. Confirm no scenario is silently intended to skip; no scenario additions are needed.

### Key Decisions

1. **Tag implicit checks with an `implicit` flag rather than a separate check name.** Keeps the `check: 'skip'` identifier stable and authors can filter on `implicit` if they want. An `implicit` field is lower-risk than a new check type.
2. **Gate signal = "any skip check with `passed === false`".** Works uniformly for explicit and implicit skip checks; no special-casing.
3. **Pass `hasValidateSteps` explicitly from the runner** instead of plumbing the scenario object into `check-expectations.ts`. Keeps `check-expectations.ts` free of scenario-shape coupling and preserves its current narrow interface.
4. **No new expectation detection infrastructure.** Reuses `hasSkipEvent()` unchanged.

## Scope

### In Scope
- Adding an optional `implicit` field to `ExpectationCheck` in `lib/types.ts`.
- Synthesizing an implicit `skip: false` check in `checkExpectations` when conditions are met.
- Extending `CheckExpectOpts` with `hasValidateSteps: boolean` and passing it from the runner call site.
- Updating `isScenarioPassed` in `lib/runner.ts` to fail when any `skip` expectation check failed.
- Updating the comment on `isScenarioPassed` to record that `skip` is a gating expectation.
- Audit of `scenarios.yaml` to confirm no scenario silently expected a skip.

### Out of Scope
- Changes to eforge engine behavior (separate PRD).
- New expectation types (`mustNotSkip`, tool-usage thresholds, etc.).
- Gating `mode` or build-stage expectations.
- Changes to the CLI entry point argument list in `check-expectations.ts` beyond what's required to pass the new flag (the CLI is invoked only from the runner, which passes the full opts object in-process — see call sites).

## Files

### Modify
- `lib/types.ts` — add `implicit?: boolean` to `ExpectationCheck`.
- `lib/check-expectations.ts` — extend `CheckExpectOpts` with `hasValidateSteps: boolean`; in `checkExpectations`, when `expectConfig.skip === undefined` and (`expectConfig.mode !== undefined` || `hasValidateSteps`), append a synthesized check with `check: 'skip'`, `expected: false`, `actual: hasSkipEvent(...)`, `passed: !skipped`, `implicit: true`. Tag the existing explicit-`skip` branch with `implicit: false`. If the CLI entry point is retained, accept the flag via an additional argv slot or env var; prefer removing direct CLI use if the runner is the only caller (check via `grep -rn check-expectations` before deciding).
- `lib/runner.ts` — update `isScenarioPassed` signature still takes `ScenarioResult`; add a check: `const skipOk = !(r.expectations?.checks ?? []).some(c => c.check === 'skip' && c.passed === false); return eforgeOk && validateOk && skipOk;`. Update the comment block above the function to state that `skip` is a gating expectation (factual mismatch, not a judgment call) while `mode` and build-stage checks remain informational. At the call site that invokes `checkExpectations`, pass `hasValidateSteps: (scenario.validate?.length ?? 0) > 0`.

## Verification

- [ ] `pnpm type-check` passes with zero errors.
- [ ] For a scenario with `expect.mode` set and no explicit `expect.skip`, `result.json` contains a `checks` entry with `check: 'skip'`, `expected: false`, `implicit: true`.
- [ ] For the same scenario, when the underlying run emits a `plan:skip` event, `isScenarioPassed` returns `false` even though `eforgeExitCode === 0` and all validation steps pass.
- [ ] For a scenario with explicit `expect.skip: true` (e.g. `todo-api-errand-skip`), the recorded `skip` check has `implicit: false` and `isScenarioPassed` returns `true` when a `plan:skip` event is emitted.
- [ ] For a scenario with no `expect.mode` and empty `validate`, no implicit `skip` check is added (the `checks` array does not contain a `skip` entry unless `expectConfig.skip` was explicitly set).
- [ ] Re-running `workspace-api-excursion-engagement--pi-gemma4` (the original failing case) produces a result with `isScenarioPassed === false` and a failed `skip` check in `expectations.checks` identifying the mismatch (`expected: false, actual: true`).
- [ ] Re-running the other existing scenarios that previously passed continues to produce `isScenarioPassed === true` (skip check passes because no `plan:skip` was emitted).
- [ ] The comment block above `isScenarioPassed` in `lib/runner.ts` explicitly names `skip` as a gating expectation and retains the existing rationale for why `mode` / build-stage checks remain informational.
