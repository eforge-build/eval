---
title: Add LLM-as-judge quality scoring to the eval harness
created: 2026-04-26
---

# Add LLM-as-judge quality scoring to the eval harness

## Problem / Motivation

Today the eval harness (`/Users/markschaake/projects/eforge-build/eval`) tells us whether a profile produced a *correct* result (validation passes, expectations match) and at what *cost* (tokens, dollars, duration). It does not tell us whether the result is *good* — and that gap matters most exactly when comparing profiles that all pass: a cheap profile may produce shallow tests, a sprawling diff, or a literal-but-spirit-missing PRD interpretation, and the current report can't see any of it.

## Goal

Add a quality scoring layer using LLM-as-judge (Claude). Per scenario run, capture an **absolute** rubric score; across profiles that share a scenario, add a **pairwise** head-to-head comparison. Outputs land in `result.json` (absolute) and `comparison.json` (pairwise) and become a ninth dimension in `lib/compare.ts`.

Per the user's choices: rubric covers **PRD adherence, code quality, test quality, change discipline**, and we run **both** absolute and pairwise scoring.

## Approach

1. **Inline absolute scoring before cleanup.** The workspace is deleted at `lib/runner.ts:591`, so absolute scoring must run before that line. We add one judge call per scenario run that returns a JSON rubric across all four dimensions. Result lands in `result.json.quality.absolute`.

   The judge uses **`@anthropic-ai/claude-agent-sdk`** (not the raw Anthropic SDK), so it inherits Claude Code's auth on the host — meaning your subscription, not pay-per-token API billing. We use the SDK's `query()` one-shot interface with tools disabled (no MCP, no file access — just text-in / JSON-out).

2. **Snapshot artifacts for post-hoc pairwise.** Before cleanup, copy the per-scenario `diff.patch` (`git diff <fixture-baseline>..HEAD`) plus the PRD text into `<scenarioDir>/quality/`. This lets pairwise scoring run during `compare.ts` without keeping workspaces alive, and it makes re-scoring with a different rubric cheap later.

3. **Pairwise during compare.** `lib/compare.ts` already groups scenarios by base ID. For each group with ≥2 profiles, run one judge call per profile pair (returning all four dimension winners in one JSON payload). Aggregate winners and write to `comparison.json` under a new `quality` dimension.

4. **Opt-in flag.** Quality scoring adds API spend. Gate behind `--score-quality` on `run.sh` (off by default). Same flag enables absolute scoring during run and pairwise during compare.

### Files to modify or add

#### New files

- **`lib/score-quality.ts`** — judge module. Exports:
  - `scoreAbsolute({ prd, diffPatch, validation, judgeConfig }): Promise<AbsoluteScore>`
  - `scorePairwise({ prd, diffA, diffB, profileA, profileB, judgeConfig }): Promise<PairwiseScore>`
  - `loadJudgeConfig(): JudgeConfig` (reads `judge.yaml`, falls back to defaults)
  - Internal: prompt builders; uses `@anthropic-ai/claude-agent-sdk`'s `query()` with `allowedTools: []` and `permissionMode: 'default'` (or equivalent — the goal is no tool use, no file access, single completion); response parsed and validated with `zod` (already a dep).
- **`judge.yaml`** (eval root) — judge config:
  ```yaml
  model: claude-opus-4-7
  maxOutputTokens: 2048
  # Per-dimension weights for the overall absolute score (must sum to 1.0)
  weights:
    prdAdherence: 0.4
    codeQuality: 0.25
    testQuality: 0.25
    changeDiscipline: 0.1
  # Optional: cap diff size sent to judge to control cost
  maxDiffBytes: 80000
  ```
- **`prompts/judge-absolute.md`** and **`prompts/judge-pairwise.md`** — rubric prompts with anchors for each dimension (1=very poor, 5=excellent), examples of what good vs bad looks like for each, and strict JSON output format.

#### Modified files

- **`lib/runner.ts`**
  - After `checkExpectations(...)` completes (around line 580), if `opts.scoreQuality` is true:
    - Capture `git diff <baseline>..HEAD` from the workspace into `<scenarioDir>/quality/diff.patch`. The baseline tag is the commit made after the fresh `git init` + initial fixture commit (already done by the runner — verify and reuse).
    - Copy the PRD file into `<scenarioDir>/quality/prd.md`.
    - Call `scoreAbsolute(...)` with the PRD, diff, and validation summary; merge the result into `result.json` under `quality.absolute`.
  - Add `scoreQuality: boolean` to `ScenarioRunOpts` and plumb from CLI.
  - Add `--score-quality` to argv parsing (mirrors how `--dry-run` and other flags are handled).
  - Cleanup at `runner.ts:591` stays unchanged — quality artifacts live in `<scenarioDir>/quality/`, which is outside the temp workspace.
- **`lib/build-result.ts`** — extend the produced shape with optional `quality` block; `score-quality.ts` writes to it via a small merge helper (don't duplicate the monitor-DB-driven `metrics` build path).
- **`lib/compare.ts`**
  - Add `QualityComparison` type with two sub-blocks: `absolute` (ranked profile scores per dimension + weighted overall) and `pairwise` (per-pair winners aggregated to per-dimension win counts + ties + overall winner).
  - When `--score-quality` is set (or when `quality.absolute` is present in the inputs — auto-detect), include the new dimension in `ComparisonDimensions` and the printed table.
  - For each comparison group with ≥2 profiles, call `scorePairwise` once per `(profileA, profileB)` pair, reading PRD + diff from the `<scenarioDir>/quality/` snapshots.
- **`lib/types.ts`** — add `AbsoluteScore`, `PairwiseScore`, `QualityBlock` types; reference from `ScenarioResult`.
- **`package.json`** — add `@anthropic-ai/claude-agent-sdk`. Pin to whatever version eforge's `claude-sdk` harness uses (check `eforge/packages/engine` or `eforge/packages/client`) for consistency. No other deps; `zod` and `js-yaml` are already present.
- **Auth** — judge inherits whatever Claude Code is authenticated with on the host (subscription or API key). No new env var, no new env file. Document in `CLAUDE.md` that `--score-quality` requires Claude Code to be installed and logged in on the machine running the eval. If the host has only an `ANTHROPIC_API_KEY` and no Claude Code login, the agent SDK falls back to that — surface a clear error if neither is present.
- **`run.sh`** — pass `--score-quality` through to `lib/runner.ts`. Add a brief usage line in the help text.
- **`CLAUDE.md`** — short section under "Architecture" describing the quality layer, the `judge.yaml` knobs, and the `--score-quality` flag.

### Data shapes

#### `result.json.quality.absolute`

```json
{
  "judge": { "model": "claude-opus-4-7", "version": "judge-v1" },
  "dimensions": {
    "prdAdherence":     { "score": 4, "justification": "..." },
    "codeQuality":      { "score": 3, "justification": "..." },
    "testQuality":      { "score": 4, "justification": "..." },
    "changeDiscipline": { "score": 5, "justification": "..." }
  },
  "overall": { "weighted": 3.85, "weights": { "prdAdherence": 0.4, ... } },
  "inputs": { "diffBytes": 12345, "diffTruncated": false }
}
```

#### `comparison.json.groups[].dimensions.quality`

```json
{
  "absolute": {
    "dimensions": {
      "prdAdherence": {
        "ranked": [{ "profile": "claude-sdk-4-7", "value": 4 }, ...],
        "bestProfile": "claude-sdk-4-7",
        "worstProfile": "pi-anthropic-4-7"
      },
      "codeQuality": { ... },
      "testQuality": { ... },
      "changeDiscipline": { ... }
    },
    "overall": { "ranked": [{ "profile": "...", "value": 3.85 }], ... }
  },
  "pairwise": {
    "pairs": [
      {
        "a": "claude-sdk-4-7",
        "b": "pi-anthropic-4-7",
        "perDimension": {
          "prdAdherence":    { "winner": "a", "justification": "..." },
          "codeQuality":     { "winner": "tie", "justification": "..." },
          "testQuality":     { "winner": "b", "justification": "..." },
          "changeDiscipline":{ "winner": "a", "justification": "..." }
        }
      }
    ],
    "summary": {
      "perDimension": {
        "prdAdherence":    { "wins": { "claude-sdk-4-7": 1 }, "ties": 0 },
        ...
      }
    }
  }
}
```

### Cost control

- Auth via `@anthropic-ai/claude-agent-sdk` means usage flows through Claude Code, so a subscription absorbs cost up to its included quota; only overflow hits per-token billing.
- One absolute call per scenario run (~5–8k input tokens dominated by diff; ~500–800 output tokens). For 9 scenarios × 4 profiles ≈ 36 calls.
- One pairwise call per profile pair per scenario. 9 scenarios with 4 profiles ≈ 9 × C(4,2) = 54 calls.
- `judge.yaml` `maxDiffBytes` truncates large diffs (with a marker so the judge knows it was cut). The truncation flag is recorded in `result.json`.
- Order-effect mitigation in pairwise: not run twice — instead, randomize which profile is presented as "A" per pair to avoid systematic bias. (Two-pass averaging is a phase-2 optimization.)

### Reused existing functions / patterns

- **Profile YAML loading**: mirror `readProfile()` in `lib/runner.ts:320-326` for `judge.yaml`.
- **Env file sourcing**: piggyback on the existing `profile-envs.yaml` / `--env-file` mechanism (no new env infrastructure).
- **JSON schema validation**: `zod` is already a dep — use it for judge response parsing.
- **Logging style**: reuse `log()`, `GREEN`/`RED`/`DIM` constants in `runner.ts`.
- **Comparison grouping**: `groupByScenario()` in `compare.ts:115` already produces the exact pairs we need for pairwise scoring.

## Scope

### In scope

- New `lib/score-quality.ts` judge module using `@anthropic-ai/claude-agent-sdk`.
- New `judge.yaml` config (model, max output tokens, per-dimension weights, `maxDiffBytes`).
- New rubric prompts: `prompts/judge-absolute.md` and `prompts/judge-pairwise.md`.
- Modifications to `lib/runner.ts`, `lib/build-result.ts`, `lib/compare.ts`, `lib/types.ts`, `package.json`, `run.sh`, `CLAUDE.md`.
- Snapshotting `diff.patch` and `prd.md` into `<scenarioDir>/quality/` before workspace cleanup.
- Absolute scoring (4 dimensions: PRD adherence, code quality, test quality, change discipline) inline during run.
- Pairwise scoring during `compare.ts` for groups with ≥2 profiles.
- `--score-quality` opt-in flag wired through `run.sh` → `lib/runner.ts` and into `compare.ts` (also auto-detected when `quality.absolute` is present in inputs).
- Quality dimension added to `ComparisonDimensions` and printed table.
- Auth via Claude Code on host (subscription) with fallback to `ANTHROPIC_API_KEY`; clear error if neither is present.
- Diff truncation with marker and `diffTruncated` flag in `result.json`.
- Pairwise order-effect mitigation by randomizing which profile is "A".
- Per-run cost log line (e.g., `quality scoring: 4 calls, 24,310 input + 3,120 output tokens, ~$0.42`).

### Out of scope (deliberately)

- Two-pass order-swapped pairwise averaging (phase 2 if needed).
- Multi-judge ensembles (different models voting).
- Static-analysis quality signals (lint counts, complexity) — low signal-to-noise relative to LLM judge for this codebase's style.
- Storing full source snapshots (we keep only the diff + PRD; that's enough for re-scoring).
- A separate `judges/` profile-style config dir — single `judge.yaml` is sufficient for now and avoids a parallel config hierarchy.

## Acceptance Criteria

1. **Type check**: `pnpm type-check` passes.
2. **Single scenario, one profile, no scoring** (baseline regression):
   `./run.sh --profile claude-sdk-4-7 todo-api-errand-health-check`
   → confirm `result.json` is unchanged shape (no `quality` key).
3. **Single scenario, one profile, scoring on**:
   `./run.sh --profile claude-sdk-4-7 todo-api-errand-health-check --score-quality`
   → confirm `result.json.quality.absolute` populated with all four dimensions, justifications non-empty, weighted overall in [1,5].
4. **Multi-profile scenario, scoring on** (the headline case):
   `./run.sh --profile claude-sdk-4-7,pi-anthropic-4-7 todo-api-errand-health-check --score-quality`
   → both `result.json` files have absolute scores; `comparison.json` has the new `quality` dimension with one pairwise entry; printed table shows the ranking.
5. **Sanity bias check**: pick a known-good run (claude-sdk-4-7 on a passing scenario) and a known-bad run (e.g., a fixture where we manually break a test or produce a nonsense diff) — confirm the rubric scores diverge sensibly. Tweak prompt anchors if scores cluster too high/low.
6. **Cost sanity**: capture token usage from the Anthropic SDK responses and log a single-line summary per run (e.g., `quality scoring: 4 calls, 24,310 input + 3,120 output tokens, ~$0.42`) so cost is visible.
7. **Re-score from snapshot**: re-run `lib/compare.ts` against an existing results dir (without re-running eforge) and confirm pairwise scores regenerate from the `<scenarioDir>/quality/` snapshots alone.
