# Variant Analysis — 2026-04-14T19-48-49

Generated: 2026-04-14T20:30:00Z
Scenarios analyzed: 1

## todo-api-errand-health-check

**Variants:** `anthropic-api`, `claude-sdk`
**Ranking:** 1. `anthropic-api`, 2. `claude-sdk`

### Variant configs

- `anthropic-api`: backend `pi`, `max` → `claude-opus-4-6`, `balanced` → `claude-sonnet-4-6` (both anthropic direct). Opus for every build stage, sonnet-4-6 only for `prd-validator`. 149 s / $0.42.
- `claude-sdk`: backend `claude-sdk`, default routing — opus-4-6 for planner/builder/tester/composer/formatter, sonnet-4-6 for `prd-validator`. 189 s / $0.61.

Model routing is identical across the two variants — this run continues to isolate the backend.

### Scorecard

| Dimension            | anthropic-api                      | claude-sdk                       |
|----------------------|------------------------------------|----------------------------------|
| Pipeline composer    | **errand**, single/lenient         | excursion, auto/standard         |
| Planner profile      | errand ✓                           | errand ✓                         |
| Orchestration        | `implement → test-cycle`           | `implement → test-cycle`         |
| Builder              | supertest installed, clean         | supertest installed, clean       |
| Tester               | all tests pass                     | all tests pass                   |
| Reviewer / fixer / evaluator | skipped                    | skipped                          |
| PRD validator        | 100% complete                      | 100% complete                    |
| Doc discipline       | no touches                         | no touches                       |
| Scope discipline     | clean                              | clean                            |
| Validation           | pass                               | pass                             |
| Expectations         | mode ✓, stages ✗                   | mode ✗, stages ✗                 |
| Cost                 | **$0.42** (1.43× cheaper)          | $0.61                            |
| Duration             | **149 s** (40 s faster)            | 189 s                            |

### Stage-by-stage

#### Pipeline composer
- `anthropic-api` (`anthropic-api/eforge.log:55-68`): **`scope: "errand"`**, `defaultBuild: ["implement", "test-cycle"]`, single strategy, 1 round, lenient strictness. Rationale explicitly calls this "a trivial errand."
- `claude-sdk` (`claude-sdk/eforge.log:56-75`): `scope: "excursion"`, `defaultBuild: ["implement", ["test-write", "review-cycle"], "test-cycle"]`, auto strategy, standard strictness. Rationale: "touches multiple files... making it a clear excursion."

**Winner:** `anthropic-api`, decisively. With identical models on both sides, the `pi` backend's composer correctly sized this tiny PRD as errand on the first try — the `claude-sdk` composer still over-scoped to excursion. This is the decisive dimension.

#### Planner
Both planners pick `<profile name="errand">` (`anthropic-api/eforge.log:86-88`, `claude-sdk/eforge.log:89`). Both generate `implement → test-cycle`. `claude-sdk`'s planner essentially rescues the composer's over-scoping; `anthropic-api`'s planner ratifies a scope the composer already got right (one less layer of correction needed).

**Winner:** tie on output, slight edge to `anthropic-api` — reaching the right answer without needing the planner to downgrade is a stronger pipeline.

#### Builder / Tester
Both builders install `supertest` + `@types/supertest`, edit `src/app.ts`, create `test/health.test.ts`. Both testers run the suite cleanly with no bugs raised. No review issues found by either (`reviewIssues: 0`). Artifacts functionally equivalent.

**Winner:** tie.

#### Review / review-fixer / evaluator
Not executed for either variant (`defaultBuild` in both final pipelines resolves to `implement → test-cycle`). Correct choice on both sides for a PRD of this size.

#### PRD validator
Both return `completionPercent: 100`. Both route to `claude-sonnet-4-6` per the `balanced` role — deliberate low-stakes routing, not an accident.

#### Doc discipline
Neither variant touched anything under `docs/`, `README*`, or `CHANGELOG*`. Neither touched the PRD source. Fixture has no project docs to update — fixture observation, not a variant fault.

#### Scope discipline
Both report `6 file(s) changed` — consistent with plan scope (`src/app.ts`, `test/health.test.ts`, `package.json`, `package-lock.json`, plus eforge plan artifacts). No stray edits in either log.

### Verdict

`anthropic-api` wins on the dimension that matters most for this PRD: its pipeline composer sized the work correctly on first pass as `errand`, flipping `expect.mode` to passing — the first run in this series where that check succeeds. `claude-sdk`'s composer still reaches for excursion and only arrives at the right outcome because its planner rescues the over-scoping. Same models, same artifact, but `anthropic-api` gets there 1.43× cheaper and 40 s faster with a cleaner pipeline. `buildStagesExclude` still fails on both because the errand orchestration legitimately includes `test-cycle` (the PRD asks for tests) — that expectation may be mis-specified for this scenario.

### Notes

- **`expect.mode` now passing for `anthropic-api`** — confirms that the harness reads mode from the pipeline-composer's `scope`, not from the planner's profile. Previously hidden behind both variants over-scoping.
- **`expect.buildStagesExclude: test-cycle` fails for both** regardless of mode — revisit whether it's sensible to exclude `test-cycle` from an errand that explicitly requires tests. Likely a scenario-spec issue, not a variant issue.
- **Same models, different composer outputs** — the `pi` backend's opus-4-6 composer reliably sizes small PRDs as errand across the last two runs; the `claude-sdk` backend's opus-4-6 composer over-scopes. Worth investigating whether it's a system-prompt or temperature difference between backends.
- **Metrics aggregator healthy** — all 6 stages present in both `metrics.agents` blocks; `comparison.json` trustworthy.
