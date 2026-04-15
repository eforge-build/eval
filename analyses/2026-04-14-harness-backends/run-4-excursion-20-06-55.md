# Variant Analysis — 2026-04-14T20-06-55

Generated: 2026-04-14T21:05:00Z
Scenarios analyzed: 1

## workspace-api-excursion-engagement

**Variants:** `anthropic-api`, `claude-sdk`
**Ranking:** 1. `anthropic-api`, 2. `claude-sdk` (close — see verdict)

### Variant configs

- `anthropic-api`: backend `pi`, `max` → `claude-opus-4-6`, `balanced` → `claude-sonnet-4-6` (anthropic direct). Every stage observed running on `claude-opus-4-6`; `prd-validator` would normally take `balanced` but recorded no sonnet-4-6 use this run. **43 m 32 s / $10.52**.
- `claude-sdk`: backend `claude-sdk`, default routing. Observed: opus-4-6 on every primary agent plus **`claude-haiku-4-5-20251001` invoked from inside the planner** (349 k input tokens on haiku alongside 294 k on opus). sonnet-4-6 unused. **39 m 20 s / $11.80**.

The claude-sdk backend clearly launches sub-model helpers inside a single agent call (probably a subagent/Task under the hood) — haiku only shows up in `modelUsage` for `planner`, not as a separate `agent:result` row. The `pi` backend stays single-model per agent.

### Scorecard

| Dimension                | anthropic-api                         | claude-sdk                             |
|--------------------------|---------------------------------------|----------------------------------------|
| Pipeline composer        | excursion, plan-review + review-cycle + doc-update||test-write + test-cycle, 2r | excursion, plan-review-cycle + review-cycle||test-cycle, 2r |
| Planner                  | excursion, 4 plans                    | excursion, 4 plans                     |
| Plan reviewer            | ran                                   | ran                                    |
| Plan evaluator           | **ran** (accepted/rejected plan-review fixes) | not run                        |
| Builder                  | clean scope; 5 runs (one per plan)    | clean scope; 5 runs                    |
| Tester                   | 4 runs, tests pass                    | 4 runs, tests pass                     |
| Reviewer                 | 17 issues raised                      | 24 issues raised                       |
| Evaluator (review)       | 28 verdicts, **57 % accept** (16/12)  | 25 verdicts, **28 % accept** (7/7/11 "review") |
| Review-fixer             | ran, 5 turns                          | ran, 5 turns                           |
| Merge-conflict-resolver  | 1 invocation                          | **2 invocations** — conflict surface larger |
| Validation-fixer         | ran once                              | ran once                               |
| Gap-closer / gap-close evaluator | ran; 6 accept / 4 reject      | ran; 2 accept / 3 reject               |
| PRD validator            | passed                                | passed                                 |
| Doc discipline           | no writes to docs/README              | no writes to docs/README               |
| Scope discipline         | only expected src/test files          | only expected src/test files           |
| Validation               | install ✓, type-check ✓, test ✓       | install ✓, type-check ✓, test ✓        |
| Expectations             | mode ✓                                | mode ✓                                 |
| Cost                     | **$10.52**                            | $11.80 (1.12× higher)                  |
| Duration                 | 2616 s (slower)                       | **2365 s**                             |
| Tokens total             | 6.74 M                                | 9.32 M (1.38× higher)                  |

### Stage-by-stage

#### Pipeline composer
- `anthropic-api` (`eforge.log:195-216`): scope=excursion; compile includes plan-review-cycle; defaultBuild is `["implement", "test-write", ["doc-update","review-cycle"], "test-cycle"]`; review is 2-round, `correctness + api-design`, standard strictness.
- `claude-sdk` (`eforge.log:201-214`): scope=excursion; compile includes plan-review-cycle; defaultBuild is `["implement", ["review-cycle","test-cycle"]]`; review is 2-round, standard, auto-accept suggestions.

Both sized the work as excursion with plan-review-cycle — appropriate given the foundation-then-modules structure. `anthropic-api`'s shape is more elaborate (explicit test-write stage + doc-update branch) but doc-updater did not actually fire (no doc writes observed) — composer lookaside stages that no one ran. `claude-sdk`'s is simpler but collapsed test-write into test-cycle, which limits test targeting.

**Winner:** tie on sizing; slight edge to `anthropic-api` for including a doc-update branch (intent was right, though the stage was inert for this fixture).

#### Planner / plan-reviewer / plan-evaluator
Both planners split into **4 plans** — foundation, reactions, threads, pins — per PRD structure (`anthropic-api/eforge.log:238`, `claude-sdk/eforge.log:243`). Both invoked `plan-reviewer` once. **Only `anthropic-api` ran `plan-evaluator`** (`eforge.log:397-onwards`), which arbitrated on the plan-review's suggested changes before compile finished. `claude-sdk` skipped that arbitration. In a pipeline where the foundation must be right for three modules to land cleanly, plan-evaluation is earned; its absence in `claude-sdk` is noticeable.

**Winner:** `anthropic-api` — plan-evaluator is exactly the right check for this PRD.

#### Builder / Tester
Both builders executed 5 turns across 4 plans (foundation + 3 features) and produced the expected source layout — `src/types.ts`, `src/store.ts`, `src/app.ts`, `src/stores/{reactions,threads,pins}.ts`, `src/routes/{reactions,threads,pins}.ts`, plus test files. Scope was clean in both cases (no stray edits outside the PRD's surface per monitor-DB `Write/Edit` inventory). Testers ran 4 times each with all tests passing per `validate-3-test.log`.

**Winner:** tie.

#### Reviewer
- `anthropic-api`: **17 issues** raised across the 3 feature plans + foundation. Evaluator then delivered 28 verdicts with a **57 % accept rate (16 accept / 12 reject)** — a healthy ratio where most flagged concerns turned out to be real.
- `claude-sdk`: **24 issues** raised. Evaluator delivered 25 verdicts with only a **28 % accept rate (7 accept / 7 reject / 11 "review")** — more than double the flag volume but fewer net fixes.

Higher speculation-to-real-bug ratio on `claude-sdk`. The reviewer also directly edited only one file (`src/store.ts`), while `anthropic-api`'s reviewer directly edited seven — both patterns are normal, but `claude-sdk`'s flag-and-defer style cost more downstream evaluator cycles per accepted fix.

**Winner:** `anthropic-api` — better signal-to-noise in review output.

#### Review-fixer / Evaluator
Both ran 5 turns of review-fixer + 6–7 evaluator turns. `anthropic-api`'s evaluator accepted 57 % of fixes to `claude-sdk`'s 28 % — `claude-sdk`'s pipeline absorbed more speculative reviewer churn.

#### Merge-conflict-resolver
`claude-sdk` invoked the resolver **twice** (`sqlite3` run-level count) and edited `src/routes/{pins,reactions,threads}.ts` to resolve conflicts between the parallel feature worktrees. `anthropic-api` invoked it once and touched no files via the resolver. Same PRD, same decomposition — suggests `claude-sdk`'s feature plans produced more conflicting edits on shared scaffolding (e.g. router registrations in `src/app.ts`).

**Winner:** `anthropic-api` — cleaner parallel-merge outcome.

#### Gap-closer / gap-close evaluator
- `anthropic-api`: **6 accept / 4 reject** (`eforge.log:2460`). Gap-closer found genuine gaps (idempotent hook registration in pins/reactions/threads stores — real bug around `clearX()` leaving cascade hooks unregistered after `registerDeleteHook` had already run once).
- `claude-sdk`: **2 accept / 3 reject** (`eforge.log:1998`). Gap-closer focused on minor issues (package.json indentation, type assertion, `.catch(() => null)` on fetch) — mostly cosmetic.

**Winner:** `anthropic-api` — gap-close caught substantive bugs.

#### Doc discipline
Neither variant wrote under `docs/`, `README*`, `CHANGELOG*`. `claude-sdk`'s planner **read** `docs/add-engagement-features.md` and `docs/add-extension-modules.md` (correctly, as context — the second file is another scenario's PRD but read, not written, so no anti-pattern). `anthropic-api`'s planner also read the PRD. Neither variant's composer fired a `doc-updater` agent — the composer-declared `doc-update` branch in `anthropic-api` was inert.

Fixture observation: `workspace-api/docs/` contains scenario PRDs but no project-level docs (README, API reference). No "missed update" applies.

**Winner:** tie — no touches either way.

#### Scope discipline
Monitor-DB inventory of Write/Edit tool calls confirms both variants touched only `src/{types,store,app}.ts`, `src/{stores,routes}/{reactions,threads,pins}.ts`, `test/*.test.ts`, `test/helpers.ts`, `package.json` — nothing outside the PRD's surface.

**Winner:** tie.

#### Final artifact
Both pass `pnpm install`, `pnpm type-check`, `pnpm test`. Claude-sdk has a slightly richer reviewer trail but ended up applying fewer net fixes. Functionally equivalent artifacts.

**Winner:** tie.

### Verdict

`anthropic-api` wins on **review efficiency** and **plan evaluation rigor**: its reviewer flagged half as many speculative issues (17 vs. 24) with twice the accept rate (57 % vs. 28 %), it ran a plan-evaluator on plan-review fixes (which `claude-sdk` skipped), and its gap-closer caught a real idempotent-hook bug that `claude-sdk`'s missed. `claude-sdk` finished faster but spent $1.28 more and 38 % more tokens on reviewer speculation and a second merge-conflict-resolver pass. Decision quality goes to `anthropic-api`; raw efficiency leans `claude-sdk` only on wall-clock.

### Notes

- **Mixed-model routing in `claude-sdk` planner.** The planner's `modelUsage` shows both `claude-opus-4-6` (294 k input) **and** `claude-haiku-4-5-20251001` (349 k input). This is the claude-sdk backend dispatching a haiku-backed helper from inside the planner agent — likely a subagent/Task call. The `pi` backend does not exhibit this. Meaningful architectural delta — `claude-sdk`'s planner pays less per helper turn by delegating to haiku. Worth tracking whether haiku-delegated work degrades plan quality (so far, not observable — the planner still produced 4 coherent plans).
- **`claude-sdk` evaluator returns a third verdict class ("review").** 11 of 25 verdicts are neither `accept` nor `reject` but `review` — a defer-to-human class the `pi` backend doesn't produce. Worth confirming whether the harness handles this verdict (currently not counted in `acceptedIssues`).
- **No MCP tool use, no Skill invocations on either side.** Confirmed via monitor-DB across all 6 runs. Claude-sdk backend is not exposing skills to eforge agents.
- **Neither variant's composer-declared doc-update branch produced a writer.** The `doc-updater` agent did not run in either variant despite `anthropic-api`'s composer declaring it. Likely pipeline-consolidation logic drops inert branches — confirm before declaring it a bug.
- **`anthropic-api` paid more for plan-evaluator (~$0.21) and slightly more planner/plan-reviewer tokens,** but saved substantially by running only 1 merge-conflict-resolver (vs. 2) and having a cleaner reviewer signal.
- **Metrics aggregator healthy.** Both `metrics.agents` blocks contain every stage the log shows firing (14 agents for `anthropic-api`, 13 for `claude-sdk`). `comparison.json` trustworthy.
