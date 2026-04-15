# Variant Analysis — 2026-04-14T19-39-48

Generated: 2026-04-14T20:15:00Z
Scenarios analyzed: 1

## todo-api-errand-health-check

**Variants:** `anthropic-api`, `claude-sdk`
**Ranking:** 1. `anthropic-api`, 2. `claude-sdk`

### Variant configs

- `anthropic-api`: backend `pi`, `max` → `claude-opus-4-6` (anthropic), `balanced` → `claude-sonnet-4-6` (anthropic). Model use confirmed in `result.json.metrics.models` — opus for every build stage, sonnet-4-6 only for `prd-validator`. 145 s at $0.41.
- `claude-sdk`: backend `claude-sdk`, default routing — `claude-opus-4-6` for planner/builder/tester/composer/formatter, `claude-sonnet-4-6` for `prd-validator`. 225 s at $0.63.

Both variants now route the *same* models to the *same* roles. This run isolates backend (`pi` + Anthropic direct vs. `claude-sdk`) as the only meaningful difference.

### Scorecard

| Dimension            | anthropic-api                | claude-sdk                   |
|----------------------|------------------------------|------------------------------|
| Pipeline composer    | excursion, `single`, lenient | excursion, `auto`, standard  |
| Planner profile      | errand (correct)             | errand (correct)             |
| Planner orchestration| `implement → test-cycle`     | `implement → test-cycle`     |
| Builder              | supertest installed, clean   | supertest installed, clean   |
| Tester               | 10 pass, no bugs             | 10 pass, no bugs             |
| Reviewer / fixer / evaluator | skipped              | skipped                      |
| PRD validator        | 100% complete                | 100% complete                |
| Doc discipline       | no touches                   | no touches                   |
| Scope discipline     | clean                        | clean                        |
| Validation           | pass                         | pass                         |
| Expectations         | mode ✗, stages ✗             | mode ✗, stages ✗             |
| Cost                 | **$0.41** (1.54× cheaper)    | $0.63                        |
| Duration             | **145 s** (80 s faster)      | 225 s                        |
| Cache hit rate       | 75 %                         | 89 %                         |

### Stage-by-stage

#### Pipeline composer
- `anthropic-api` (`anthropic-api/eforge.log:55-70`): scope=excursion; `implement → test-write → review-cycle → test-cycle`; **`strategy: single`, `maxRounds: 1`, lenient evaluator, `autoAcceptBelow: suggestion`**.
- `claude-sdk` (`claude-sdk/eforge.log:51-66`): scope=excursion; `implement → [review-cycle, test-write] → test-cycle`; **`strategy: auto`, `maxRounds: 1`, standard evaluator**.

Both kept `test-cycle` (tripping `buildStagesExclude` on both). `anthropic-api`'s composer is slightly more proportional — lenient strictness + `single` strategy is a better match for a 3-line route. `claude-sdk` parallelized review and test-write, a sensible optimization, but neither stage ran anyway because the planner downgraded to errand.

**Winner:** `anthropic-api` — lenient/single is more proportional to the PRD.

#### Planner
- `anthropic-api` (`anthropic-api/eforge.log:90-92, 106`): `<profile name="errand">` — "Trivial addition of a single route in one file and a test file."
- `claude-sdk` (`claude-sdk/eforge.log:86-88, 96`): `<profile name="errand">` — "Single-route addition with straightforward tests... mechanical."

Both downgrade the composer's excursion correctly; both still emit an orchestration with `test-cycle`, which is why `buildStagesExclude` fails on both. Reasoning quality essentially identical.

**Winner:** tie.

#### Builder / Tester
Both builders add `supertest` + `@types/supertest` per plan, edit `src/app.ts`, and create `test/health.test.ts`. Both testers run the suite (10 tests, all green) and verify acceptance criteria (`anthropic-api/eforge.log:171-185`, `claude-sdk/eforge.log:163-onwards`). `anthropic-api` is leaner by turn count (builder 5 turns / tester 7 vs. builder 15 / tester 11), which accounts for most of the token delta.

**Winner:** tie on decisions, `anthropic-api` on efficiency.

#### Review / review-fixer / evaluator
Not executed for either variant — downgraded pipelines omitted them. A real win for both, since this PRD genuinely doesn't need a review loop (consistent with the prior run's anthropic-api reviewer, which only found a speculative edge case).

#### PRD validator
Both report `completionPercent: 100, gaps: []` (`anthropic-api/eforge.log:200-206`, `claude-sdk/eforge.log` tail). Routed to `claude-sonnet-4-6` in both variants — deliberate low-stakes routing.

#### Doc discipline
Neither variant's builder/planner wrote under `docs/`, `README*`, or `CHANGELOG*`. Neither touched the PRD source (`docs/add-health-check.md`). The fixture has no project-level docs (e.g. README API reference) to update, so "missed updates" is n/a — noted as a fixture observation, not a variant fault.

#### Scope discipline
Both report `6 file(s) changed` from the builder — consistent with plan scope: `src/app.ts`, `test/health.test.ts`, `package.json`, `package-lock.json`, plus two eforge plan/region artifacts. No stray edits in either log.

### Verdict

With model routing equalized, the two backends now produce **the same decisions** — errand downgrade, `implement → test-cycle` orchestration, 10 passing tests, clean scope. The distinguishing signal is efficiency: `anthropic-api` arrives at the same artifact in 145 s / $0.41 vs. `claude-sdk`'s 225 s / $0.63 (1.54× cost, 1.55× duration). `claude-sdk`'s higher cache hit rate (89 % vs. 75 %) is more than offset by its 2.4× larger input-token volume, suggesting the `claude-sdk` harness pads more context per turn. `anthropic-api` wins on efficiency with no decision-quality penalty.

### Notes

- **Both variants still fail `expect.mode` and `expect.buildStagesExclude: test-cycle`.** Planners correctly chose `errand`, but the `mode` check likely reads pipeline-composer scope (still `excursion` for both), and orchestration kept `test-cycle` despite the errand profile. Same caveat flagged in the prior run's report — still outstanding.
- **Anthropic provider now fully configured.** `anthropic-api` uses `claude-opus-4-6` (max) + `claude-sonnet-4-6` (balanced), matching `claude-sdk`'s default routing. The prior run's `claude-sonnet-4-5`-for-everything was replaced.
- **Metrics aggregator healthy.** Both `result.json.metrics.agents` blocks contain all 6 stages the logs show running. `comparison.json` numbers are trustworthy.
- **Tool-use telemetry casing differs between backends** — `pi` backend emits lowercase tool names (`bash`, `read`, `write`), `claude-sdk` emits PascalCase (`Bash`, `Read`, `Write`). Harmless but worth noting for anyone filtering on tool names.
