# Variant Analysis — 2026-04-16T18-08-51 (cross-run)

Generated: 2026-04-16T17:55:00Z
Scenarios analyzed: 1 (workspace-api-excursion-engagement, cross-run comparison)

This report compares three successful runs of the same scenario from two result sets:

| Variant | Source run | Backend / Models | eforge |
|---|---|---|---|
| `claude-sdk` | 2026-04-16T17-36-04 | `claude-sdk` (opus-4-7 default, sonnet-4-6 prd-validator, haiku-4-5 formatter) | 0.5.4 |
| `anthropic-api-4-6` | 2026-04-16T17-36-04 | `pi` backend; max=`claude-opus-4-6`, balanced=`claude-sonnet-4-6` | 0.5.4 |
| `anthropic-api` | 2026-04-16T18-08-51 | `pi` backend; max=`claude-opus-4-7`, balanced=`claude-sonnet-4-6` | **0.5.5** |

The `anthropic-api` variant previously failed in the 17-36-04 set (`expedition` compile truncated at architecture stage, no `orchestration.yaml`). An upstream fix landed before the 18-08-51 rerun on eforge 0.5.5 — so differences between `anthropic-api` and the other two reflect *both* a model choice (4.7 vs 4.6 vs claude-sdk) *and* an eforge version delta.

## workspace-api-excursion-engagement

**Variants:** claude-sdk, anthropic-api-4-6, anthropic-api (set 2)
**Ranking:** 1. **anthropic-api-4-6**, 2. anthropic-api (set 2 / 4.7), 3. claude-sdk

### Scorecard

| Dimension | claude-sdk | anthropic-api-4-6 | anthropic-api (set 2) |
|---|---|---|---|
| Pipeline composer | ✓ excursion, single review, conservative | ✓ excursion, parallel review+test-write + test-cycle | ✓ excursion, sequential implement→review→test-cycle |
| Planner | ~ sequential chain, no parallelism | ~ parallel fan-out but ignored its own app.ts merge risk | ✓ parallel fan-out with stub-router trick |
| Builder | ✓ passes, 4 plans | ✓ passes, 5 runs (one plan retried) | ✓ passes, 4 plans |
| Tester | — ran test-writer only | ✓ test-writer + iterative test-cycle | ~ inline tests from builder + test-cycle (no test-writer stage) |
| Reviewer | ~ 5 suggestions, minor only | ✓ 2 critical + 2 warning (real bugs found) | ~ 8 suggestions, no criticals |
| Review-fixer | — not run (all below threshold) | ✓ ran; evaluator blocked by scope policy | — not run (all below threshold) |
| Evaluator | — not run | ✓ enforced scope-discipline policy cleanly | — not run |
| Doc discipline | ✓ no doc touches | ✓ no doc touches | ✓ no doc touches |
| Scope discipline | ✓ | ✓ | ✓ |
| Validation | ✓ install/type-check/test | ✓ install/type-check/test | ✓ install/type-check/test |
| Cost / duration | $15.43 / 36.6 min | $9.04 / 32.9 min | $6.74 / 26.4 min |

### Stage-by-stage

#### Pipeline composer

- **claude-sdk** (`eforge.log:193-207`): excursion, `compile=[planner, plan-review-cycle]`, `build=[implement, test-write, review-cycle]`, single-strategy review with correctness/api-consistency/test-coverage perspectives. Proportional, clean rationale.
- **anthropic-api-4-6** (`eforge.log:176-190`): excursion, `build=[implement, [review-cycle, test-write], test-cycle]` — parallelizes review-cycle with test-write and adds iterative `test-cycle`. More ambitious shape; defensible given the PRD's heavy test-acceptance surface.
- **anthropic-api set 2** (`eforge.log:196-210`): excursion, `build=[implement, review-cycle, test-cycle]` — **no test-write stage**. Assumes the implementer will author tests inline during `implement`, and test-cycle just exercises/fixes them. Leaner but shifts burden to the builder.

**Winner: tie (all three).** All three correctly picked excursion. 4-6 is most rigorous; 4.7 is leanest. Choice is taste, not quality.

#### Planner

- **claude-sdk** (`eforge.log:225-248`): 4 plans, strictly sequential chain (`02 depends on 01`, `03 on 02`, `04 on 03`) "to avoid `src/app.ts` merge conflicts". Correct but leaves parallelism on the floor.
- **anthropic-api-4-6** (`eforge.log:209-230`): 4 plans, plans 02-04 declared parallel after foundation. But plan-01 wires all three router imports in `app.ts`, and the feature plans are the ones creating the router files. Plan-reviewer caught this (`eforge.log`: *"plan-01 modifies `src/app.ts` to import `reactionsRouter` from `./routes/reactions.js` … TypeScript will fail"*) and flagged three possible fixes — but did not apply one.
- **anthropic-api set 2** (`eforge.log:227-242`): 4 plans, parallel fan-out after foundation, **with plan-01 creating stub router files** that feature plans fill in. This is the right design — gets parallelism without the import-before-exists problem the 4-6 planner walked into.

**Winner: anthropic-api (set 2).** Only variant that both planned for parallelism *and* engineered around the app.ts merge problem correctly.

#### Builder / Test-writer / Tester

- **claude-sdk**: 4 builder runs, 4 test-writer runs, 4 reviewer runs (per-plan). No tester stage (no `test-cycle` in pipeline). Expensive: builder $5.53 + test-writer $4.82 + reviewer $2.34 = $12.7 on build.
- **anthropic-api-4-6**: 5 builder runs (one re-ran), 4 test-writer, 4 tester, plus validation-fixer and gap-closer. Builder+test+tester ~$6.4. Tester caught real test failures and iteratively fixed.
- **anthropic-api (set 2)**: 4 builder, no test-writer, 4 tester. Builder $2.48 wrote tests inline. Tester $0.42 iterated. Roughly $2.9 — ~4× cheaper than claude-sdk's build.

**Winner: anthropic-api-4-6** for thoroughness (dedicated tester + test-writer both ran); set-2 4.7 wins on cost-efficiency, but delegating test authorship to the builder is less calibrated.

#### Reviewer

- **claude-sdk** (`result.json:137-176`): 5 issues, all `suggestion`. Topics: error message precision, missing REST path validation, negative `limit` not guarded, `content: undefined` PATCH no-op, unnecessary sort in store. Real observations but low severity.
- **anthropic-api-4-6** (`result.json:216-256`): 5 issues (2 critical, 2 warning, 1 suggestion). Criticals:
  - PATCH `/replies/:id` with `undefined` content corrupts reply data.
  - `clearAll()` calls `clearDeleteHooks()`, silently severing module-load cascade hooks.
  Both are genuine bugs, not style.
- **anthropic-api (set 2)** (`result.json:150-207`): 8 issues, all `suggestion`. Noticed the same PATCH undefined-content issue that 4-6 flagged critical, and 4.7's other observations (hook isolation, pin `pinnedAt` tiebreaker, `Number(limit)` NaN) are real. Severity calibration is softer than 4-6.

**Winner: anthropic-api-4-6.** Found real bugs and escalated severity correctly. 4.7 saw the same bug and called it a suggestion.

#### Review-fixer / evaluator

- **claude-sdk**: didn't run (all issues below `autoAcceptBelow: suggestion` threshold).
- **anthropic-api-4-6** (`result.json:258-284`): review-fixer attempted 5 fixes; evaluator verdicted all as `review` (treat-as-reject) because the fixes touch pre-existing code the current plan's implementor did not stage. Correct per policy — but this also means **the real criticals remain unaddressed in the final artifact**.
- **anthropic-api (set 2)**: didn't run (all suggestions).

**Winner: anthropic-api-4-6.** Enforced scope-discipline policy cleanly. The policy outcome is debatable (real bugs sit in the code), but that's a pipeline-design question, not a variant-quality one.

#### Doc discipline

Queried monitor DB for Write/Edit/Bash tool uses touching `docs/`, README, CHANGELOG, or `*.md` across all agents for all three sessions. **Zero doc-file writes in any variant.** All three also refrained from running a doc-updater stage.

**Fixture observation:** `fixtures/workspace-api/docs/` contains only PRD sources (`add-engagement-features.md`, `add-extension-modules.md`). No README, no API reference, no architecture notes. There is nothing to update — so the pipeline-composers correctly omitted `doc-update`. Fixture under-specifies project documentation, but that's orthogonal to variant scoring.

#### Scope discipline

From `result.json.toolUsage`, builders wrote/edited within the plan-scoped paths for all three (stores/, routes/, test/, src/app.ts, src/store.ts, src/types.ts). No out-of-scope touches detected.

#### Final artifact

All three: `pnpm install`, `pnpm type-check`, `pnpm test` pass. Artifact quality differs only in the unaddressed reviewer findings:
- claude-sdk: 5 minor suggestions unaddressed.
- 4-6: 2 real bugs (PATCH corruption, `clearAll()` breaks cascade) unaddressed due to scope policy.
- 4.7 (set 2): 8 suggestions unaddressed, including the same PATCH-undefined bug 4-6 correctly flagged critical.

### Verdict

**`anthropic-api-4-6` is the strongest overall.** Decisive dimensions: reviewer found the real bugs and escalated them correctly; the pipeline was richer (real tester + evaluator stages doing meaningful work); scope-discipline policy enforcement was clean. Where it lost points — plan-reviewer had to flag its own plan's app.ts-before-routers mistake — it didn't self-correct. Even so, it ran the most discriminating pipeline.

**`anthropic-api` (set 2, Opus 4.7) is the pareto-efficient choice** — ~55% cheaper than claude-sdk, ~25% cheaper than 4-6, fastest wall-clock, and its planner was actually the smartest (stub-router trick). But its reviewer down-weighted the same PATCH bug to a suggestion, losing signal.

**`claude-sdk` is the weakest.** Most expensive by a large margin, sequential planner gives up parallelism with no compensating rigor, reviewer found the least, and no evaluator stage means nothing stress-tested the reviewer's output.

### Notes

- **eforge version mismatch:** set 1 ran on 0.5.4; set 2 on 0.5.5. The `anthropic-api` success in set 2 can't be isolated to the Opus-4.7 model or the "upstream fix" alone — both are confounded with the 0.5.4→0.5.5 delta. If you want a clean model comparison, re-run 4-6 on 0.5.5.
- **Pipeline-composer / planner asymmetry:** in set 1, Opus 4.7 (via pi backend) picked expedition on this PRD and the pipeline truncated after architecture (no `orchestration.yaml`, exit 1). In set 2 the same model on 0.5.5 picked excursion and produced the cleanest planner output of the three. That's the delta presumably addressed by the upstream fix — log it.
- **4-6 reviewer policy trap:** the review-fixer found two real bugs and the evaluator correctly rejected the fixes as out-of-scope. Net effect: real bugs remain. Worth revisiting whether the scope-discipline policy should carve out "bug in a file the plan *reads*, even if it didn't write it" as fixable, or at minimum surface those as blocking issues for a follow-up plan.
- **4.7 (set 2) skipped test-writer:** the pipeline-composer omitted `test-write` from `defaultBuild`, so the builder authored tests inline. Validation passed, but this design shift is worth tracking — test coverage in the final artifact may be thinner than a dedicated test-writer would produce.
