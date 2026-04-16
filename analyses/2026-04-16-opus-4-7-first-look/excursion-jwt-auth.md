# Variant Analysis — 2026-04-16T17-10-03

Generated: 2026-04-16T17:35:00Z
Scenarios analyzed: 1

## todo-api-excursion-jwt-auth

**Variants:** `anthropic-api`, `anthropic-api-4-6`, `claude-sdk`
**Ranking:** 1. `anthropic-api`, 2. `anthropic-api-4-6`, 3. `claude-sdk`

**Configs tested:**
- `anthropic-api` — backend=pi, `claude-opus-4-7` for all core agents, `claude-sonnet-4-6` for prd-validator. $2.97 / 576s.
- `anthropic-api-4-6` — backend=pi, `claude-opus-4-6` for all core agents, `claude-sonnet-4-6` for prd-validator. $2.41 / 598s.
- `claude-sdk` — backend=claude-sdk, `claude-opus-4-7` for all core agents, `claude-sonnet-4-6` for prd-validator, `claude-haiku-4-5` for a minor helper path. $7.10 / 1075s.

All three passed validation (install + type-check + tests), hit the expected `excursion` mode, and ended at a working JWT-auth artifact. The differentiation is decision quality, not pass/fail.

### Scorecard

| Dimension | anthropic-api | anthropic-api-4-6 | claude-sdk |
|---|---|---|---|
| Pipeline composer | 1 — omitted doc-update, tight 2-round review | 1 — omitted doc-update, but maxRounds=3 is over-scoped | 3 — included doc-update for a fixture with no project docs |
| Planner | 2 — added supertest + @types/supertest (unneeded) | 3 — ambiguous app.ts modify, mentioned supertest without installing | 1 — native http+fetch, zero new test deps |
| Plan-reviewer | 3 — "no issues" despite missing supertest install gap | 2 — caught app.ts + supertest gaps | 1 — caught the TS module-augmentation conflation (subtle & real) |
| Builder | 2 — 25 turns, 433K tokens, pragmatic pnpm workaround | 1 — 8 turns, 84K tokens, cleanest `types.d.ts` pattern | 3 — 43 turns, 1.6M tokens |
| Tester (if ran) | — (stage omitted) | ✓ ran, 0 new findings ($0.14 spend) | — (stage omitted) |
| Reviewer | 1 — caught real subtle issues: `String(sub)` coercion, missing `exp` | 3 — looped 3 rounds re-flagging the same rejected issue | 2 — caught HS256 + dev-secret, looped once |
| Review-fixer | ~ no-op (reviewer self-applied) | ~ no-op | ~ no-op |
| Evaluator | 1 — accepted both objective vulns (HS256 + prod-guard) in one verdict | 2 — split hunks correctly, rejected prod-guard | 2 — split hunks correctly, rejected prod-guard |
| Doc discipline | ✓ no doc work | ✓ no doc work | ✗ ran doc-updater for $0.61 — correctly produced no edits but burned tokens |
| Scope discipline | ✓ in-scope; added `@types/express-serve-static-core` workaround | ✓ in-scope; cleanest footprint | ✓ in-scope |
| Final artifact | Strongest — ships with prod `JWT_SECRET` guard + HS256 pinning | HS256 pinning only; no prod guard | HS256 pinning only; no prod guard |

### Stage-by-stage

#### Pipeline composer
- `anthropic-api` — `[implement, [review-cycle, test-write]]`, perspectives `[security, correctness, api-design]`, `maxRounds=2`. Explicitly reasoned "doc-update is omitted since the PRD doesn't call out documentation updates" (`eforge.log:92`). Correct for this fixture.
- `anthropic-api-4-6` — `[implement, test-write, [review-cycle, test-cycle]]`, `maxRounds=3`. Also omitted doc-update but over-scoped the review depth (`eforge.log:69-77`).
- `claude-sdk` — `[implement, [test-write, doc-update], review-cycle]`, `maxRounds=2`, justified doc-update as "keeps project docs in sync" (`eforge.log:109`). The fixture has no project docs — only PRD-source files — so this stage cannot produce legitimate output.

**Winner:** `anthropic-api` — tightest composition that matches fixture reality.

#### Planner
- `anthropic-api` added `supertest + @types/supertest` to deps (`eforge.log:118`) — works but brings new test infrastructure that wasn't needed.
- `anthropic-api-4-6` referenced supertest in tests without adding it to `package.json`; listed `src/app.ts` under Modify with "no changes needed if..." ambiguity (`eforge.log:160`).
- `claude-sdk` chose Node's built-in `http` + `fetch` (no new test deps) and produced a crisp one-plan excursion (`eforge.log:159`).

**Winner:** `claude-sdk` — lightest-weight approach, clearest decomposition.

#### Plan-reviewer
- `anthropic-api`: "no issues found" (`eforge.log:160`). Missed nothing material because the planner pre-installed supertest.
- `anthropic-api-4-6`: flagged the `app.ts` Modify ambiguity and supertest-missing-dep gap (`eforge.log:159-164`). Real catches.
- `claude-sdk`: flagged that the plan conflated `declare global { namespace Express }` with `declare module 'express-serve-static-core'` — two distinct TS augmentation patterns the builder could botch (`eforge.log:196-197`). The builder in fact later had to fall back to the global-namespace form because pnpm hoisting made the module form unresolvable — exactly the failure mode the reviewer predicted.

**Winner:** `claude-sdk` — most technically-subtle-but-real catch.

#### Builder
- `anthropic-api-4-6` implemented in **8 turns, 84K tokens** (`result.json` metrics.agents.builder) using `src/types.d.ts` for Request augmentation. Dramatically more efficient than the other two.
- `anthropic-api` took **25 turns, 433K tokens** — wrestled with pnpm resolution and pulled in `@types/express-serve-static-core` as an extra dep (`eforge.log:231`).
- `claude-sdk` took **43 turns, 1.6M tokens** — hit the same pnpm issue and fell back to `declare global { namespace Express }` (`eforge.log:282`).

All three produced correct, type-safe code. The cost spread is ~19× between winner and loser for the same output.

**Winner:** `anthropic-api-4-6` — efficient path to the same artifact.

#### Tester (only `anthropic-api-4-6`)
Ran after test-write, re-verified all 33 tests pass, found no bugs (`eforge.log:279-343`). Worth $0.14 only if you value the extra gate — it didn't catch anything the builder's own run hadn't.

#### Reviewer
All three identified the same two primary issues: `dev-secret` fallback in production path, and `jwt.verify` missing `algorithms` pin.

- `anthropic-api` also raised `String(payload.sub)` coercion risk (`sub: {}` becomes `"[object Object]"`) and the absence of `exp` enforcement (`eforge.log:205-211`). Both are real and not raised by the other two.
- `anthropic-api-4-6` re-raised the same rejected secret-fallback issue across 3 rounds (`eforge.log:341`, `433`, `527`) — the evaluator rejected it each time with the same reasoning.
- `claude-sdk` entered a similar but shorter loop — 2 rounds, same rejected issue (`eforge.log:370`, `457`).

**Winner:** `anthropic-api` — broadest, most discriminating set of findings without cycle waste.

#### Review-fixer
Across all three variants, review-fixer was a no-op because the reviewer applied its own edits. This is a pipeline artifact, not a variant difference.

#### Evaluator
- `anthropic-api` bundled both objective fixes (HS256 pin + `resolveSecret()` prod guard) into one **accept** (`eforge.log:335-344`). Reasoned that shipping `dev-secret` to prod *is* an auth-bypass vuln, not design creep.
- `anthropic-api-4-6` and `claude-sdk` both split the hunks and **rejected** the prod guard as scope creep / intent-altering (`anthropic-api-4-6/eforge.log:380-386`; `claude-sdk/eforge.log:414-420`).

Under strict policy both interpretations are defensible. `anthropic-api`'s ruling is arguably more security-pragmatic — a `dev-secret` fallback in the production-capable path matches the "auth bypass fix" accept pattern. The other two reject for being "new startup behavior the implementor did not write," which is also coherent.

**Winner:** `anthropic-api` — reached a more pragmatic ruling in a single evaluation pass.

#### Doc discipline
Fixture note: `fixtures/todo-api/docs/` contains only PRD sources (`add-jwt-auth.md`, `add-health-check.md`, `skip-already-done.md`). There is no `README.md`, no API reference, and no JSDoc in source. A variant composing a `doc-update` stage against this fixture is paying for a stage that cannot produce useful output.

- `anthropic-api`, `anthropic-api-4-6`: no doc-updater stage composed — correct.
- `claude-sdk`: doc-updater ran 22 turns, 403K tokens, $0.61, landed on "No documentation updates were needed" (`eforge.log:337-338`). The stage correctly did nothing, but the pipeline shouldn't have scheduled it. No PRD sources were touched by any variant — good discipline across the board.

### Verdict

`anthropic-api` wins overall on decision quality: its pipeline composer correctly skipped doc-update, its reviewer surfaced real subtle issues (`String(sub)` coercion, missing `exp`) that the other two missed, and its evaluator made a more security-pragmatic call by accepting the prod-environment `JWT_SECRET` guard rather than rejecting it as scope creep. `anthropic-api-4-6` wins on raw cost-efficiency — 19× more token-efficient in the builder — but wastes that advantage with a 3-round reviewer loop that re-flags the same rejected issue. `claude-sdk` produces the cleanest planner output (smartest test-dep choice, best plan-reviewer catch on the TS augmentation conflation) but pays 2.4× `anthropic-api`'s cost for an equivalent-or-weaker final artifact, and burns $0.61 on a doc-updater stage a smarter composer would have omitted.

### Notes

- **Metrics aggregator sanity-check:** all three `result.json` files contain full per-agent breakdowns with realistic token counts — no formatter-only contamination. Numbers in this report are trustworthy.
- **backend=pi vs backend=claude-sdk:** on this scenario, pi reached equivalent or better decisions at ~40% of claude-sdk's cost with the same model family. The gap is driven by turn counts (pi builder: 8–25 turns; claude-sdk builder: 43 turns) and by claude-sdk composing an extra doc-update stage.
- **Mixed-model routing:** all three variants route `prd-validator` to `claude-sonnet-4-6` — a cheaper model for a low-stakes yes/no gate. `claude-sdk` additionally routes some minor path (unattributable from agent-level metrics) to `claude-haiku-4-5`, costing $0.10.
- **Review-fixer is a structural no-op** across all three variants because the reviewer self-applies edits. This isn't a variant-level finding — it's a pipeline design observation worth surfacing separately.
- **Opus 4.6 vs 4.7 builder divergence:** 4.6 finished this plan in 8 turns / 84K tokens; 4.7 took 25–43 turns. Worth investigating whether 4.7's extra exploration is adding quality anywhere, because here it doesn't — the final artifacts are comparable.
