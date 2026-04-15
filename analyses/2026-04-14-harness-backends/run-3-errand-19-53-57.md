# Variant Analysis — 2026-04-14T19-53-57

Generated: 2026-04-14T20:45:00Z
Scenarios analyzed: 1

## todo-api-errand-health-check

**Variants:** `anthropic-api`, `claude-sdk`
**Ranking:** 1. `anthropic-api`, 2. `claude-sdk`

### Variant configs

- `anthropic-api`: backend `pi`, `max` → `claude-opus-4-6`, `balanced` → `claude-sonnet-4-6` (anthropic direct). Opus for every build stage, sonnet-4-6 only for `prd-validator`. 132 s / $0.39.
- `claude-sdk`: backend `claude-sdk`, default routing — opus-4-6 for planner/builder/tester/composer/formatter, sonnet-4-6 for `prd-validator`. 202 s / $0.62.

Identical model routing; the `pi`/`claude-sdk` backend is the only controlled difference.

### Scorecard

| Dimension            | anthropic-api                 | claude-sdk                         |
|----------------------|-------------------------------|------------------------------------|
| Pipeline composer    | excursion, `implement+test-cycle`, single/lenient/1r | excursion, `implement+[review-cycle,test-write]+test-cycle`, auto/std/2r |
| Planner profile      | errand ✓                      | errand ✓                           |
| Orchestration        | `implement → test-cycle`      | `implement → test-cycle`           |
| Builder              | supertest installed, clean    | supertest installed, clean         |
| Tester               | all tests pass                | all tests pass                     |
| Reviewer / fixer / evaluator | skipped (planner downgrade) | skipped (planner downgrade) |
| PRD validator        | 100% complete                 | 100% complete                      |
| Doc discipline       | no touches                    | no touches                         |
| Scope discipline     | clean                         | clean                              |
| Validation           | pass                          | pass                               |
| Expectations         | mode ✗, stages ✗              | mode ✗, stages ✗                   |
| Cost                 | **$0.39** (1.61× cheaper)     | $0.62                              |
| Duration             | **132 s** (1.53× faster)      | 202 s                              |

### Stage-by-stage

#### Pipeline composer
- `anthropic-api` (`eforge.log:57-70`): `scope: "excursion"`, `defaultBuild: ["implement", "test-cycle"]`, `strategy: single`, lenient, 1 round. Rationale notes the PRD's explicit test criteria as the reason to nudge above errand.
- `claude-sdk` (`eforge.log:56-73`): `scope: "excursion"`, `defaultBuild: ["implement", ["review-cycle", "test-write"], "test-cycle"]`, `strategy: auto`, standard, 2 rounds.

Both label the work `excursion`, but their *pipelines* diverge sharply: `anthropic-api`'s is a 2-stage `implement+test-cycle`, essentially an errand-shaped build. `claude-sdk` parallelizes a full review-cycle and test-write alongside implement, then still runs test-cycle — a materially heavier pipeline for the same PRD. Notably, `anthropic-api`'s composer shifted back to `excursion` this run after picking `errand` in the previous one (non-determinism worth flagging).

**Winner:** `anthropic-api` — cheaper pipeline shape even though the scope label matches.

#### Planner
Both planners picked `<profile name="errand">` (`anthropic-api/eforge.log:88`, `claude-sdk/eforge.log:90`) and generated `implement → test-cycle`. `claude-sdk`'s planner again rescues an over-composed pipeline; `anthropic-api`'s ratifies a pipeline that was already close to right.

**Winner:** tie on outcome; slight edge to `anthropic-api` for needing less correction.

#### Builder / Tester
Both install `supertest` + `@types/supertest`, edit `src/app.ts`, create `test/health.test.ts`. Tests pass cleanly for both; no review issues raised by either (`reviewIssues: 0`).

**Winner:** tie.

#### Review / review-fixer / evaluator
Not executed for either — planners downgraded to errand before any review stage could fire.

#### PRD validator
Both 100%. Both route to `claude-sonnet-4-6` per `balanced` role.

#### Doc discipline
Neither touched anything under `docs/`, `README*`, `CHANGELOG*`, or the PRD source. Fixture has no project docs — fixture observation, not a variant fault.

#### Scope discipline
No stray edits in either log. Both modify only the expected surface (`src/app.ts`, `test/health.test.ts`, `package.json`, `package-lock.json`).

### Verdict

`anthropic-api` wins on pipeline-shape efficiency: even when its composer labels the work `excursion`, it emits a 2-stage build (`implement → test-cycle`, `eforge.log:59`) — a pipeline materially closer to what actually needs to run. `claude-sdk`'s composer still lays down a full excursion shape with parallel review-cycle + test-write + 2-round review (`eforge.log:58-73`), which the planner then strips away. Same models, same final artifact, same test outcomes; `anthropic-api` reaches it at 62 % of the cost and 65 % of the duration. The `expect.mode` check now fails on both (composer scope both excursion), reversing the previous run.

### Notes

- **Composer non-determinism on `anthropic-api`.** Previous run (`2026-04-14T19-48-49`) → `errand`; this run → `excursion`. Same PRD, same model, same overlay. Between-run variance in composer scope is the interesting signal across this series, not a bug per se.
- **`claude-sdk` composer is *stably* over-scoping.** Three runs in a row, it picks excursion with a heavier pipeline shape (parallel review/test-write + extra review rounds). The planner consistently downgrades — wasted composer budget on a stage that the planner always corrects.
- **`expect.buildStagesExclude: test-cycle` continues to fail for both.** The PRD demands tests; errand orchestration legitimately includes `test-cycle`. Likely a scenario-spec issue rather than a variant issue.
- **Metrics aggregator healthy.** All 6 stages in both `metrics.agents`; `comparison.json` trustworthy.
