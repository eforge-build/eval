# Variant Analysis — 2026-04-16T16-53-47

Generated: 2026-04-16T17:05:00Z
Scenarios analyzed: 1

## todo-api-errand-health-check

**Variants:** anthropic-api, anthropic-api-4-6, claude-sdk
**Ranking:** 1. anthropic-api, 2. anthropic-api-4-6, 3. claude-sdk

**Expected behavior:** `mode=errand`, `buildStagesExclude=[test-cycle]`, no skip. (PRD: one `/health` route + one test, explicit acceptance criteria, no DB/auth.)

**Configs under test:**
- `anthropic-api` — backend `pi`; `claude-opus-4-7` (max) + `claude-sonnet-4-6` (balanced, used by prd-validator only).
- `anthropic-api-4-6` — backend `pi`; `claude-opus-4-6` (max) + `claude-sonnet-4-6` (balanced, used by prd-validator only).
- `claude-sdk` — backend `claude-sdk`; `claude-opus-4-7` for planner/builder/tester/reviewer, `claude-haiku-4-5-20251001` for pipeline-composer, `claude-sonnet-4-6` for prd-validator.

### Scorecard

| Dimension | anthropic-api | anthropic-api-4-6 | claude-sdk |
|---|---|---|---|
| Pipeline composer scope | ✓ errand | ~ errand w/ `test-cycle` | ✗ excursion |
| Pipeline composer stages | ✓ [implement, test-write] | ✗ [implement, test-cycle] | ✗ [implement, [test-write, doc-update], review-cycle] |
| Planner | ✓ errand | ✓ errand | ✓ errand (overridden by composer) |
| Builder | ✓ built-in fetch, no deps | ~ installed supertest | ✓ built-in fetch, no deps |
| Test stage | ✓ test-writer declined | ~ tester found nothing | ~ expanded 1→4 tests |
| Reviewer | n/a | n/a | ~ ran, 0 issues |
| Doc-updater | n/a | n/a | ✓ ran, declined PRDs |
| Doc discipline | ✓ | ✓ | ✓ |
| Scope discipline | ✓ 5 files | ~ 6 files (supertest dep) | ✓ 4 files (pnpm-lock excluded) |
| Mode expectation | ✓ errand | ✓ errand | ✗ excursion |
| Stage-exclude expectation | ✓ | ✗ test-cycle ran | ✓ |
| Validation | ✓ | ✓ | ✓ |
| Cost | $1.04 | **$0.47** | $2.25 |
| Duration | 133s | **122s** | 320s |

### Stage-by-stage

#### Pipeline composer

- `anthropic-api` (`eforge.log:57-71`): scope=errand, build=`[implement, test-write]`, lenient review. Rationale: "trivial, well-scoped". Clean match to the PRD.
- `anthropic-api-4-6` (`eforge.log:50-64`): scope=errand, build=`[implement, test-cycle]`. Correctly identified the errand scope, but `test-cycle` is an iterative test-fix-loop stage heavier than `test-write`. The scenario's `buildStagesExclude: [test-cycle]` guard exists precisely to catch this.
- `claude-sdk` (`eforge.log:61-80`): scope=excursion, build=`[implement, [test-write, doc-update], review-cycle]`, 2-round review with `correctness + api-design` perspectives. Biggest misjudgment — a single static-JSON endpoint doesn't need an api-design perspective.

**Winner:** `anthropic-api`. `anthropic-api-4-6` is a close second on scope mode but loses the stage-shape check. `claude-sdk` is worst — its pipeline-composer runs on haiku and appears to systematically over-scope.

#### Planner

All three planners independently chose `errand` profile (`anthropic-api` log:81-85, `4-6` log:82-84, `claude-sdk` log:94-98). Good judgment across the board. The planner's profile choice is recorded in the submitted plan set but does not override the composer's stage list in either backend — so the `claude-sdk` pipeline still ran excursion-shape stages despite the planner's errand verdict.

**Winner:** tie.

#### Builder

- `anthropic-api` (log:103-128): Node 22 built-in `fetch`, `app.listen(0)`, no dependency installs. 5 files changed; the fifth is `pnpm-lock.yaml` regenerated from a `pnpm install` to confirm the lockfile (no new deps added).
- `anthropic-api-4-6` (log:114-138): installed `supertest` + `@types/supertest` as devDependencies for the HTTP test. 6 files changed. Planner actually pre-authorized this (log:96), so this is a planner-level decision expressed by the builder, not free-range scope creep — but it's still an unnecessary dependency given Node 22 built-in fetch works fine.
- `claude-sdk` (log:125-157): Node 22 built-in `fetch`, `app.listen(0)`. 4 files changed; explicitly left the generated `pnpm-lock.yaml` untracked (log:156) to keep scope minimal. Cleanest artifact of the three.

**Winner:** `claude-sdk` by a hair over `anthropic-api`. Both used built-in fetch; `claude-sdk` kept the lockfile out of the commit. `anthropic-api-4-6` is the only variant that added a dependency.

#### Test stage

- `anthropic-api` — `test-writer` stage ran but produced `count=0` (log:154-156): the builder had already written comprehensive tests during implement, and test-writer correctly declined to add more. Best kind of stage outcome.
- `anthropic-api-4-6` — ran `tester` (test-cycle stage): "All 8 tests pass. No test bugs or production bugs found." Emitted empty `<test-issues></test-issues>` (log:163). A wasted stage by good judgment — rescuing nothing is still work no one needed to do.
- `claude-sdk` — `test-writer` expanded the single combined assertion into 4 focused vitest cases, including a negative assertion that `/todos/health` does not resolve (log:207-216). Defensible scope, 11 tests pass.

**Winner:** `anthropic-api` — the only stage outcome that is a pure win (declined cleanly when criteria were already met).

#### Reviewer

Only `claude-sdk` ran a reviewer. Emitted `<review-issues></review-issues>` — zero issues, no speculation (log:242). Correct judgment, but the stage cost $0.21 and ~47s on work the composer should not have ordered.

**Winner:** n/a — single-variant stage.

#### Doc discipline

- `anthropic-api`, `anthropic-api-4-6`: no doc-updater stage, no doc edits.
- `claude-sdk`: doc-updater ran, surveyed `docs/*.md`, correctly classified `add-health-check.md` / `skip-already-done.md` / `add-jwt-auth.md` as PRD/spec inputs, declined to touch any of them (log:192-205). Also noted `add-jwt-auth.md`'s conditional reference to `/health` remains accurate — so no downstream update needed. No PRDs edited, no over-reach.

**Missed updates:** none — the fixture has no README, no API reference, no architecture docs.

**Fixture observation:** `fixtures/todo-api/` has no project documentation, only PRD specs. Running `doc-update` against this fixture is intrinsically wasted compute — the fixture should either grow a minimal project README/api-reference for doc-updater to legitimately target, or composer rules should avoid ordering `doc-update` when no project docs exist.

**Winner:** tie — all variants ran without touching docs inappropriately.

#### Final artifact

All three workspaces pass `pnpm type-check` and `pnpm test`. Functional equivalence across the three. Differences are:
- `claude-sdk`: smallest footprint (4 files, no deps), 4 focused tests.
- `anthropic-api`: no deps, 9 tests covering positive + negative path (builder-authored).
- `anthropic-api-4-6`: +`supertest` dependency surface, 1 test.

### Verdict

**anthropic-api** is the clear winner on decision quality. Only variant whose composer right-sized both scope and stages, whose test-writer recognized the work was done and bowed out, and whose end-to-end run passed every expectation. Mid-range cost is the price of correctness.

**anthropic-api-4-6** earns second place on a cost-weighted basis — it made the correct errand scope call (which is the headline decision) and ran 2× cheaper and slightly faster than `anthropic-api`. It loses points for the `test-cycle` stage choice (which the scenario's `buildStagesExclude` was designed to flag) and for authorizing an unnecessary `supertest` install.

**claude-sdk** ranks third despite having arguably the best per-stage judgments (cleanest builder, disciplined doc-updater, reasonable test expansion, honest zero-issue review). Its composer — running on `claude-haiku-4-5` — over-scoped the PRD to excursion with two review perspectives and a two-round review-cycle, and the pipeline cost 4.8× as much as `anthropic-api-4-6` to produce a functionally equivalent artifact. Rescuing wasted work is worse than avoiding it.

### Notes

- **Metrics aggregator looks healthy** in all three `result.json`s — every stage the log shows running is represented in `metrics.agents`. No aggregator-bug signature.
- **Composer model routing diverges sharply.** `pi` backend runs the composer on the configured `max` model (opus-4-7 / opus-4-6). `claude-sdk` routes the composer to `claude-haiku-4-5-20251001` — and haiku over-scoped for the second run in a row (the previous run at `2026-04-16T16-42-57` showed the same pattern). This is a systemic signal, not a one-off.
- **`buildStagesExclude` is earning its keep.** The 4-6 variant's `test-cycle` choice would not have been flagged by a `mode`-only expectation check; `buildStagesExclude` caught it. Worth preserving in other scenarios where stage-shape matters even when scope mode is right.
- **`anthropic-api` config changed between runs.** In the previous run it used `sonnet-4-7` as `balanced`; this run uses `sonnet-4-6`. Since `balanced` is only invoked by prd-validator in errand mode, the impact is negligible, but worth noting if you diff runs.
- **Langfuse disabled** for all three runs — no external trace verification available.
