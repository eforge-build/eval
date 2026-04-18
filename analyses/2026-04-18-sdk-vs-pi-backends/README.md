# Claude Agent SDK vs. Pi Backend — Multi-Scale Comparison (2026-04-18)

Two backend profiles — `claude-sdk` and `pi` (Anthropic direct) — compared on two scenarios with matched model tiers within each comparison. The errand scenario was run at **both** Opus 4.6 and Opus 4.7 to separate backend behavior from model tier. The excursion scenario was run only at Opus 4.7. Within every comparison, both backends use the same `max` and `balanced` models, so between-backend differences isolate backend behavior (pipeline-composer routing, SDK-internal delegation) rather than model capability.

Follows on from [2026-04-14 harness-backends](../2026-04-14-harness-backends/) and [2026-04-16 opus-4-7 first look](../2026-04-16-opus-4-7-first-look/), which established the SDK-over-Pi cost premium and the SDK-composer-over-scopes-via-haiku pattern on separate scenarios.

## Variants

| Variant | Backend | `max` model | `balanced` model | Scales run |
|---|---|---|---|---|
| `claude-sdk-4-6` | Claude Agent SDK | `claude-opus-4-6` | `claude-sonnet-4-6` | errand |
| `pi-anthropic-4-6` | pi (Anthropic direct) | `claude-opus-4-6` | `claude-sonnet-4-6` | errand |
| `claude-sdk-4-7` | Claude Agent SDK | `claude-opus-4-7` | `claude-sonnet-4-6` | errand, excursion |
| `pi-anthropic-4-7` | pi (Anthropic direct) | `claude-opus-4-7` | `claude-sonnet-4-6` | errand, excursion |

`balanced` is invoked only by `prd-validator`. The `claude-sdk` backend additionally routes `pipeline-composer` to `claude-haiku-4-5` — this is an SDK-internal delegation not configured in eforge, and matches the routing observed in prior evals. `pi` routes pipeline-composer to the configured `max` model.

## Scales and scenarios

| Scale | Model tier | Scenario | Runs per backend | Analysis file |
|---|---|---|---|---|
| Errand | Opus 4.7 | `todo-api-errand-health-check` — add `GET /health` endpoint | 3 | [`errand-health-check-4-7.md`](./errand-health-check-4-7.md) |
| Errand | Opus 4.6 | `todo-api-errand-health-check` — add `GET /health` endpoint | 3 | [`errand-health-check-4-6.md`](./errand-health-check-4-6.md) |
| Excursion | Opus 4.7 | `workspace-api-excursion-engagement` — reactions, threads, pins across 4 parallel plans | 2 | [`excursion-workspace-engagement.md`](./excursion-workspace-engagement.md) |

Errand is run at both model tiers; excursion is run at 4-7 only. This means the backend comparison is clean within every row (both sides use the same model), and the errand rows additionally support a within-scale **model-tier** comparison across the 4-6 vs. 4-7 sub-sets.

## Raw data

### Errand, Opus 4.7 — `todo-api-errand-health-check` (n=3 per backend)

Source: `results/2026-04-18T04-22-33/`.

| Backend | Total tokens | Total cost | Mean cost / run | Mean duration / run | Mean cache hit |
|---|---|---|---|---|---|
| `claude-sdk-4-7` | 4.35M | $5.73 | $1.91 | 220s | ~85% |
| `pi-anthropic-4-7` | 1.73M | $3.09 | **$1.03** | 216s | ~82% |

**Cross-backend ratios:** SDK / pi mean cost **1.86×**; mean tokens **2.52×**; duration comparable.

**Expectations pass rate** (per-run `result.json`, not `comparison.json` — see Confounds):
- `claude-sdk-4-7`: **0/3** (every run picks mode=excursion)
- `pi-anthropic-4-7`: **3/3**

### Errand, Opus 4.6 — `todo-api-errand-health-check` (n=3 per backend)

Source: `results/2026-04-18T04-38-11/`.

| Backend | Total tokens | Total cost | Mean cost / run | Mean duration / run | Mean cache hit |
|---|---|---|---|---|---|
| `claude-sdk-4-6` | 3.46M | $4.74 | $1.58 | 326s | ~83% |
| `pi-anthropic-4-6` | 843K | $1.72 | **$0.57** | **170s** | ~79% |

**Cross-backend ratios:** SDK / pi mean cost **2.75×**; mean tokens **4.10×**; duration **1.92×**.

**Expectations pass rate:**
- `claude-sdk-4-6`: **1/3** (mode=excursion on runs 1 and 3)
- `pi-anthropic-4-6`: **0/3** (every run includes `test-cycle`, which `buildStagesExclude` forbids)

### Excursion, Opus 4.7 — `workspace-api-excursion-engagement` (n=2 per backend)

Source: `results/2026-04-18T05-00-35/`.

Per-run:

| Backend | Run | Cost | Duration |
|---|---|---|---|
| `claude-sdk-4-7` | 1 | $16.91 | 1569s |
| `claude-sdk-4-7` | 2 | $9.99 | 1776s |
| `pi-anthropic-4-7` | 1 | $11.89 | 2139s |
| `pi-anthropic-4-7` | 2 | $6.45 | 1298s |

Aggregate per backend:

| Backend | Total tokens | Total cost | Mean cost / run | Mean cache hit |
|---|---|---|---|---|
| `claude-sdk-4-7` | 19.89M | $26.91 | $13.45 | ~88% |
| `pi-anthropic-4-7` | 10.34M | $18.35 | **$9.17** | ~87% |

**Cross-backend ratios:** SDK / pi mean cost **1.47×**; mean tokens **1.92×**.

**Mode expectation:** both backends pass 2/2 (all 4 runs picked `excursion`).

**Behavioral differentiator:** `claude-sdk-4-7` run-1 shipped with 3 missed PRD requirements (404 existence checks on thread/reply routes); the `gap-closer` stage rescued the run to 100% PRD pass. The other 3 runs hit 100% directly.

### SDK-over-Pi cost ratio across the set

| Comparison | Ratio |
|---|---|
| Errand, Opus 4.6 | 2.75× |
| Errand, Opus 4.7 | 1.86× |
| Excursion, Opus 4.7 | 1.47× |

The ratio narrows both as model moves 4-6 → 4-7 (within errand) and as scale moves errand → excursion (at 4-7). Total token ratios follow the same direction (4.10× → 2.52× → 1.92×).

## What replicated

**1. `pi` costs less than `claude-sdk` in every comparison.** Three separate matched-model comparisons, same direction every time: 2.75× at errand-4-6, 1.86× at errand-4-7, 1.47× at excursion-4-7. Also consistent with [2026-04-14 harness-backends](../2026-04-14-harness-backends/) and [2026-04-16 opus-4-7 first look](../2026-04-16-opus-4-7-first-look/). Cache hit rates are within ~5 points across backends in every row, so the gap isn't attributable to caching.

**2. `pi-anthropic` makes better scope decisions at errand scale, at both model tiers.**
- Errand-4-7: pi gets `errand` scope 3/3; sdk gets it 0/3 (all `excursion`). See [`errand-health-check-4-7.md`](./errand-health-check-4-7.md#pipeline-composer).
- Errand-4-6: pi gets `errand` scope 3/3; sdk gets it 1/3. See [`errand-health-check-4-6.md`](./errand-health-check-4-6.md#pipeline-composer).

That's 6/6 correct scope calls for pi at errand vs. 1/6 for sdk, across two model tiers. The pattern holds regardless of model.

**3. SDK pipeline-composer instability via haiku delegation — third eval in a row.** The `claude-sdk` backend routes `pipeline-composer` to `claude-haiku-4-5` on both scales. At errand: same PRD, same model, inconsistent output across runs (errand-4-6 split 1/3 errand, 2/3 excursion; errand-4-7 all 3 excursion). At excursion: mode was stable but stage-list varied (doc-update included on run-1, dropped on run-2). Replicates the pattern documented in 2026-04-14 and 2026-04-16.

**4. `pi` wins on decision quality at excursion scale too.** At matched model (4-7): pi hit PRD 100% directly on both runs; sdk-run-1 missed 3 required 404 checks despite a deeper review pipeline (16 reviewer issues raised, plan-evaluator ran) and needed `gap-closer` to rescue. See [`excursion-workspace-engagement.md`](./excursion-workspace-engagement.md#builder). n=2 per side, so this is a single incident, not a rate.

**5. Doc-updater on doc-less fixtures remains wasted compute.** Both fixtures (`todo-api`, `workspace-api`) contain only PRD sources under `docs/`. Every doc-updater invocation across both scenarios produced `count=0`. Same fixture-level gap flagged in the 2026-04-16 set.

## What did not replicate

**`pi`'s `buildStagesExclude` failure at errand scale is specific to the 4-6 tier.** At errand-4-6, `pi-anthropic-4-6` picked `test-cycle` instead of `test-write` on all 3 runs, violating `expect.buildStagesExclude: [test-cycle]` and producing a 0/3 expectations pass rate despite getting mode right. At errand-4-7, `pi-anthropic-4-7`'s composer used `test-write` and passed expectations 3/3. Same backend, same PRD, same scenario — the stage choice changed with the model tier.

This means the earlier "neither backend passes errand expectations consistently" conclusion is tier-specific: at Opus 4.7, `pi-anthropic-4-7` passes 3/3. The 4-6 run is the outlier on that dimension.

**SDK composer consistency did not improve with the stronger model.** Going from 4-6 → 4-7 at errand scale, the SDK composer went from 1/3 to 0/3 correct scope calls. Because the SDK routes the composer to haiku regardless of the configured `max` model, the `max` upgrade does not reach the composer — and on these runs, the haiku composer got directionally worse. n=3 per tier, so this is directional, not a confident rate difference.

## Confounds

**Excursion scale is 4-7 only.** The excursion comparison is single-tier, so the SDK-over-pi excursion ratio (1.47×) is confounded with model — we cannot tell whether the narrower cross-scale ratio reflects scale, model, or both. The errand rows support a clean within-scale model-tier comparison; the excursion row does not. A clean test would re-run excursion at 4-6.

**Aggregator bug in `comparison.json`.** All three runs' `comparison.json` files report `expectationsPassed: true` for every backend, but per-run `result.json` files show failures on 5/6 errand-4-6 runs and 3/3 errand-4-7 SDK runs. Automated pass/fail monitoring on `comparison.json` under-reports failures at the errand scale. The per-run `result.json.expectations` field is the source of truth. The excursion-scale rollup happens to be correct because all 4 excursion runs pass mode — it is not correct by design, only by coincidence.

**Sample sizes.** n=3 at each errand comparison, n=2 at the excursion comparison. Intra-backend run-to-run variance on cost at excursion scale is 1.7–1.8× (larger than the 1.47× between-backend mean), so the excursion ratio is directional. The n=3 errand rows are more stable: within-backend per-run cost variance is smaller than the between-backend gap.

**Fixture doc gap.** Neither `fixtures/todo-api/docs/` nor `fixtures/workspace-api/docs/` contains project documentation. Every `doc-updater` invocation is forced to decline. Affects every eval against these fixtures equally; does not bias the backend comparison, but makes `doc-update` non-discriminating.

**Aggregator bug rerun window.** The fix landed after these runs started — confirm the fix is applied before drawing pass/fail conclusions from future `comparison.json` rollups.

## Methodological note

The errand comparison is relatively well-replicated: three runs per backend per model tier, two model tiers, same scenario, same fixture, same validation. The six-comparison scope call (6/6 pi correct, 1/6 sdk correct) is the strongest single claim in this eval. Cost ratios replicate in direction at every granularity (three comparisons, three same-direction results). 

The excursion comparison remains n=2. The sdk-run-1 gap-closer rescue is a single observation — the statement "the SDK review pipeline failed to catch three 404-requirement gaps on this run" is a per-run fact. The broader claim "sdk reviewer misses behavioral specs more often than pi's" would require n ≥ 3 per backend at excursion scale before it belongs in a replicated-finding list.

No cross-scale quality claim is published here. The per-scenario analyses are the primary artifact.

## Files

- [`errand-health-check-4-7.md`](./errand-health-check-4-7.md) — 2-backend comparison at errand scale, Opus 4.7 (n=3 per backend)
- [`errand-health-check-4-6.md`](./errand-health-check-4-6.md) — 2-backend comparison at errand scale, Opus 4.6 (n=3 per backend)
- [`excursion-workspace-engagement.md`](./excursion-workspace-engagement.md) — 2-backend comparison at excursion scale, Opus 4.7 (n=2 per backend)
