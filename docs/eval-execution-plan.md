# Eval execution plan — finding the ideal claude-sdk profile

## Goal

Produce evidence the future eforge dynamic picker can consume: per-archetype, per-knob recommendations of (runtime, model, effort) with cost-per-quality data so the picker can choose under a budget. The immediate output is a `preferences.yaml` per archetype identifying the best claude-sdk-centric profile by cost-per-quality (default), cost, or quality.

## Profile inventory

Claude-sdk-centric profiles available after Phase 3:

| Profile | Variable isolated | One-leaf diff vs baseline? |
|---|---|---|
| `claude-sdk-opus` | (baseline) | — |
| `claude-sdk-opus-no-subagents` | Subagent contribution (`Task` tool removed) | ✅ |
| `claude-sdk-opus-xhigh-planning-only` | Planning effort (high → xhigh) | ✅ |
| `claude-sdk-opus-xhigh-eval-only` | Evaluation effort (high → xhigh) | ✅ |
| `claude-sdk-opus-impl-opus-medium` | Build-tier model class (balanced/Sonnet → max/Opus) | ✅ |
| `claude-sdk-opus-xhigh-review` | Review + evaluation effort combined | ❌ (2 leaves) |
| `claude-sdk-opus-xhigh-plan-review` | Planning + review effort combined | ❌ (2 leaves) |
| `mixed-opus-kimi-tester` | Tester role offloaded to Pi+Kimi K2.6 | ❌ (multi-leaf) |
| `mixed-opus-kimi-evaluator` | Evaluator role offloaded to Pi+Kimi K2.6 | ❌ (multi-leaf) |

The five "one-leaf" profiles attribute cleanly via `comparison.json.groups[].marginalDeltas` when paired with baseline. The multi-leaf profiles still appear in archetype rollups but won't trigger per-knob attribution.

## Scenarios

Run on 5 of the 9 scenarios for sufficient coverage at lower cost:

| Scenario | Archetype | Task type |
|---|---|---|
| `todo-api-errand-health-check` | errand | Simple feature add |
| `todo-api-excursion-jwt-auth` | excursion | Greenfield feature |
| `notes-api-excursion-refactor-store` | excursion | Refactor |
| `notes-api-excursion-search` | excursion | Feature with `test-cycle` stage (exercises tester) |
| `workspace-api-expedition-extensions` | expedition | Parallel modules |

Dropped:
- `todo-api-errand-skip` — atypical (skip-detection regression test, no quality scoring data)
- `notes-api-errand-update-docs` — doc-only, doesn't exercise builder/tester
- `notes-api-excursion-dead-code` — similar work pattern to refactor (redundant)
- `workspace-api-excursion-engagement` — expedition already covers parallel-modules

## Tier 1 — single-knob orthogonal probes

5 profiles × 5 scenarios = **25 runs**. Estimated total spend: **~$25–35** (rough; based on $1.24 baseline excursion).

Profiles:
- `claude-sdk-opus` (baseline)
- `claude-sdk-opus-no-subagents`
- `claude-sdk-opus-xhigh-planning-only`
- `claude-sdk-opus-xhigh-eval-only`
- `claude-sdk-opus-impl-opus-medium`

After Tier 1, `comparison.json.groups[].marginalDeltas` will have 4 clean attribution pairs per scenario (each variant vs baseline). `archetypes` rollups give per-archetype winners. `preferences.yaml` (via `lib/emit-preferences.ts`) picks the best profile per archetype.

Stop here if signal is clear.

## Tier 2 — combination + offload (optional)

If Tier 1 leaves open questions, add 4 more profiles on the same 5 scenarios. Reuses Tier 1 baseline; only the 4 new profiles cost spend (4 × 5 = 20 runs, **~$10–15**).

Profiles:
- `claude-sdk-opus-xhigh-review` — does combining review+eval xhigh beat doing each alone?
- `claude-sdk-opus-xhigh-plan-review` — does combining planning+review xhigh beat doing each alone?
- `mixed-opus-kimi-tester` — does cheap tester offload preserve quality? (Most useful on `notes-api-excursion-search`.)
- `mixed-opus-kimi-evaluator` — does cheap evaluator offload preserve quality?

These don't get marginal-delta attribution (multi-leaf diffs) but appear in archetype rollups and the cost frontier.

## Batching strategy

Session limits make a single 25-run invocation risky. Two options.

### Option A — batch by scenario (recommended for parallelism)

Each invocation runs all 5 profiles on one scenario. 5 profiles run in parallel within a scenario, then the invocation exits. Each batch = ~10–15 min wall time, 5 concurrent claude-sdk processes during that window.

```bash
PROFILES=claude-sdk-opus,claude-sdk-opus-no-subagents,claude-sdk-opus-xhigh-planning-only,claude-sdk-opus-xhigh-eval-only,claude-sdk-opus-impl-opus-medium

# Batch 1
./run.sh --profile $PROFILES todo-api-errand-health-check
# Batch 2
./run.sh --profile $PROFILES todo-api-excursion-jwt-auth
# Batch 3
./run.sh --profile $PROFILES notes-api-excursion-refactor-store
# Batch 4
./run.sh --profile $PROFILES notes-api-excursion-search
# Batch 5
./run.sh --profile $PROFILES workspace-api-expedition-extensions
```

5 batches, results land in 5 separate `results/<timestamp>/` dirs. Combine afterward (see below).

### Option B — batch by profile (recommended if 5 concurrent processes blow your session)

Each invocation runs one profile across all 5 scenarios sequentially — 1 claude-sdk process at a time, slow but steady token consumption. Each batch = ~30–60 min wall time.

```bash
SCENARIOS="todo-api-errand-health-check todo-api-excursion-jwt-auth notes-api-excursion-refactor-store notes-api-excursion-search workspace-api-expedition-extensions"

# Batch 1
./run.sh --profile claude-sdk-opus $SCENARIOS
# Batch 2
./run.sh --profile claude-sdk-opus-no-subagents $SCENARIOS
# Batch 3
./run.sh --profile claude-sdk-opus-xhigh-planning-only $SCENARIOS
# Batch 4
./run.sh --profile claude-sdk-opus-xhigh-eval-only $SCENARIOS
# Batch 5
./run.sh --profile claude-sdk-opus-impl-opus-medium $SCENARIOS
```

5 batches, lower concurrency, longer per-batch wall time.

### Picking between A and B

- **A** if your bottleneck is wall-clock time and 5 parallel claude-sdks fit your session.
- **B** if your bottleneck is concurrent session usage (the typical claude-sdk subscription concern).

## Combining results across batches

Each batch creates its own `results/<timestamp>/` dir. To run `compare.ts` and `emit-preferences.ts` across all batches, merge the per-scenario subdirs into a single dir:

```bash
COMBINED=results/tier1-combined-$(date +%Y%m%d-%H%M%S)
mkdir -p $COMBINED

# Copy each scenario subdir from its batch dir into the combined dir
for ts in 2026-04-XX-XX-XX-XX 2026-04-XX-XX-XX-XX ...; do
  cp -r results/$ts/*/ $COMBINED/ 2>/dev/null
done

# Now run compare + emit-preferences on the combined dir
npx tsx lib/compare.ts $COMBINED --skip-quality   # use --skip-quality if quality scores already exist on each result.json
npx tsx lib/emit-preferences.ts $COMBINED
```

Note: per-scenario `result.json` already carries `quality.absolute` from each batch's run, so `--skip-quality` re-renders the comparison without re-judging. Pairwise quality scoring will run if you don't pass `--skip-quality`.

## Verification after each batch

After every batch, check `results/<timestamp>/`:

- `summary.json` — confirms pass count
- `<scenario>--<profile>/result.json` — should have `metrics.costUsd`, `quality.absolute.overall.weighted` (if scored), `expectations.passed`
- Skim `eforge.log` if anything failed

After all batches combined and `compare.ts` re-run, verify `comparison.json` has:
- 5 profile entries per scenario group
- `archetypes` top-level array with errand / excursion / expedition rollups
- `marginalDeltas` arrays per group (4 entries per group: each variant vs baseline)

Then `emit-preferences.ts` produces `preferences.yaml` with archetype recommendations and cost frontier.

## Costs and stopping points

Rough estimates (will vary; calibrate after first batch):
- Errand scenario: ~$0.30 × 5 profiles = ~$1.50
- Excursion scenario: ~$1.00 × 5 profiles = ~$5
- Expedition scenario: ~$3.00 × 5 profiles = ~$15

Tier 1 total ≈ $1.50 + 3 × $5 + $15 = ~$31.50 plus judge calls (~$3–5).

After Tier 1, decide whether Tier 2's combination/offload data is worth ~$15 more.

## Out of scope

- Pi-only profiles (`pi-opus`, `pi-gpt`, `pi-kimi-k-2-6`) — `pi-opus` runs Opus through a non-subscription path so it's economically backward; the cross-family `pi-gpt` / `pi-kimi-k-2-6` lanes are useful comparisons but not the focus of "ideal claude-sdk profile" question.
- The 4 dropped scenarios — add later if a Tier 1/2 result needs more samples per archetype.
- eforge picker integration — `preferences.yaml` is consumable but eforge doesn't read it yet.
