# Backend Analysis — 2026-04-18T05-00-35

Generated: 2026-04-18
Scenarios analyzed: 1
Runs per backend: 2

## workspace-api-excursion-engagement

**Backends:** `claude-sdk-4-7`, `pi-anthropic-4-7`
**Ranking:** 1. `pi-anthropic-4-7`, 2. `claude-sdk-4-7`
**Scenario:** add reactions/threads/pins to workspace-api. Expected mode: excursion. Foundation + three vertical features.

**Profiles tested:**
- `claude-sdk-4-7`: backend=`claude-sdk`, effort=`high`, max=`claude-opus-4-7`, balanced=`claude-sonnet-4-6`. Routing: opus for planner/plan-reviewer/plan-evaluator/builder/doc-updater/test-writer/tester/reviewer/review-fixer/evaluator/gap-closer; haiku-4-5 for pipeline-composer; sonnet for prd-validator.
- `pi-anthropic-4-7`: backend=`pi`, effort=`high`, max=`claude-opus-4-7`, balanced=`claude-sonnet-4-6` (both via `anthropic`). Routing: opus for pipeline-composer/planner/plan-reviewer/builder/reviewer/review-fixer/evaluator/test-writer/doc-updater; sonnet for prd-validator.

### Per-run summary

| | sdk-4-7 run-1 | sdk-4-7 run-2 | pi-4-7 run-1 | pi-4-7 run-2 |
|---|---|---|---|---|
| mode expectation | excursion ✓ | excursion ✓ | excursion ✓ | excursion ✓ |
| composer extras | `doc-update` + `test-write` + `review-cycle` | `test-cycle` + `review-cycle` | `review-cycle` + `test-write` (doc-update explicitly excluded) | `review-cycle` + `doc-update` |
| plan-review | plan-reviewer + plan-evaluator | plan-reviewer + plan-evaluator | plan-reviewer only | plan-reviewer only |
| reviewer issues | 16 (14 suggestion / 2 warning; 2 acc / 2 rej) | 9 (8 sug / 1 warn; 0/1) | 6 (4 sug / 2 warn; **2 acc / 1 rej**) | 11 (8 sug / 3 warn; 0/3) |
| gap-closer | **ran** — rescued 3 missed 404 requirements | - | - | - |
| PRD validator | 95% → gap-closer → pass | 100% | 100% | 100% |
| cost | **$16.91** | $9.99 | $11.89 | **$6.45** |
| duration | 1569s | 1776s | 2139s | 1298s |

### Scorecard

| Dimension | `claude-sdk-4-7` | `pi-anthropic-4-7` |
|---|---|---|
| Pipeline composer scope | ✓ 2/2 excursion | ✓ 2/2 excursion |
| Pipeline composer stages | ~ inconsistent; doc-update wasted on run-1 | ~ inconsistent; doc-update wasted on run-2 |
| Planner | ✓ 4-plan foundation + verticals | ✓ 4-plan foundation + verticals |
| Plan-review | +plan-evaluator (extra depth) | plan-reviewer only (no evaluator) |
| Builder | ~ run-1 missed 3 req'd 404 checks | ✓ both runs met PRD 100% at build time |
| Tester | ✓ ran both runs (test-writer or tester) | ~ run-2 omitted test-writer (composer folded tests into implement) |
| Reviewer | noisy — 16/9 issues, low accept rate | better signal — run-1 2/6 accepted |
| Review-fixer / Evaluator | ran, did not catch 404 gaps in run-1 | ran, accepted real fixes |
| Gap-closer | **triggered run-1** (rescue) | never triggered |
| Doc discipline | ✓ 0 doc touches (doc-updater found no docs to update) | ✓ 0 doc touches (same) |
| Scope discipline | ✓ no stray edits | ✓ no stray edits |
| Final artifact | ✓ validation + 100% PRD (after gap-closer on run-1) | ✓ validation + 100% PRD directly |
| Cost avg / run | $13.45 | $9.17 (1.47× cheaper) |

### Stage-by-stage

#### Pipeline composer

Both backends correctly chose `excursion` on all 4 runs (`eforge.log` — sdk run-1 composer rationale quotes the "foundation-plus-independent-verticals pattern ... typically excursion rather than expedition"; pi run-1 uses almost identical language). Mode check passes 4/4.

The interesting gap is in **stage selection**, which varies *within each backend* across the two runs on the same PRD:

- sdk run-1 (`eforge.log`): `implement` → (`test-write` ∥ `doc-update`) → `review-cycle`. Rationale for doc-update: "adds new public API endpoints" — ignoring that the fixture has no project docs.
- sdk run-2: `implement` → (`review-cycle` ∥ `test-cycle`). No doc-update. Chose `test-cycle` over `test-write` for "iterative test execution."
- pi run-1 (`eforge.log`): `implement` → (`review-cycle` ∥ `test-write`). **Explicitly excluded doc-update**: "PRD scope does not mention project documentation updates." Correct call.
- pi run-2: `implement` → (`review-cycle` ∥ `doc-update`). No separate test-write stage ("test cases authored as part of `implement`"). Included doc-update contradicting pi run-1's reasoning.

Every doc-updater invocation across the 4 runs (8 total, in sdk-1 and pi-2) produced `<doc-update-summary count="0">` — 0 updates needed because the only docs in `fixtures/workspace-api/docs/` are PRD sources. Pure waste on sdk-1 and pi-2; correctly avoided on sdk-2 and pi-1.

**Winner:** tie on scope, edge to `pi-anthropic-4-7` on stage selection — pi-1 produced the single best stage-list across the 4 runs by explicitly identifying and excluding doc-update. Neither backend was internally consistent across its two runs.

#### Planner & plan-review

Both backends produce the same 4-plan decomposition: foundation → reactions / threads / pins. sdk ran the full plan-review-cycle (plan-reviewer **and** plan-evaluator) on both runs; pi ran only `plan-reviewer` on both. This is a pipeline configuration difference more than a planner judgment difference — the planners themselves make the same call.

**Winner:** tie on decomposition; sdk does more plan-phase review work but neither caught the gap that bit sdk run-1 at PRD-validation time.

#### Builder

`claude-sdk-4-7` **run-1 missed 3 PRD requirements** — three `GET` endpoints on the threads router that the PRD explicitly requires to return 404 when the parent message/channel doesn't exist (`eforge.log` prd-validator output: "GET /messages/:messageId/replies — 404 if parent message does not exist", and two analogous misses). The builder wired the routes to their store helpers without the existence checks. The builder's own tests didn't exercise the missing-parent path.

`claude-sdk-4-7` **run-2**, `pi-anthropic-4-7` **both runs**: builder output hits PRD validator at 100% directly.

**Winner:** `pi-anthropic-4-7`. Missing 3 behavioral requirements despite a more elaborate review pipeline is a significant failure mode for sdk-run-1.

#### Reviewer / Review-fixer / Evaluator

`claude-sdk-4-7` run-1: 7 reviewer invocations, **16 issues** raised — 14 suggestion-level, 2 warning. 2 accepted / 2 rejected; the rest auto-accepted-below-threshold or exceeded maxRounds. **None of the 16 issues flagged the missing 404 existence checks** that prd-validator later caught. Classic deep-but-shallow review: lots of style/suggestion noise, missed the real behavioral gaps.

`claude-sdk-4-7` run-2: 5 reviewer invocations, 9 issues, 0 accepted / 1 rejected — effectively no net value.

`pi-anthropic-4-7` run-1: 5 reviewer invocations, **6 issues** raised — 4 suggestion / 2 warning. **2 accepted / 1 rejected** — the best accept ratio across all 4 runs, meaning the issues that did get raised were more often real.

`pi-anthropic-4-7` run-2: 5 reviewer invocations, 11 issues, 0 accepted / 3 rejected — noise-heavy similar to sdk-2.

**Winner:** `pi-anthropic-4-7` on signal quality (pi-1 is the clearest case of a review actually helping); `claude-sdk-4-7` ran more review rounds and got less for it on run-1.

#### Gap-closer (sdk run-1 only)

After prd-validator flagged the 3 missed 404 requirements, `gap-closer` wrote a small remediation plan ("add `getMessageById`/`getChannelById` existence checks to three route handlers") and re-implemented. The fix was correct and PRD validation then passed at 100%.

This is **rescued work** in exactly the sense the skill flags as "weaker than avoiding it": ~$0.17 and 5 extra turns to patch something the upstream reviewer should have caught. None of the other 3 runs needed this.

**Winner:** `pi-anthropic-4-7` by not needing the rescue.

#### Final artifact

All 4 runs pass `pnpm install`, `pnpm type-check`, `pnpm test`, and prd-validator at 100%. Functionally equivalent end states across backends.

### Verdict

`pi-anthropic-4-7` wins on decision quality and cost: it hit PRD 100% directly on both runs, produced the single best reviewer signal/noise (run-1, 2/6 accepted), and ran at ~1.47× lower cost on average. `claude-sdk-4-7` ran a deeper pipeline (plan-evaluator + more reviewer rounds) and on run-1 still missed 3 explicit PRD requirements — requiring gap-closer to rescue. The depth of sdk's review did not translate into finding real bugs; it mostly produced suggestion-level noise.

Both backends are inconsistent on composer stage-list choices across their two runs (wasted doc-updater on sdk-1 and pi-2). Neither is a decisive win on composer alone — but sdk's review+evaluator pipeline failing to catch concrete 404-behavior gaps is the decisive per-run data point.

### Notes

- **Gap-closer as backstop:** sdk run-1 demonstrates the PRD-validator → gap-closer pathway working as designed, but it's evidence that the upstream review stages (16 issues raised, plan-evaluator ran) didn't find the real gaps. Worth digging into whether the reviewer's prompt is over-indexed on style/suggestion-level issues vs. behavioral spec compliance.
- **Doc-update scheduling on doc-less fixtures:** 8 doc-updater invocations across sdk-1 and pi-2, all producing `count="0"`. Composer should have a rule: "if no project docs exist, omit doc-update." Currently each plan's doc-updater re-discovers this empty state. Fixture-level fix: either add a minimal README to `fixtures/workspace-api/` to make doc-update meaningful, or add a composer check.
- **plan-review-cycle asymmetry:** sdk ran plan-reviewer AND plan-evaluator; pi ran only plan-reviewer. Both composers requested `plan-review-cycle` — worth checking whether the difference is in how each backend's eforge config resolves the "cycle" to stages, or in agent registration. Regardless, the extra plan-evaluator step on sdk did not prevent the run-1 behavioral miss.
- **Metrics aggregator bug (fix not yet applied here):** the aggregate `result.json` files for both backends still lack an `expectations` field, so `comparison.json` reports `expectationsPassed: true` by default. In this run, all 4 per-run files have `expectations.passed: true` anyway (mode matches) so the rollup happens to be correct. The fix landed after this eval started.
- **Fixture observation (same as prior runs):** `fixtures/workspace-api/docs/` contains only PRD source files (`add-engagement-features.md`, `add-extension-modules.md`). No project documentation. doc-update is non-discriminating — neither backend's doc-updater wrote anything.
- **Intra-backend variance is high** on this scenario: sdk-1 costs $16.91 vs sdk-2 $9.99 (1.7×); pi-1 $11.89 vs pi-2 $6.45 (1.8×). 2 runs per backend is thin — a third run would help triangulate. The per-run stage-list variance is the main driver, not model variance.
