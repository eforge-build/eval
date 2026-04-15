# Variant Analysis — 2026-04-14T21-27-12

Generated: 2026-04-14T22:00:00Z
Scenarios analyzed: 1

## workspace-api-excursion-engagement

**Variants:** `anthropic-api`, `claude-sdk`
**Ranking:** 1. `claude-sdk`, 2. `anthropic-api` (close — role-reversal from the prior run of the same scenario)

### Variant configs

- `anthropic-api`: backend `pi`, `max` → `claude-opus-4-6`, `balanced` → `claude-sonnet-4-6` (anthropic direct). Every observed `agent:result` used `claude-opus-4-6`; sonnet-4-6 not exercised this run. **31 m 47 s / $8.42 / 4.92 M tokens**.
- `claude-sdk`: backend `claude-sdk`, default routing. Opus for every primary agent **plus `claude-haiku-4-5-20251001` invoked inside the planner** (507 k input tokens on haiku alongside 168 k on opus). sonnet-4-6 unused. **41 m 41 s / $14.32 / 12.10 M tokens**.

### Scorecard

| Dimension                | anthropic-api                  | claude-sdk                          |
|--------------------------|--------------------------------|-------------------------------------|
| Pipeline composer        | excursion, test-write + doc-update + test-cycle, 2r (correctness + maintainability) | excursion, `implement → review-cycle → test-cycle`, 2r |
| Planner                  | excursion, 4 plans             | excursion, 4 plans                  |
| Plan reviewer            | ran ($0.29)                    | ran (**$1.24**, 4.3× more)          |
| Plan evaluator           | **not run**                    | ran ($0.32)                         |
| Builder                  | 5 turns, clean scope           | 5 turns, clean scope                |
| Tester                   | 4 turns, tests pass            | 4 turns, tests pass                 |
| Reviewer issues          | 17 raised                      | 20 raised                           |
| Evaluator accept rate    | **33 %** (9 accept / 10 reject / 8 review) | **62 %** (16 / 8 / 2)   |
| Review-fixer             | 5 turns                        | 5 turns                             |
| Merge-conflict-resolver  | 0 invocations                  | 0 invocations                       |
| Validation-fixer         | 1 turn                         | 2 turns                             |
| Gap-closer               | ran                            | ran                                 |
| PRD validator            | passed                         | passed                              |
| Doc discipline           | no writes                      | no writes                           |
| Scope discipline         | clean                          | clean                               |
| Validation               | install ✓, type-check ✓, test ✓ | install ✓, type-check ✓, test ✓    |
| Expectations             | mode ✓                         | mode ✓                              |
| Cost                     | **$8.42**                      | $14.32 (1.70×)                      |
| Duration                 | **1907 s**                     | 2501 s (1.31×)                      |
| Tokens                   | **4.92 M**                     | 12.10 M (2.46×)                     |

### Stage-by-stage

#### Pipeline composer
- `anthropic-api` (`eforge.log:201-222`): scope=excursion; `implement → test-write → [doc-update || review-cycle] → test-cycle`; 2-round review, perspectives `correctness + maintainability`, standard strictness.
- `claude-sdk` (`eforge.log:231-254`): scope=excursion; `implement → review-cycle → test-cycle`; 2 rounds, `correctness + maintainability`, standard strictness.

Both sized correctly. `anthropic-api`'s pipeline declared `doc-update` again — and again no `doc-updater` agent actually ran (consistent with the prior run, likely pipeline consolidation).

**Winner:** tie.

#### Planner / plan-reviewer / plan-evaluator
Both planners decomposed into **4 plans** (foundation + reactions + threads + pins). Both ran plan-reviewer. **This run, `claude-sdk` ran `plan-evaluator`; `anthropic-api` did not** — a reversal from `2026-04-14T20-06-55`. `claude-sdk`'s plan-reviewer burned **$1.24 on 1.14 M input tokens of opus** — 4.3× what `anthropic-api`'s plan-reviewer cost ($0.29 / 94 k input). That extra spend is partly how `claude-sdk` earned the plan-evaluator stage.

**Winner:** `claude-sdk` — ran the plan-evaluation arbitration on this scenario (decision quality); but flag the 4× spend on plan-reviewer as over-budget.

#### Builder / Tester
Both builders executed 5 turns across the 4 plans, both testers 4 turns. Artifacts functionally equivalent, tests pass.

**Winner:** tie.

#### Reviewer / Evaluator
- `anthropic-api`: 17 issues → 27 verdicts with **33 % accept rate (9 / 10 / 8 "review")**.
- `claude-sdk`: 20 issues → 26 verdicts with **62 % accept rate (16 / 8 / 2)**.

Different from the prior run where `anthropic-api` was the one with 57 % accept and `claude-sdk` was the speculator. This run's `claude-sdk` reviewer landed substantively better signal — twice the accept rate on comparable issue volume. `anthropic-api` also emitted 8 `"review"` (defer-to-human) verdicts, a class that didn't appear in its prior run.

**Winner:** `claude-sdk` — better signal-to-noise this run.

#### Doc discipline
Neither variant wrote to `docs/`, `README*`, or `CHANGELOG*`. Neither touched the PRD source. Fixture observation: `workspace-api/docs/` contains only scenario PRDs, no project docs. No "missed update" applies.

**Winner:** tie.

#### Scope discipline
Monitor-DB inventory confirms both variants wrote only the PRD-expected surface (`src/types.ts`, `src/store.ts`, `src/app.ts`, `src/stores/*`, `src/routes/*`, `test/*`, `package.json`).

**Winner:** tie.

#### Final artifact
Validation passes on both. Equivalent functional output.

**Winner:** tie.

### Verdict

`claude-sdk` narrowly wins this run on **decision quality**: it ran plan-evaluator (the arbitration stage that `anthropic-api` skipped), and its reviewer+evaluator chain produced twice the accept rate on comparable issue volume. `anthropic-api` wins decisively on efficiency — 1.7× cheaper, 2.5× fewer tokens. The story inverts the prior run on the same scenario (`2026-04-14T20-06-55`), where `anthropic-api` ran plan-evaluator and had the better accept rate. Composer/planner decisions on this PRD are non-deterministic between runs; any single-run comparison should be read as one sample, not a backend verdict.

### Notes

- **Run-to-run non-determinism on plan-evaluator.** Last run: `anthropic-api` ran it, `claude-sdk` didn't. This run: the reverse. Same models, same overlay, same PRD. Suggests pipeline composition is sensitive to small prompt-context variations — worth averaging 3+ runs before drawing backend conclusions on this scenario.
- **`claude-sdk` plan-reviewer cost is an outlier.** $1.24 on 1.14 M input tokens is 4× `anthropic-api`'s comparable stage. Worth inspecting whether the `claude-sdk` plan-reviewer is re-reading context redundantly or looping.
- **Haiku helper inside `claude-sdk` planner is consistent.** 507 k input tokens on `claude-haiku-4-5-20251001` this run, plus 168 k on opus — same pattern as `2026-04-14T20-06-55` (349 k haiku + 294 k opus). Stable architectural choice in the `claude-sdk` backend.
- **`anthropic-api` evaluator producing `"review"` verdicts now.** 8/27 verdicts this run, 0 last run — the defer-to-human class is no longer `claude-sdk`-exclusive. Harness should confirm these are counted correctly in `result.review.accepted`/`rejected`.
- **No merge-conflict-resolver on either variant** — both 4-plan decompositions landed cleanly without manual conflict arbitration. Contrast with last run's `claude-sdk` (2 invocations).
- **No MCP or Skill tool use on either side** (confirmed across all 6 runs in this scenario's monitor-DB slice).
- **Metrics aggregator healthy.** All observed agents present in both `metrics.agents` blocks; `comparison.json` trustworthy.
