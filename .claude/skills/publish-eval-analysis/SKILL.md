---
name: publish-eval-analysis
description: Compile a directory of per-scenario eval analyses into a top-level README.md suitable for publishing. Reads analyses/<dated-dir>/*.md, optionally re-aggregates from results/<timestamp>/ result.json files, and writes a factual, non-sensational summary following analyses/_TEMPLATE/. Use when the user asks to publish, compile, or finalize an eval analysis set, or points at an analyses dir containing per-scenario files but no aggregated README.md.
---

# publish-eval-analysis

Compiles per-scenario analyses into a publishable top-level `README.md` for an eval set. The per-scenario files are the primary artifacts; this skill's job is to synthesize them honestly — preserving disagreements, flagging confounds, and refusing to overclaim on small samples.

## Invocation

- `/publish-eval-analysis` — defaults to the newest `analyses/YYYY-MM-DD-*/` directory that has no `README.md` yet.
- `/publish-eval-analysis <analyses-dir>` — e.g. `/publish-eval-analysis analyses/2026-04-16-opus-4-7-first-look`.
- Natural language: "compile the eval results into a README", "publish the 2026-04-16 analysis", "write the top-level summary for this eval set".

If the user wants *new* per-scenario analyses generated first, that is the `eval-compare-backends` skill's job — invoke it per scenario, then return here to compile.

## Templates

- `analyses/_TEMPLATE/README.md.tmpl` — top-level compilation.
- `analyses/_TEMPLATE/per-scenario.md.tmpl` — per-scenario scorecard (for reference; `eval-compare-backends` is the primary path to create these).

Templates encode required sections and voice rules as HTML comments. Read them before writing.

## Discovery

1. Resolve target directory:
   - If the user named one, use it.
   - Otherwise list `analyses/` (newest first) and pick the most recent dir whose contents include `*.md` files but no `README.md`.
2. Enumerate per-scenario files in the directory. Typical names: `errand-*.md`, `excursion-*.md`, `expedition-*.md`, `run-<n>-<scale>-*.md`. Read every one.
3. For each per-scenario file, identify the source run(s) it analyzed. Look for:
   - The H1 timestamp (e.g., `# Variant Analysis — 2026-04-16T17-10-03`).
   - A "Source run" or "Configs under test" section naming `results/<timestamp>/` directories.
4. Optionally cross-check numbers against `results/<timestamp>/<scenario>--<variant>/result.json` — particularly cost, tokens, duration, cache hit rate. If `result.json.metrics.agents` looks contaminated (formatter-only signature, see `eval-compare-backends` SKILL.md), flag it in the Notes and use the true numbers from the per-scenario file (which should already have reaggregated).

## Synthesis

Before writing, build a synthesis table in your head (or out loud to the user if the set is large):

| Finding | Evidence | Sample | Classification |
|---|---|---|---|
| "SDK costs more than Pi on every scenario" | 3 per-scenario files, N=7+1+1 runs | multi-scale | **replicated** |
| "4.7 has sharper reviewer judgment" | 1 light-excursion file | n=1 | **did not replicate** — heavy-excursion disagrees |
| "SDK composer over-scopes via haiku routing" | 2 per-scenario files, 2 scales | multi-scale | **replicated** |

A finding belongs in **What replicated** only if it holds across ≥2 independent observations (runs OR scales OR prior eval). Everything else goes in **What did not replicate** or is quietly omitted.

## Voice rules (enforced)

These are the non-negotiable tone constraints. Apply them while drafting and re-check before closing the file.

1. **No sensationalism.** Banned words unless evidence is unambiguous: "proves", "dramatic", "remarkable", "impressive", "game-changing", "clear winner". Prefer: "on this scenario", "in these runs", "directional", "n=1".
2. **Every cross-variant claim cites a row or a file.** Link the per-scenario file, or point at a raw-data table row.
3. **Single-run claims are labeled.** n=1 findings go under "What did not replicate" or "Confounds" — not "What replicated" — unless a prior eval already replicated them (link it).
4. **Confounds are surfaced, not buried.** If any variant ran on a different eforge version, config, or fixture state, the Confounds section names it and states which claims it complicates.
5. **Disagreements are preserved.** If two scales disagree on decision quality, the README says so and refuses to pick a winner. Do not average disagreeing qualitative findings.
6. **No quality claim in the headline.** The opening paragraph describes what was run. Findings live below in structured sections.
7. **Sample sizes stated.** Every metric table lists n. Every behavioral finding names its sample.

## Writing order

Write sections in this order, because later sections depend on decisions made in earlier ones:

1. **Variants + Scales tables** — factual, just copy from per-scenario files.
2. **Raw data tables** — numbers only, no interpretation. Pull from per-scenario files and spot-check against `result.json`. Add `\*` / `†` / `‡` footnotes for any unreliable cells (e.g., cost tracking broken mid-set).
3. **Cross-variant ratios** — compute from the raw-data tables. State the range alongside the mean; variance matters.
4. **What replicated** — draft from the synthesis table. Each entry: headline + evidence paragraph + file links. If you have fewer than 2–3 entries, that is fine; do not pad.
5. **What did not replicate** — draft the disagreement table/list. Write the interpretive paragraph last — "both positions find n=1 support" style.
6. **Confounds** — enumerate every version/config/fixture delta. Always include Sample sizes.
7. **Methodological note** — state what the design *cannot* support. Name the re-run that would produce a clean claim.
8. **Opening paragraph** — write this LAST. By now you know what the eval actually showed; the opener should describe the setup without pre-loading conclusions.
9. **Files index** — mechanical.

## Self-review checklist

Before declaring the README complete, read it top to bottom and check:

- [ ] No banned superlative slipped in while drafting.
- [ ] Every "What replicated" item has ≥2 independent observations cited.
- [ ] Every n=1 qualitative finding is labeled n=1 and lives under "What did not replicate" or "Confounds".
- [ ] Confounds section names every version/config delta present in the raw data.
- [ ] Sample sizes appear in both the raw-data tables and the "Confounds → Sample sizes" entry.
- [ ] Methodological note exists if sample sizes differ across metric types (cost n=7, quality n=1, etc.).
- [ ] Opening paragraph does not preview conclusions.
- [ ] Every per-scenario file has an entry in the Files index.
- [ ] Every link resolves (relative paths to sibling `.md` files and to prior `analyses/` dirs).

## When to push back on the user

- If the user asks you to lead with a quality claim ("say 4.7 is better"), point at the disagreement and propose the neutral framing instead.
- If the user asks you to drop the Confounds section to "keep it clean", refuse — this is the section that protects the reader from overreading the data.
- If the user asks for the README when only one per-scenario file exists and the findings are all n=1, recommend running more scenarios first. The template supports a minimal README but the voice rules mean it will read as a single data point, not a conclusion set.

## Reference examples

- `analyses/2026-04-16-opus-4-7-first-look/README.md` — canonical model for the template. Three scales, three variants, explicit "What replicated" / "What did not replicate" split, eforge-version confound disclosed, no quality claim published.
- `analyses/2026-04-14-harness-backends/` — per-scenario files with no top-level README; illustrates what this skill is for.
