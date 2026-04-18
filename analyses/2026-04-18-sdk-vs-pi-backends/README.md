# Claude Agent SDK vs. Pi Backend — Two-Scale Comparison (2026-04-18)

Two backend profiles — `claude-sdk` and `pi` (Anthropic direct) — compared on two scenarios using matched model tiers within each scenario. Errand-scale comparison runs Opus 4.6; excursion-scale comparison runs Opus 4.7. Both backends use the same model at each scale, so within-scale differences isolate backend behavior (pipeline-composer routing, SDK-internal delegation) rather than model capability.

Follows on from [2026-04-14 harness-backends](../2026-04-14-harness-backends/) and [2026-04-16 opus-4-7 first look](../2026-04-16-opus-4-7-first-look/), which established the SDK-over-Pi cost premium and the SDK-composer-over-scopes-via-haiku pattern on separate scenarios.

## Variants

| Variant | Backend | `max` model | `balanced` model | Scales run |
|---|---|---|---|---|
| `claude-sdk-4-6` | Claude Agent SDK | `claude-opus-4-6` | `claude-sonnet-4-6` | errand |
| `pi-anthropic-4-6` | pi (Anthropic direct) | `claude-opus-4-6` | `claude-sonnet-4-6` | errand |
| `claude-sdk-4-7` | Claude Agent SDK | `claude-opus-4-7` | `claude-sonnet-4-6` | excursion |
| `pi-anthropic-4-7` | pi (Anthropic direct) | `claude-opus-4-7` | `claude-sonnet-4-6` | excursion |

`balanced` is invoked only by `prd-validator`. The `claude-sdk` backend additionally routes `pipeline-composer` to `claude-haiku-4-5` — this is an SDK-internal delegation not configured in eforge, and matches the routing observed in prior evals. `pi` routes pipeline-composer to the configured `max` model.

## Scales and scenarios

| Scale | Scenario | Runs per backend | Analysis file |
|---|---|---|---|
| Errand | `todo-api-errand-health-check` — add `GET /health` endpoint | 3 | [`errand-health-check.md`](./errand-health-check.md) |
| Excursion | `workspace-api-excursion-engagement` — reactions, threads, pins across 4 parallel plans | 2 | [`excursion-workspace-engagement.md`](./excursion-workspace-engagement.md) |

Model tier differs across scales — the errand comparison is a 4-6-vs-4-6 backend contrast; the excursion comparison is a 4-7-vs-4-7 backend contrast. Cross-scale numbers therefore mix backend and model effects. See Confounds.

## Raw data

### Errand — `todo-api-errand-health-check` (n=3 per backend)

| Backend | Total tokens | Total cost | Mean cost / run | Mean duration / run | Mean cache hit |
|---|---|---|---|---|---|
| `claude-sdk-4-6` | 3.46M | $4.74 | $1.58 | 326s | ~83% |
| `pi-anthropic-4-6` | 843K | $1.72 | **$0.57** | **170s** | ~79% |

**Cross-backend ratios (errand):**
- SDK / pi mean cost: **2.75×**
- SDK / pi mean tokens (totals / n): **4.10×**
- SDK / pi mean duration: **1.92×**

**Expectation pass rates (from per-run `result.json`, not `comparison.json` — see Confounds):**
- `claude-sdk-4-6`: **1/3** (mode=excursion on runs 1 and 3)
- `pi-anthropic-4-6`: **0/3** (every run includes `test-cycle` in the build stages, which `expect.buildStagesExclude` forbids)

### Excursion — `workspace-api-excursion-engagement` (n=2 per backend)

Per-run:

| Backend | Run | Tokens | Cost | Duration |
|---|---|---|---|---|
| `claude-sdk-4-7` | 1 | 11.05M\* | $16.91 | 1569s |
| `claude-sdk-4-7` | 2 | 8.84M\*  | $9.99 | 1776s |
| `pi-anthropic-4-7` | 1 | 6.50M\* | $11.89 | 2139s |
| `pi-anthropic-4-7` | 2 | 3.83M\* | $6.45 | 1298s |

\* Per-run token split inferred by apportioning the aggregate roughly per cost; aggregate totals are authoritative. Aggregate per backend (2 runs):

| Backend | Total tokens | Total cost | Mean cost / run | Mean cache hit |
|---|---|---|---|---|
| `claude-sdk-4-7` | 19.89M | $26.91 | $13.45 | ~88% |
| `pi-anthropic-4-7` | 10.34M | $18.35 | **$9.17** | ~87% |

**Cross-backend ratios (excursion):**
- SDK / pi mean cost: **1.47×**
- SDK / pi mean tokens: **1.92×**

**Mode expectation:** both backends pass 2/2 (all 4 runs picked `excursion`).

**Behavioral differentiator:** `claude-sdk-4-7` run-1 shipped with 3 missed PRD requirements (404 existence checks on thread/reply routes). The `gap-closer` stage rescued the run to 100% PRD pass. The other 3 runs (sdk-run-2, pi-run-1, pi-run-2) all hit 100% PRD validation directly.

## What replicated

**1. `pi` costs less than `claude-sdk` at every scale, on matched model tier.** Errand: 2.75× (Opus 4.6, same-model comparison). Excursion: 1.47× (Opus 4.7, same-model comparison). Consistent with [2026-04-14 harness-backends](../2026-04-14-harness-backends/) and [2026-04-16 opus-4-7 first look](../2026-04-16-opus-4-7-first-look/). The SDK's higher cost at matched model is not explained by caching — cache hit rates are within a few points across backends at both scales.

**2. SDK pipeline-composer instability via haiku delegation.** The `claude-sdk` variant routes `pipeline-composer` to `claude-haiku-4-5` on both scales. At errand: same PRD, same model, 3 runs → 2 different scope decisions (excursion / errand / excursion). At excursion: mode was stable but stage-list varied across runs (doc-update included in run-1, dropped in run-2). This is the third eval in which the SDK-haiku-composer has shown less consistent scope/stage decisions than pi's opus-composer on the same PRD — see [errand detail](./errand-health-check.md#pipeline-composer) and [excursion detail](./excursion-workspace-engagement.md#pipeline-composer).

**3. `pi-anthropic` makes better decisions at both scales.**
- Errand: pi gets the `errand` scope label 3/3; sdk gets it 1/3. See [`errand-health-check.md`](./errand-health-check.md#pipeline-composer).
- Excursion: pi hits PRD 100% directly on both runs with no gap-closer; sdk-run-1 missed 3 required 404 checks despite a deeper review pipeline (16 reviewer issues raised, plan-evaluator ran) and needed `gap-closer` to rescue. See [`excursion-workspace-engagement.md`](./excursion-workspace-engagement.md#builder).

**4. Doc-updater on doc-less fixtures remains wasted compute.** Both fixtures (`todo-api`, `workspace-api`) contain only PRD sources under `docs/`, no project documentation. Every doc-updater invocation across both scenarios produced `count=0`. Same fixture-level gap flagged in the 2026-04-16 set.

## What did not replicate

Expectation pass-rates at the errand scale: **neither backend passes its own expectations consistently**, but they fail in different, non-overlapping ways.

| Backend | Mode correct | `buildStagesExclude=[test-cycle]` respected |
|---|---|---|
| `claude-sdk-4-6` | 1/3 | 1/1 (on the one run where mode was right) |
| `pi-anthropic-4-6` | 3/3 | 0/3 (every run injects `test-cycle`) |

This is not a head-to-head disagreement — it's two different kinds of inconsistency. `pi` is consistently wrong on a minor stage choice; `sdk` is inconsistently wrong on the primary scope decision. A headline "pi is more consistent" reading is true for scope but false for stage-list.

Both backends also exhibit high intra-backend variance on stage-list selection at the excursion scale across just 2 runs each (sdk includes `doc-update` on run-1, drops it on run-2; pi excludes `doc-update` on run-1, includes it on run-2). This is an internal inconsistency in each backend's composer, not a cross-backend disagreement. Sample is too small (n=2) to say whether one is more stable than the other.

## Confounds

**Model tier differs across scales.** The errand comparison uses Opus 4.6 for both backends; the excursion comparison uses Opus 4.7 for both. The within-scale comparison isolates backend differences cleanly (both sides on the same model). The *cross-scale* comparison — whether the SDK/pi cost gap narrows at higher scales (2.75× → 1.47×) because of scale or because of the model change from 4.6 → 4.7 — **cannot be resolved from this data**. A clean test would re-run errand on 4-7 models or excursion on 4-6 models.

**Aggregator bug in `comparison.json`.** Both runs' `comparison.json` reports `expectationsPassed: true` for every backend, but per-run `result.json` files show failures on 5/6 errand runs. The aggregate rollup is currently incorrect at the errand scale; it happens to be correct at the excursion scale (all 4 runs pass the mode expectation). Any automated pass/fail monitoring on `comparison.json` will under-report failures until this is fixed. Per-run files are the source of truth.

**Sample sizes.** n=3 at errand, n=2 at excursion. Cost and token totals replicate across evals at these sizes; expectation-pass-rate and per-stage decision-quality claims do not. Intra-backend run-to-run variance on cost is 1.7–1.8× at the excursion scale, which is larger than the 1.47× between-backend mean difference — so the excursion-scale cost ratio is directional, not a confident estimate.

**Fixture doc gap.** Neither `fixtures/todo-api/docs/` nor `fixtures/workspace-api/docs/` contains project documentation (README, API reference, architecture notes). Every `doc-updater` invocation is forced to decline. This affects every eval against these fixtures equally; it does not bias the backend comparison, but it makes `doc-update` non-discriminating.

## Methodological note

The 2026-04-14 harness-backends post concluded that behavioral metrics on excursion-scale scenarios do not reliably replicate at small sample sizes. Today's excursion set (n=2 per backend) reproduces that warning: the sdk-run-1 behavioral miss (3 missed 404 requirements, rescued by gap-closer) is a single observation, and its absence from the other 3 runs means we can say "the miss happened" but not "sdk misses more often than pi at this scale".

Claims that are safe from this data:
- SDK costs more than pi at matched model tier on both scales (n=5 runs total, consistent direction).
- SDK pipeline-composer produces less consistent output than pi's at errand scale (n=3 per side, 2/3 vs 3/3 scope correctness).

Claims that would need re-running:
- "sdk review pipeline misses behavioral specs more often than pi's" — needs n ≥ 3 per backend at excursion scale.
- "the SDK/pi cost ratio depends on model tier" — needs the errand scenario on 4-7 models or excursion on 4-6.

No cross-scale quality claim is published here. The per-scenario analyses are the primary artifact.

## Files

- [`errand-health-check.md`](./errand-health-check.md) — 2-backend comparison on `todo-api-errand-health-check` (4-6 models, n=3 per backend)
- [`excursion-workspace-engagement.md`](./excursion-workspace-engagement.md) — 2-backend comparison on `workspace-api-excursion-engagement` (4-7 models, n=2 per backend)
