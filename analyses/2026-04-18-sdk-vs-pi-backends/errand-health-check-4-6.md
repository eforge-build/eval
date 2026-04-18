# Backend Analysis — 2026-04-18T04-38-11

Generated: 2026-04-17
Scenarios analyzed: 1
Runs per backend: 3 (behavior varies across runs — cited per-run where relevant)

## todo-api-errand-health-check

**Backends:** `claude-sdk-4-6`, `pi-anthropic-4-6`
**Ranking:** 1. `pi-anthropic-4-6`, 2. `claude-sdk-4-6`

**Profiles tested:**
- `claude-sdk-4-6`: backend=`claude-sdk`, effort=`high`, max=`claude-opus-4-6`, balanced=`claude-sonnet-4-6`. Observed routing: opus-4-6 for planner/builder/test-writer/reviewer; haiku-4-5 for pipeline-composer (sdk default); sonnet-4-6 for prd-validator.
- `pi-anthropic-4-6`: backend=`pi`, effort=`high`, max=`claude-opus-4-6`, balanced=`claude-sonnet-4-6` (both via `anthropic` provider). Observed routing: opus-4-6 for pipeline-composer/planner/builder/tester; sonnet-4-6 for prd-validator.

### Per-run expectations

| | claude-sdk-4-6 | pi-anthropic-4-6 |
|---|---|---|
| run-1 | mode=excursion ✗ | mode=errand ✓, buildStagesExclude fails (test-cycle) ✗ |
| run-2 | mode=errand ✓ | mode=errand ✓, buildStagesExclude fails (test-cycle) ✗ |
| run-3 | mode=excursion ✗ | mode=errand ✓, buildStagesExclude fails (test-cycle) ✗ |
| **pass rate** | 1/3 | 0/3 |

Both backends fail the scenario's expectations, but in **different ways**: sdk-4-6 flips between errand/excursion on scope choice; pi-anthropic-4-6 consistently picks errand scope but always injects a `test-cycle` build stage that the scenario explicitly excludes.

### Scorecard

| Dimension | `claude-sdk-4-6` | `pi-anthropic-4-6` |
|---|---|---|
| Pipeline composer | ✗ over-scopes to excursion 2/3 | ~ mode correct 3/3, but includes test-cycle 3/3 |
| Planner | ✓ errand profile override 3/3 | ✓ errand profile 3/3 |
| Builder | ✓ correct; installs supertest as dep | ✓ correct; installs supertest as dep |
| Tester | ✓ test-writer, 7-14 tests, some speculative | ✓ tester (test-cycle), explicit checklist mapping to acceptance criteria |
| Reviewer | ran run-1 only (0 issues); skipped runs 2-3 | did not run (not in pipeline) |
| Doc discipline | ✓ no doc touches | ✓ no doc touches |
| Scope discipline | ~ package-lock in diff | ~ package-lock in diff |
| Final artifact | ✓ validation passes | ✓ validation passes |
| Cost/run (avg) | $1.58 | $0.57 |
| Duration/run (avg) | 326s | 170s |
| Expectations pass rate | 1/3 | 0/3 |

### Stage-by-stage

#### Pipeline composer

`claude-sdk-4-6` is inconsistent across runs:
- run-1 (`eforge.log:Pipeline: excursion`): "PRD explicitly requires tests (3 specific test cases) and the work touches multiple files ... Excursion is appropriate over errand." Pipeline: `["implement", "test-write", "review-cycle"]`.
- run-2 (`eforge.log`): **errand** — "touches at most two or three files with no cross-cutting concerns ... Errand scope is appropriate." Pipeline: `["implement", "test-write"]`.
- run-3 (`eforge.log`): excursion again — same rationale as run-1.

Same PRD, same model, three different scope decisions. The composer's stated reasoning ("explicit test requirements push beyond errand") is inconsistent with its own run-2 logic.

`pi-anthropic-4-6` picks **errand** on all 3 runs but consistently uses `["implement", "test-cycle"]` as defaultBuild rather than `["implement", "test-write"]`. Rationale (run-1, `eforge.log`): "we want to verify the tests pass against the implementation." `test-cycle` is a heavier stage than `test-write` — it iterates on tests until they pass rather than just writing them once — and the scenario's `expect.buildStagesExclude: ["test-cycle"]` explicitly forbids it for errand.

**Winner:** neither cleanly — this is a **tradeoff**. pi gets the scope label right 3/3 (the primary signal), but injects a stage the scenario rules out. sdk gets the scope label right only 1/3 and on excursion runs adds a review-cycle that produces zero issues. Edge to `pi-anthropic-4-6`: getting errand on 3/3 with a minor build-stage overspec is closer to the expectation than flipping a coin on scope and then scheduling a useless reviewer.

#### Planner

Both backends' planners correctly submitted the `errand` profile on every run (sdk runs 1/2/3, pi runs 1/2/3). The errand profile explicitly skips plan-review-cycle on both sides. On `claude-sdk-4-6` the planner's errand override appears to *also* cascade into skipping the composer's review-cycle on run-3 (no reviewer entries in the log) but **not** on run-1 (reviewer ran). Same composer pipeline shape, same planner profile, different runtime behavior — flag this inconsistency in eforge itself.

**Winner:** tie on the decision; sdk has an unexplained run-to-run variance in how the errand override propagates.

#### Builder

Functionally equivalent on both sides: `GET /health` on `src/app.ts` returning `{ status: 'ok', timestamp: <ISO 8601> }`, install `supertest` + `@types/supertest`, type-check passes. Both pick `supertest` independently (neither was hinted in the PRD). Both commit `package-lock.json` in the diff (minor scope leak on both).

**Winner:** tie.

#### Tester

`claude-sdk-4-6` test-writer (run-1, `eforge.log:184-193`) rewrote the builder's 3 tests into 7, adding: content-type, timestamp recency, exact-key shape, and an `/todos/health` negative test. Thorough but some coverage (recency window) is speculative.

`pi-anthropic-4-6` tester (run-1, `eforge.log:173-195`) explicitly mapped its work to the plan's verification checklist, identified criterion #4 (app-level mounting) as only implicitly covered, and added a targeted `/todos/health` 404 test. Checklist-driven rather than coverage-maximizing.

Both produce solid tests. The pi tester's explicit criterion-mapping is a nicer pattern; the sdk test-writer's output is broader but less focused.

**Winner:** slight edge to `pi-anthropic-4-6` for criterion-traceability.

#### Reviewer

`claude-sdk-4-6` run-1 only (`eforge.log:195-219`): reviewer ran, inspected all changed files, raised **0 issues**. Cost ~$0.10 and ~20s for no delta. Runs 2 and 3 did not run the reviewer (different reasons — run-2 because composer chose errand, run-3 because the planner's errand profile override took effect).

`pi-anthropic-4-6`: reviewer was never in the pipeline on any run.

**Winner:** `pi-anthropic-4-6` — avoiding the stage outranks running it and finding nothing.

#### Final artifact

Both validation commands pass on every run (install, type-check, test). PRD-validator returns 100% complete, 0 gaps on every run. Functionally equivalent `/health` endpoints.

### Verdict

`pi-anthropic-4-6` wins on decision quality, but less decisively than the 4-7 comparison. Its pipeline-composer gets the `errand` scope call right 3/3 and it ships at 2.75× lower cost and nearly 2× faster. The caveat is that pi consistently includes a `test-cycle` stage the scenario explicitly excludes — so **neither backend passes expectations on all 3 runs**. sdk-4-6's pipeline-composer is unstable (2/3 over-scope to excursion) and on the one run where review-cycle actually executed, it produced zero issues. Both backends produce equivalent working artifacts; the decision-quality gap is smaller than the raw cost ratio makes it look.

### Notes

- **Aggregator bug persists:** `comparison.json` reports `expectationsPassed: true` for **both** backends (lines 22, 31), but per-run `result.json` files show sdk-4-6 failing on 2/3 runs (mode=excursion) and pi-anthropic-4-6 failing on 3/3 runs (buildStagesExclude includes test-cycle). Same aggregator gap flagged in the 2026-04-18T04-22-33 report — not yet fixed.
- **sdk reviewer firing inconsistency:** same composer output (excursion + review-cycle), same planner output (errand profile), but the reviewer ran in run-1 and did not run in run-3. Worth investigating in eforge — the planner's errand profile should either always or never suppress a composer-scheduled review-cycle.
- **pi-anthropic's `test-cycle` choice:** `test-cycle` is a heavier stage than `test-write` (iterative). On this trivial PRD the difference is small, but it still violates the scenario's expectation. Worth asking whether the composer is mis-reading "PRD requires tests" as "requires iterative test verification."
- **Fixture observation (same as prior run):** `fixtures/todo-api/docs/` contains only PRD source files (`add-health-check.md`, `add-jwt-auth.md`, `skip-already-done.md`). No project documentation. Doc discipline is not a discriminating dimension for this scenario.
- Metrics aggregator otherwise healthy: all expected agents present per backend (7 for sdk run-1 with reviewer; 6 for sdk runs 2/3 and all pi runs without reviewer).
- Model routing asymmetry unchanged vs the 4-7 run: sdk routes pipeline-composer to haiku-4-5, pi routes it to opus-4-6. The weaker model (haiku) produces less consistent scope decisions.
