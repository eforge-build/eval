# Opus 4.7 Day-of-Release Eval (2026-04-16)

Same-day first-look eval data following Anthropic's release of Claude Opus 4.7. Three variants compared across three scales on the eforge evaluation framework.

## Variants

| Variant | Backend | `max` model | `balanced` model |
|---|---|---|---|
| `anthropic-api` | pi | `claude-opus-4-7` | `claude-sonnet-4-6` |
| `anthropic-api-4-6` | pi | `claude-opus-4-6` | `claude-sonnet-4-6` |
| `claude-sdk` | Claude Agent SDK | `claude-opus-4-7` | `claude-sonnet-4-6` |

`balanced` is invoked only by `prd-validator`. Per-agent model routing was held constant within each backend. The `claude-sdk` variant additionally routes `pipeline-composer` to `claude-haiku-4-5-20251001` — this routing is performed by the SDK itself, not configured in eforge. The composer is a high-leverage stage (it sets scope/stages for the whole run), so this is not a minor routing detail — see "What replicated" below.

## Scales and scenarios

| Scale | Scenario | Runs today | Analysis file |
|---|---|---|---|
| Errand | `todo-api-errand-health-check` — add a `/health` endpoint | 7 (token/cost summarized below; one scorecard published) | [`errand-health-check.md`](./errand-health-check.md) |
| Light excursion | `todo-api-excursion-jwt-auth` — add JWT auth | 1 | [`excursion-jwt-auth.md`](./excursion-jwt-auth.md) |
| Heavy excursion | `workspace-api-excursion-engagement` — reactions, threads, pins across 4 parallel plans (same scenario used in [yesterday's harness-backends eval](../2026-04-14-harness-backends/)) | 1 cross-run set (see version confound below) | [`excursion-workspace-engagement.md`](./excursion-workspace-engagement.md) |

Cost spans roughly 30× across scales ($0.47 on cheapest errand variant to $15.43 on heaviest excursion variant), so "excursion" is decomposed into light and heavy tiers for this report.

## Raw data

### Errand — `todo-api-errand-health-check` (n=7)

| Run start (UTC) | 4.7 Pi tokens / cost | 4.6 Pi tokens / cost | SDK 4.7 tokens / cost |
|---|---|---|---|
| 15:52 | 669k / $0 \* | 157k / $0.43 | — |
| 15:58 | 918k / $0 \* | 171k / $0.46 | — |
| 16:17 | 347k / $0.72 | 155k / $0.46 | — |
| 16:22 | 957k / $1.40 | 178k / $0.46 | 918k / $1.40 |
| 16:28 | 373k / $0.77 | 572k / $0.96 | 2.62M / $3.20 |
| 16:42 | 238k / $0.54 | 504k / $0.98 | 1.77M / $2.45 |
| 16:53 | 545k / $1.04 | 168k / $0.47 | 1.81M / $2.25 |
| **Mean** | **578k / $0.89 †** | **272k / $0.60** | **1.78M / $2.33 ‡** |
| **Range** | 238k – 957k | 155k – 572k | 918k – 2.62M |

\* Cost tracking for 4.7 was unreliable before backend dependencies (`pi`, Claude Agent SDK) were updated mid-session to versions containing the Opus 4.7 pricing table. Token counts are reliable throughout.
† 4.7 Pi mean cost computed over the 5 runs with tracked cost (runs 16:17 onward).
‡ `claude-sdk` was introduced on run 4; n=4 for SDK means.

**Cross-variant ratios (errand):**
- 4.7 Pi / 4.6 Pi mean tokens: **2.12×** (per-run range 0.47× – 5.4× — high variance)
- SDK / 4.6 Pi mean tokens, runs 4–7 (n=4 common): **5.02×**
- SDK / 4.7 Pi mean tokens, runs 4–7 (n=4 common): **3.37×**
- Mean cache hit rate: 4.7 Pi 84%, 4.6 Pi 73%, SDK 86%

SDK has the highest cache hit rate at errand and light excursion (86% vs 84%; 91% vs 88%) and ties 4.6 Pi within 2pp at heavy excursion (89% vs 87%). It still costs multiples of Pi on comparable scenarios (per-run ratios vary — see scorecards) — raw input volume outruns the caching advantage. Cache efficiency is not a cost-efficiency proxy.

### Light excursion — `todo-api-excursion-jwt-auth` (n=1, run 17:10:03)

| Variant | Tokens | Cost | Duration | Cache hit |
|---|---|---|---|---|
| 4.7 Pi | 1.63M | $2.97 | 576s (9m 36s) | 88% |
| 4.6 Pi | 1.23M | $2.41 | 598s (9m 58s) | 83% |
| SDK 4.7 | 5.71M | $7.10 | 1075s (17m 55s) | 91% |

### Heavy excursion — `workspace-api-excursion-engagement` (n=1, cross-set)

| Variant | Source run | eforge | Tokens | Cost | Duration | Cache hit |
|---|---|---|---|---|---|---|
| 4.6 Pi | 17:36:04 | 0.5.4 | 5.28M | $9.04 | 1974s (32m 54s) | 87% |
| SDK 4.7 | 17:36:04 | 0.5.4 | 11.67M | $15.43 | 2195s (36m 35s) | 89% |
| 4.7 Pi | 18:08:51 | 0.5.5 | 2.97M | $6.74 | 1584s (26m 24s) | 87% |

4.7 Pi on 0.5.4 failed (expedition compile truncated at architecture stage with no `orchestration.yaml`); the 18:08:51 rerun on 0.5.5 is the only successful 4.7 data point at this scale. See the [heavy excursion analysis](./excursion-workspace-engagement.md) for details on the version confound.

## What replicated

**1. SDK cost premium at every scale.** `claude-sdk` cost more than the Pi backend on every scenario. At mean across the 4 errand runs where all three variants ran, SDK / 4.7-Pi cost ratio was ~2.6× and SDK / 4.6-Pi was ~3.2×; per-run same-model ratios (SDK 4.7 vs Pi 4.7) spanned 1.0×–4.5×. At light excursion, SDK / 4.7-Pi was 2.4×. Consistent with the [2026-04-14 harness-backends eval](../2026-04-14-harness-backends/) and the accompanying [blog post](https://www.markschaake.com/posts/eval-eforge-harness-backends/).

**2. SDK composer over-scoping via SDK-internal haiku delegation.** The `claude-sdk` variant's `pipeline-composer` runs on `claude-haiku-4-5` — a delegation performed by the SDK, not configured in eforge. On the errand scenario, the haiku-routed composer over-scoped to `excursion` on multiple runs. On the light excursion, it added a `doc-update` stage to a fixture with no project documentation. This extends the 2026-04-14 "SDK silently dispatches a second model" finding: the same delegation pattern is now observed at a second stage (pipeline-composer, not just planner), and the upfront scope/stage decision has higher downstream leverage than the planner delegation noted yesterday.

**3. 4.7 token premium over 4.6 at errand scale.** Across 7 errand runs, 4.7 Pi used more tokens than 4.6 Pi in 5 runs. Ratio ranged from 0.47× to 5.4× — directional, not a fixed multiplier. Cost attribution for 4.7 is only reliable on the later runs: backend dependencies (pi, Claude Agent SDK) were updated mid-session to versions containing the Opus 4.7 pricing table, so the earliest runs recorded `$0` for the 4.7 variant despite real token spend. Token counts are unaffected. On runs with reliable cost data, 4.7 Pi was more expensive than 4.6 Pi in 3 of 5.

## What did not replicate

Decision-quality findings disagreed between the light and heavy excursion runs:

| Dimension | Light excursion (JWT auth) | Heavy excursion (workspace engagement) |
|---|---|---|
| Decision quality winner | `anthropic-api` (4.7 Pi) | `anthropic-api-4-6` (4.6 Pi) |
| 4.7 Pi reviewer behavior | caught real subtle issues (`String(sub)` coercion, missing `exp` enforcement) | saw the same PATCH-undefined bug 4.6 flagged `critical`, down-weighted it to `suggestion` |
| 4.6 Pi reviewer behavior | 3-round loop re-raising the same rejected issue | found 2 real bugs, escalated severity correctly |
| Builder efficiency winner | 4.6 Pi (8 turns / 84K tokens) vs 4.7 Pi (25 turns / 433K tokens) — ~5× | 4.7 Pi vs 4.6 Pi on builder + test stages combined: ~$2.9 vs ~$6.4 — ~2.2× (see heavy-excursion scorecard; the two variants composed different pipelines, so the numerator differs in what's included) |

Both "4.7 has sharper judgment" and "4.6 has sharper judgment" positions find n=1 support. Which one you'd publish depends entirely on which excursion you ran. This is the pattern the 2026-04-14 post [specifically warned about](https://www.markschaake.com/posts/eval-eforge-harness-backends/).

## Confounds

**eforge version delta in the heavy excursion set.** `anthropic-api` (4.7) initially failed on eforge 0.5.4 on this scenario — the pipeline composer picked `expedition` and the compile truncated at the architecture stage with no `orchestration.yaml` produced. An upstream fix landed before the 4.7 rerun on eforge 0.5.5. The `anthropic-api-4-6` and `claude-sdk` variants ran on 0.5.4. Differences in the heavy excursion analysis conflate model choice with the 0.5.4→0.5.5 version delta.

**Sample sizes.** n=7 at errand; n=1 at each excursion tier. Token and cost metrics replicated at these sample sizes in yesterday's eval; behavioral metrics did not. Today's data is consistent with that pattern.

## Methodological note

The [2026-04-14 harness-backends post](https://www.markschaake.com/posts/eval-eforge-harness-backends/) concluded that behavioral metrics on excursion-scale scenarios do not reliably replicate at small sample sizes, and warned that single-run quality claims reverse direction between runs. Today's data (n=2 excursion comparisons, light and heavy) is consistent with that warning: the two behavioral-quality comparisons between 4.7 and 4.6 disagreed on the decision-quality winner. Token and cost metrics remained stable, same as yesterday.

No 4.7-vs-4.6 quality claim is published here. The per-scenario analyses are the primary artifact. Readers who want a clean model comparison should re-run the heavy excursion on matched eforge versions with n ≥ 3 per variant before drawing conclusions.

## Files

- [`errand-health-check.md`](./errand-health-check.md) — 3-variant scorecard on `todo-api-errand-health-check`
- [`excursion-jwt-auth.md`](./excursion-jwt-auth.md) — 3-variant scorecard on `todo-api-excursion-jwt-auth` (light excursion)
- [`excursion-workspace-engagement.md`](./excursion-workspace-engagement.md) — cross-run comparison on `workspace-api-excursion-engagement` (heavy excursion; includes eforge version confound notes)
