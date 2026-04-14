---
name: eval-compare-variants
description: Compare eforge eval runs of the same scenario across two or more variants. Reads eforge.log, result.json, and workspace artifacts to judge decision quality stage-by-stage — pipeline composer, planner, builder, tester, reviewer, review-fixer, evaluator — and writes a ranked analysis to the results directory. Use when the user asks to compare variants, rank backends, analyze which variant made better decisions, or review a specific eval run.
---

# eval-compare-variants

Qualitative, judgment-driven comparison of eforge eval runs across variants. `lib/compare.ts` already produces numeric rankings (`comparison.json`); this skill answers the harder question: **which variant made better decisions?**

## Invocation

- Slash: `/eval-compare-variants` — defaults to latest run, all scenario groups with ≥2 variants.
- Slash with args: `/eval-compare-variants <timestamp> [scenario-id]` — e.g. `/eval-compare-variants 2026-04-14T16-19-24 todo-api-errand-health-check`.
- Natural language: any request to compare variants, rank backends, judge decision quality on an eval run.

If the user names a specific run, use it. Otherwise find the most recent `results/YYYY-MM-DDTHH-MM-SS/` directory.

## Discovery

1. List `results/` entries matching the timestamp pattern, newest first.
2. Within the chosen run, list subdirectories matching `<scenario-id>--<variant-name>`.
3. Group by `<scenario-id>`. Skip groups with fewer than 2 variants.
4. If the user passed a scenario ID, filter to that group.

## Read order — logs are the decision record, metrics are the numbers

Read per variant, in this order:

1. **`eforge.log`** — authoritative for *what each agent decided*. Pipeline-composer JSON output, planner's chosen profile, which build agents actually ran, review issues raised, evaluator verdicts. Cite by line number when possible.
2. **`result.json`** — authoritative for tokens, cost, duration, per-agent aggregates. Also contains `expectations` check results and the `variant.configOverlay` so you know what model/backend was configured. **Also inspect `metrics.models`** — variants often mix models across agents (e.g. opus for planner/builder, sonnet for prd-validator). To find *which* agent used *which* model, query the monitor DB directly: `SELECT agent, data FROM events WHERE type='agent:result' AND run_id IN (...)` and read each row's `result.modelUsage` keys. Worth calling out when a cheaper model is routed to low-stakes stages — that's a deliberate design choice, not an accident.
3. **`comparison.json`** (if present) — numeric rankings across cost/tokens/duration/cache/pass-fail. Cite directly for the quantitative dimensions; don't recompute.
4. **`validate-*.log`** — whether install/type-check/test actually passed in the workspace.
5. **`workspace-path.txt`** → `git log --stat` or `git show` in that workspace — use only when scope creep is suspected (e.g. a doc-updater ran). Look for files touched that the PRD didn't ask for.

### Metrics aggregator caveat — check this early

**Sanity-check before trusting any numbers.** If `result.json`'s `metrics.agents` contains only `formatter` (or is otherwise missing stages the log clearly shows ran), the aggregator bug was present when that run was built. The log will show planner/builder/tester/etc. running, but `result.json` will undercount tokens and cost by ~25× or more.

When detected:
- Flag it prominently in the `Notes` section of the report, including the true numbers vs. what `result.json` says.
- Reaggregate by calling `buildResult` from `lib/build-result.ts` against the current DB, or by querying the monitor DB directly (see read step 2 above for the query).
- Treat `comparison.json` as also contaminated — its rankings inherit the bad per-variant numbers.

The bug was fixed in `lib/build-result.ts:resolveRunIds` — runs built after that fix should have all stages represented.

## Comparison dimensions

Judge each dimension per variant. Declare a winner (or tie) with a one-line reason citing the log:

| Dimension | What to look for |
|---|---|
| Pipeline composer | Scope choice (errand/excursion/expedition), pipeline shape, review strictness. Is it proportional to the PRD? |
| Planner | Did it respect the scenario's `expect.mode`? Did it downgrade/upgrade the composer's pipeline when warranted? Did it decompose sensibly? |
| Builder | Correctness, scope discipline, whether it installed/touched only what the plan required. |
| Tester | Coverage of acceptance criteria, genuine bug catches vs rubber-stamping. |
| Reviewer | Real-bug-to-speculation ratio. Did flagged issues matter, or were they style hypotheticals? |
| Review-fixer | Applied fixes discriminately or yes-manned the reviewer? |
| Evaluator | Did it catch bad fixes? Accept real ones? |
| Doc discipline | See **Doc discipline** section below. Applies to every variant, not just ones that ran a doc-updater. |
| Scope discipline | Non-doc files touched vs. files the PRD asked for. Run `git log --stat` in the workspace if unsure. |
| Final artifact | Did validation pass? Is the artifact equivalent across variants, or is one genuinely better? |

### Doc discipline

For each variant, enumerate every write/edit under `docs/`, `README*`, `CHANGELOG*`, or any other doc-looking path. Query the monitor DB for `agent:tool_use` events across all agents (not just doc-updater) — the builder can touch docs too:

```sql
SELECT agent, data FROM events
WHERE type='agent:tool_use' AND run_id IN (...)
```

Filter tool inputs (`Write`, `Edit`, `file_path`; `Bash` commands with doc paths) for paths under documentation locations.

Classify each touched path:

1. **PRD source** — matches any `scenarios.yaml` `prd:` field, or is under `eforge/queue/`. **Touching a PRD source is an anti-pattern.** PRDs are historical inputs, not living docs. Flag red, even if the variant touched a *different* scenario's PRD (compounds the anti-pattern).
2. **Project doc** — README, API reference, architecture notes, changelogs, or anything under `docs/` that isn't a PRD source. Judge per-file:
   - Code change affects the surface this doc describes → **appropriate update**.
   - Code change orthogonal → **over-reach**.
3. **Missed update** — project docs the fixture already has that arguably *should* have changed given the code change, but didn't. Requires reading the fixture's docs to detect. Apply to every variant (including ones that never ran a doc-updater stage).

Score the variant on: PRD touches (any = red), project-doc touches (appropriateness per path), missed updates.

**Fixture note:** if the fixture has no project documentation (only PRD sources), record this as a fixture observation separately from the variant scoring. A variant that ran a doc-updater stage against a doc-less fixture isn't purely at fault — the pipeline shouldn't have composed `doc-update` for that fixture, or the fixture is under-specified. Call it out so the fixture gap is visible.

Not every dimension applies to every run — skip stages that didn't execute for *any* variant.

## Ranking (N-variant)

For each dimension, rank all variants (ties allowed). For the overall verdict:

- Weight **decision quality** over raw cost. A variant that costs 2× but makes the right scope call is usually the better choice.
- Weight **scope discipline** heavily. Unrelated file edits are a red flag even if the final artifact passes.
- **Equivalent output ≠ equivalent decisions.** Two variants that produce identical `/health` endpoints may still rank very differently if one got there via a bloated pipeline.
- Per-stage self-correction (e.g. evaluator catching a bad fixer) is a positive signal but **rescuing wasted work < avoiding it**.
- A variant that *skips* a stage by good judgment outranks one that runs the stage and then rejects its output.

Produce an ordered ranking with a clear #1, plus callouts for variants that shine on a specific dimension even if not overall #1.

## Output

Two artifacts:

### 1. Chat response

Concise. For each scenario group:
- A per-dimension scorecard table (rows = dimensions, columns = variants, cells = rank or ✓/✗/~).
- 2-4 sentences of overall verdict naming the winner and the decisive dimension(s).
- Key surprises or caveats (metrics bug, unexpected model choice, validation gap).

### 2. Markdown report

Write to `results/<timestamp>/variant-analysis.md` (one file per run, covering all scenario groups in that run). Overwrite if it exists.

Structure:

```markdown
# Variant Analysis — <timestamp>

Generated: <ISO timestamp>
Scenarios analyzed: <N>

## <scenario-id>

**Variants:** <variant-a>, <variant-b>, ...
**Ranking:** 1. <winner>, 2. <runner-up>, ...

### Scorecard

| Dimension | <variant-a> | <variant-b> | ... |
|---|---|---|---|
| Pipeline composer | ... | ... | ... |
| Planner | ... | ... | ... |
| ...

### Stage-by-stage

#### Pipeline composer
<variant-a>: <what it chose and why, with log line cite>
<variant-b>: ...
**Winner:** <name> — <one sentence>

#### Planner
...

### Verdict

<2-4 sentences. Name the winner, the decisive dimension, and any meaningful
caveats. Distinguish decision quality from output quality.>

### Notes

- <metrics bug flag if applicable>
- <unexpected findings>
```

Cite `eforge.log:<line>` inline for specific decisions. Include the `variant.configOverlay` (backend, model) near the top of each section so the reader knows what was actually tested. When a variant uses multiple models, list which agent used which — e.g. "`claude-opus-4-6` for planner/builder/tester, `claude-sonnet-4-6` for prd-validator". Mixed-model routing is a deliberate design choice worth surfacing.

## Guardrails

- **Don't declare a winner on metrics alone.** `comparison.json` already ranks those.
- **Don't invent stages.** If a stage didn't run for a variant, say so — often *that* is the interesting decision.
- **Cite line numbers.** Vague claims like "the planner did X" without a cite make the report unverifiable.
- **When metrics and logs disagree, log wins and flag it.**
- **Don't guess at workspace state.** If you need to know what files changed, actually read `workspace-path.txt` and run `git log --stat` or `git show` in the workspace.
- **Keep it short.** A 4-variant comparison should still fit in a reviewable page or two. Resist the urge to re-summarize the PRD or the eforge pipeline generically.
