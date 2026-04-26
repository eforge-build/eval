---
id: plan-01-quality-scoring
name: LLM-as-judge quality scoring (absolute + pairwise)
branch: add-llm-as-judge-quality-scoring-to-the-eval-harness/quality-scoring
---

# LLM-as-judge quality scoring (absolute + pairwise)

## Architecture Context

The eval harness in `/Users/markschaake/projects/eforge-build/eval` currently grades runs on correctness (validation pass/fail, expectation match) and cost (tokens, dollars, duration). It has no signal for *quality* — whether a passing diff is shallow, whether tests are weak, whether the PRD was interpreted in spirit. This plan adds an LLM-as-judge layer:

- **Absolute scoring** runs inline per scenario, immediately after expectations check and before workspace cleanup at `lib/runner.ts:591`. It captures a 4-dimension rubric (PRD adherence, code quality, test quality, change discipline) into `result.json.quality.absolute`.
- **Pairwise scoring** runs during `lib/compare.ts` for each scenario group with ≥2 profiles. It uses snapshot artifacts (PRD + diff) saved by the runner at `<scenarioDir>/quality/`, so it does not need live workspaces and is replayable.

Auth: judge calls go through `@anthropic-ai/claude-agent-sdk`'s one-shot `query()` with tools disabled — this inherits Claude Code's host auth (subscription if logged in, falls back to `ANTHROPIC_API_KEY`).

Gated behind `--score-quality` on `run.sh` (off by default). `lib/compare.ts` auto-detects when `quality.absolute` is present in inputs and adds the dimension to the printed table.

## Implementation

### Overview

Add a self-contained judge module (`lib/score-quality.ts`) plus rubric prompts, wire absolute scoring into `runScenario()` after `checkExpectations()` and before `cleanupWorkspace()`, snapshot `prd.md` + `diff.patch` into `<scenarioDir>/quality/`, extend `result.json` shape with an optional `quality` block, and add a 9th `quality` dimension to `lib/compare.ts` that runs pairwise judging across profile pairs.

### Key Decisions

1. **Single plan, one builder pass.** New types (`AbsoluteScore`, `PairwiseScore`, `QualityBlock`) are produced by `score-quality.ts` and consumed by `build-result.ts`, `runner.ts`, and `compare.ts`. Splitting risks type-consumer drift; all changes ship atomically.
2. **YAML parser is `yaml`, not `js-yaml`.** The PRD says "js-yaml is already present" — this is wrong. The codebase uses the `yaml` package (see `lib/runner.ts:21` `import { parse as parseYaml } from 'yaml'`). `score-quality.ts` must mirror this.
3. **Snapshot before cleanup.** `<scenarioDir>/quality/{prd.md,diff.patch}` is written BEFORE the existing `cleanupWorkspace(workspace)` call at `runner.ts:591`. Snapshots live in `runDir`, not `tmpdir()`, so they survive cleanup and are durable for re-scoring during `compare.ts` (acceptance criterion #7).
4. **Diff baseline is the post-`git init` initial commit.** `runner.ts:485` runs `git init && git add -A && git commit -m "Initial commit (eval fixture)"` before `git checkout -b eval/<id>`. So `git diff HEAD~$(git rev-list --count HEAD~1..HEAD).. HEAD` would over-extract. Use `git rev-list --max-parents=0 HEAD` to find the root commit (the initial fixture commit) and diff against it: `git diff <root>..HEAD`. This is robust regardless of how many commits eforge produced.
5. **Tools disabled in judge.** Pass `allowedTools: []` to `query()` so the judge cannot read files, run shell commands, or use MCP. The judge sees only the prompt + diff text we explicitly include. This eliminates the risk of the judge spending unbounded tokens exploring or hallucinating from the workspace.
6. **Pairwise order-effect mitigation: randomize "A".** For each `(profileA, profileB)` pair, randomly assign which one is presented as A in the prompt. Record the actual mapping in the output so winners can be denormalized correctly.
7. **Diff truncation with marker.** If diff size exceeds `judge.yaml`'s `maxDiffBytes`, truncate at the byte boundary and append `\n\n... [TRUNCATED — diff exceeded N bytes] ...\n` so the judge knows. Set `inputs.diffTruncated: true` in the absolute output.
8. **Auto-detect quality in compare.** `lib/compare.ts` includes the new dimension when ANY result.json in the run dir has a populated `quality.absolute` (does not require a flag). This keeps re-running compare on existing runs (criterion #7) ergonomic.
9. **Plumb `--score-quality` to compare via env or arg.** Currently `runner.ts` shells out: `execSync('npx tsx lib/compare.ts <runDir>')`. Pass the flag through (e.g., append `--score-quality` to the argv) when set, so pairwise runs without auto-detect race.
10. **Cost log.** After the absolute call, sum `usage.input_tokens + usage.output_tokens` from the SDK response and log: `quality scoring: 1 call, 5,432 input + 612 output tokens`. After pairwise loop in compare, log a similar single-line summary.

## Scope

### In Scope

- New `lib/score-quality.ts` judge module with `scoreAbsolute()`, `scorePairwise()`, `loadJudgeConfig()`, internal prompt builders, zod-validated response parsing.
- New `judge.yaml` at eval root with `model`, `maxOutputTokens`, per-dimension `weights`, `maxDiffBytes`.
- New rubric prompts: `prompts/judge-absolute.md`, `prompts/judge-pairwise.md` with anchored 1–5 scales and strict JSON output spec.
- New types in `lib/types.ts`: `AbsoluteScore`, `PairwiseScore`, `QualityBlock`, optional `quality` field on `ScenarioResult`.
- `lib/runner.ts` changes:
  - Add `--score-quality` to argv parsing (mirrors `--dry-run`).
  - Add `scoreQuality: boolean` to `ScenarioRunOpts` and plumb through `runScenarioWithRepeats` to `runScenario`.
  - In `runScenario()`, after `checkExpectations()` (around current line 580) and before `cleanupWorkspace()` at line 591:
    - When `opts.scoreQuality === true` and eforge ran (not dry-run, exit 0):
      - `mkdirSync(join(scenarioDir, 'quality'), { recursive: true })`
      - Resolve baseline commit: `git rev-list --max-parents=0 HEAD` in workspace.
      - Capture diff: `git diff <baseline>..HEAD` → `<scenarioDir>/quality/diff.patch`.
      - Copy PRD: `cp <workspace>/<scenario.prd> <scenarioDir>/quality/prd.md`.
      - Call `scoreAbsolute({ prd, diffPatch, validation, judgeConfig })`.
      - Merge result into `result.json` under `quality.absolute` via a small helper (read JSON, set key, write JSON).
      - Log the cost summary line.
  - Pass `--score-quality` to the `compare.ts` invocation when set (around current line 1173).
  - Update `printHelp()` to document `--score-quality`.
- `lib/build-result.ts` changes: extend `ScenarioResult` shape (via `lib/types.ts`) with optional `quality?: QualityBlock`. No write-side changes here — `score-quality.ts` writes via a merge helper. Add an exported `mergeQualityIntoResult(file: string, quality: Partial<QualityBlock>): void` helper here OR colocate with `score-quality.ts` — choose colocate to keep `build-result.ts` focused on monitor-DB extraction.
- `lib/compare.ts` changes:
  - Add `--score-quality` argv parsing.
  - Add `QualityComparison` type (`absolute` + `pairwise` sub-blocks per the PRD's data shape).
  - In `groupByScenario()`, also collect `<scenarioDir>/quality/{prd.md,diff.patch}` paths per profile entry.
  - Auto-detect: if any `ProfileEntry.result.quality?.absolute` is present, include quality in `ComparisonDimensions`.
  - For each group with ≥2 profiles, when scoring is enabled or auto-detected:
    - Build `absolute` block: rank per-dimension scores, compute weighted overall, identify best/worst.
    - For each `(profileA, profileB)` pair, randomize A/B assignment, call `scorePairwise()`, denormalize winner labels, store in `pairwise.pairs`.
    - Aggregate `pairwise.summary.perDimension` (win counts + ties).
  - Add quality to `printComparisonTable()` output (4 dimensions + overall ranking + pairwise win matrix).
  - Log a single-line pairwise cost summary.
- `package.json`: add `"@anthropic-ai/claude-agent-sdk": "^0.2.119"` (matched to `eforge/packages/engine/package.json`).
- `run.sh`: pass-through is automatic since it `exec`s `lib/runner.ts "$@"` — only update is to mention `--score-quality` if any usage line is added (currently `run.sh` just shells through, so no edit needed unless we want a help line; keep `run.sh` unchanged to keep the diff minimal).
- `CLAUDE.md`: add a short "Quality Scoring" section under Architecture documenting the layer, `judge.yaml` knobs, `--score-quality` flag, and the auth requirement (Claude Code logged in OR `ANTHROPIC_API_KEY` set; clear error if neither).

### Out of Scope

- Two-pass order-swapped pairwise averaging (phase 2).
- Multi-judge ensembles.
- Static-analysis quality signals (lint, complexity).
- Storing full source snapshots — diff + PRD are sufficient.
- A separate `judges/` config directory — single `judge.yaml` is sufficient.
- Modifying `run.sh` (it's a thin pass-through; runner handles all argv).
- Modifying `analyze.ts` (orthogonal — quality is a comparison concern, not a per-run trend).

## Files

### Create

- `lib/score-quality.ts` — judge module. Public API:
  ```ts
  export interface JudgeConfig {
    model: string;
    maxOutputTokens: number;
    weights: { prdAdherence: number; codeQuality: number; testQuality: number; changeDiscipline: number };
    maxDiffBytes: number;
  }
  export interface AbsoluteScore { /* per data shape in PRD */ }
  export interface PairwiseScore { /* per data shape in PRD */ }
  export function loadJudgeConfig(path?: string): JudgeConfig;
  export async function scoreAbsolute(opts: { prd: string; diffPatch: string; validation: Record<string,{passed:boolean}>; judgeConfig: JudgeConfig }): Promise<AbsoluteScore>;
  export async function scorePairwise(opts: { prd: string; diffA: string; diffB: string; profileA: string; profileB: string; judgeConfig: JudgeConfig }): Promise<PairwiseScore>;
  export function mergeQualityIntoResult(resultJsonPath: string, patch: { absolute?: AbsoluteScore }): void;
  export function truncateDiff(diff: string, maxBytes: number): { text: string; truncated: boolean; originalBytes: number };
  ```
  Internals: prompt builders read `prompts/judge-absolute.md` / `prompts/judge-pairwise.md` from disk and substitute `{{PRD}}`, `{{DIFF}}`, `{{DIFF_A}}`, `{{DIFF_B}}`, `{{PROFILE_A}}`, `{{PROFILE_B}}`, `{{VALIDATION_SUMMARY}}` placeholders. Use `@anthropic-ai/claude-agent-sdk`'s `query({ prompt, options: { model, allowedTools: [], maxTurns: 1, permissionMode: 'bypassPermissions' } })` (or whatever the SDK exposes for one-shot text). Iterate the async generator to collect the assistant's text response; parse and validate with zod schemas (`AbsoluteScoreSchema`, `PairwiseScoreSchema`). Compute weighted overall from the validated scores using `judgeConfig.weights` (sum must equal 1.0; throw if not). Surface a clear error if both Claude Code login and `ANTHROPIC_API_KEY` are absent — detect by catching the SDK's auth error and rethrowing with a descriptive message.

- `judge.yaml` (eval root) — config:
  ```yaml
  model: claude-opus-4-7
  maxOutputTokens: 2048
  weights:
    prdAdherence: 0.4
    codeQuality: 0.25
    testQuality: 0.25
    changeDiscipline: 0.1
  maxDiffBytes: 80000
  ```

- `prompts/judge-absolute.md` — rubric prompt with placeholders. Must include:
  - Instruction to grade independently on each of 4 dimensions.
  - Anchored 1–5 scale per dimension with concrete what-good-looks-like / what-bad-looks-like for each (e.g., for testQuality: 1 = no new tests or only smoke tests; 3 = happy-path tests for new functions; 5 = happy + edge + error paths with meaningful assertions).
  - Strict JSON-only output spec matching the data shape.
  - Inputs section embedding `{{PRD}}`, `{{VALIDATION_SUMMARY}}`, `{{DIFF}}`.

- `prompts/judge-pairwise.md` — pairwise prompt:
  - Instruction to compare A vs. B per dimension and pick `"a" | "b" | "tie"` with one-sentence justification.
  - Same anchored scale references as absolute.
  - Strict JSON-only output spec.
  - Inputs: `{{PRD}}`, `{{PROFILE_A}}` + `{{DIFF_A}}`, `{{PROFILE_B}}` + `{{DIFF_B}}`.

### Modify

- `lib/types.ts` — add new types:
  - `QualityDimensionScore { score: 1|2|3|4|5; justification: string }`
  - `AbsoluteScore { judge: { model: string; version: string }; dimensions: { prdAdherence: QualityDimensionScore; codeQuality: QualityDimensionScore; testQuality: QualityDimensionScore; changeDiscipline: QualityDimensionScore }; overall: { weighted: number; weights: Record<string, number> }; inputs: { diffBytes: number; diffTruncated: boolean } }`
  - `PairwiseDimensionResult { winner: 'a' | 'b' | 'tie'; justification: string }`
  - `PairwiseScore { perDimension: { prdAdherence: PairwiseDimensionResult; codeQuality: PairwiseDimensionResult; testQuality: PairwiseDimensionResult; changeDiscipline: PairwiseDimensionResult } }`
  - `QualityBlock { absolute?: AbsoluteScore }`
  - Add `quality?: QualityBlock` to `ScenarioResult`.

- `lib/runner.ts`:
  - Add `scoreQuality: boolean` to `RunArgs` (default `false`); add `--score-quality` case to `parseArgs()`.
  - Add `scoreQuality: boolean` to `ScenarioRunOpts`; pass through `runScenarioWithRepeats` and into `runScenario`.
  - In `runScenario`, after the existing expectations block and before `cleanupWorkspace(workspace)` (current line 591), insert quality-scoring block guarded by `if (opts.scoreQuality && !dryRun && eforgeExit === 0)`:
    - `const qualityDir = join(scenarioDir, 'quality'); mkdirSync(qualityDir, { recursive: true });`
    - Resolve baseline: `const baseline = execSync('git rev-list --max-parents=0 HEAD', { cwd: workspace, encoding: 'utf8' }).trim();`
    - Capture diff: `const diff = execSync(`git diff ${baseline}..HEAD`, { cwd: workspace, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });`
    - `writeFileSync(join(qualityDir, 'diff.patch'), diff);`
    - Copy PRD: `cpSync(join(workspace, scenario.prd), join(qualityDir, 'prd.md'));`
    - Load judge config: `const judgeConfig = loadJudgeConfig();`
    - `const absolute = await scoreAbsolute({ prd: readFileSync(join(qualityDir, 'prd.md'), 'utf8'), diffPatch: diff, validation, judgeConfig });`
    - `mergeQualityIntoResult(join(scenarioDir, 'result.json'), { absolute });`
    - Log: `log(`  Quality (absolute): prd=${absolute.dimensions.prdAdherence.score} code=${absolute.dimensions.codeQuality.score} test=${absolute.dimensions.testQuality.score} disc=${absolute.dimensions.changeDiscipline.score} → ${absolute.overall.weighted.toFixed(2)}`);`
    - Wrap in try/catch — failures log a `RED` warning but do not fail the scenario.
  - In `main()`, when invoking `compare.ts` (around line 1173), append `--score-quality` to the args when `args.scoreQuality` is true.
  - Update `printHelp()` to document `--score-quality` (one-line description: "Run LLM-as-judge quality scoring (absolute per run, pairwise on compare)").

- `lib/build-result.ts` — no logic changes required; the type extension lives in `lib/types.ts` and `quality` is written by the merge helper. Add a one-line comment noting that `quality` is populated post-build by `score-quality.ts`.

- `lib/compare.ts`:
  - Parse `--score-quality` from `process.argv` (in `main()`).
  - Add `QualityComparison`, `QualityAbsoluteSubBlock`, `QualityPairwiseSubBlock`, `PairwiseEntry` types matching the PRD's data shape.
  - Extend `ProfileEntry` with `qualityDir?: string` (path to `<scenarioDir>/quality/`) so pairwise can read `prd.md` and `diff.patch` per entry.
  - In `groupByScenario`, populate `qualityDir` from `join(runDir, entry.name, 'quality')` if it exists.
  - Add `compareQuality(profiles, group, judgeConfig)` (async). Builds `absolute` block from already-present `result.quality.absolute` data. Builds `pairwise` block by iterating `for (const [a, b] of pairs(profiles))`, randomizing A/B order, reading `<qualityDir>/{prd.md,diff.patch}` for each side, calling `scorePairwise`. Denormalize winners back to original labels.
  - Wire into `buildComparisonReport` (must become async — propagate); add `quality?: QualityComparison` to `ComparisonDimensions`. Only populate when `--score-quality` flag set OR any `result.quality?.absolute` is present.
  - Add quality block printing to `printComparisonTable`: per-dimension absolute ranking, weighted overall ranking, pairwise win matrix.
  - Log a single-line pairwise cost summary across the run.
  - Update `main()` to be async and await the report.

- `package.json` — add to `dependencies`:
  ```json
  "@anthropic-ai/claude-agent-sdk": "^0.2.119"
  ```
  (Matches `eforge/packages/engine/package.json` for consistency.)

- `CLAUDE.md` — add a short subsection under "Architecture":
  ```markdown
  ### Quality scoring (LLM-as-judge)

  Opt-in with `--score-quality` on `run.sh`. Per scenario, an absolute rubric (PRD adherence, code quality, test quality, change discipline) is captured into `result.json.quality.absolute`. During `compare.ts`, profiles in the same scenario group are scored pairwise into `comparison.json.groups[].dimensions.quality`.

  Snapshots (`<scenarioDir>/quality/{prd.md,diff.patch}`) are written before workspace cleanup, so `compare.ts` can re-score from an existing results dir without re-running eforge.

  Auth: judge calls go through `@anthropic-ai/claude-agent-sdk`, which uses Claude Code's host auth (subscription if logged in) and falls back to `ANTHROPIC_API_KEY`. Configuration lives in `judge.yaml` at the eval root (model, max output tokens, per-dimension weights, `maxDiffBytes`).
  ```

## Verification

- [ ] `pnpm type-check` exits 0.
- [ ] `lib/types.ts` exports `AbsoluteScore`, `PairwiseScore`, `QualityBlock`, and `ScenarioResult` has `quality?: QualityBlock`.
- [ ] `lib/score-quality.ts` exists and exports `scoreAbsolute`, `scorePairwise`, `loadJudgeConfig`, `mergeQualityIntoResult`, `truncateDiff`.
- [ ] `judge.yaml` exists at eval root with `model`, `maxOutputTokens`, `weights` (4 keys summing to 1.0), `maxDiffBytes`.
- [ ] `prompts/judge-absolute.md` and `prompts/judge-pairwise.md` exist and contain the placeholders `{{PRD}}` and `{{DIFF}}` (absolute) / `{{DIFF_A}}` and `{{DIFF_B}}` (pairwise).
- [ ] `package.json` declares `@anthropic-ai/claude-agent-sdk` in `dependencies`.
- [ ] `lib/runner.ts` `parseArgs()` recognizes `--score-quality` and stores it on `RunArgs`.
- [ ] `lib/runner.ts` `runScenario()` writes `<scenarioDir>/quality/diff.patch` and `<scenarioDir>/quality/prd.md` before `cleanupWorkspace()` when `--score-quality` is set, eforge exited 0, and dry-run is off.
- [ ] When `--score-quality` is OFF, `result.json` does NOT contain a `quality` key (regression check — baseline shape is unchanged).
- [ ] When `--score-quality` is ON, `result.json.quality.absolute.inputs.diffBytes` records the diff size in bytes (the originalBytes pre-truncation if applicable).
- [ ] `lib/runner.ts` invokes `compare.ts` with `--score-quality` appended when the flag is set.
- [ ] `lib/compare.ts` parses `--score-quality`, adds an async `compareQuality()` function, and extends `ComparisonDimensions` with `quality?: QualityComparison`.
- [ ] `lib/compare.ts` reads `<scenarioDir>/quality/prd.md` and `<scenarioDir>/quality/diff.patch` per profile entry when scoring pairwise — does NOT re-read the workspace.
- [ ] When `quality.absolute` is present in any `result.json` in the run dir, `compare.ts` includes the quality dimension in the printed table even without the flag.
- [ ] Diff-truncation logic produces a marker line containing the substring `TRUNCATED` and sets `inputs.diffTruncated: true` when the diff exceeds `judge.yaml`'s `maxDiffBytes`.
- [ ] Pairwise A/B order is randomized per pair (calls `Math.random()` to decide order) and final winners are denormalized to original profile labels in `pairwise.pairs[].perDimension[*].winner`.
- [ ] When `--score-quality` is on, the runner logs a single line per scenario containing the substring `quality scoring:` with input + output token counts.
- [ ] When `--score-quality` is on, `compare.ts` logs a single line containing `pairwise quality scoring:` with total call count and token counts.
- [ ] Judge SDK call uses `allowedTools: []` (or equivalent option) so the judge has no tool/file access.
- [ ] If neither Claude Code host auth nor `ANTHROPIC_API_KEY` is available, `scoreAbsolute()` throws an error whose message contains both `Claude Code` and `ANTHROPIC_API_KEY`.
- [ ] Re-invoking `npx tsx lib/compare.ts <existing-results-dir> --score-quality` regenerates pairwise scores from `<scenarioDir>/quality/` snapshots without invoking the runner.
- [ ] `CLAUDE.md` contains a `### Quality scoring (LLM-as-judge)` subsection mentioning `--score-quality`, `judge.yaml`, and the auth fallback.
