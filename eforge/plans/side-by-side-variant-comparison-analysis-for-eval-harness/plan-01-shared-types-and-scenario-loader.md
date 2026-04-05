---
id: plan-01-shared-types-and-scenario-loader
name: Extract Shared Types and Create Scenario Loader
depends_on: []
branch: side-by-side-variant-comparison-analysis-for-eval-harness/shared-types-and-scenario-loader
---

# Extract Shared Types and Create Scenario Loader

## Architecture Context

The eval harness has duplicated type definitions across `lib/analyze.ts` (lines 14–66) and `lib/build-result.ts` (lines 34–88). Both files define `AgentAggregate` identically, and `analyze.ts` defines `ReviewMetrics`, `ScenarioMetrics`, `ExpectationCheck`, and `ScenarioResult` that mirror the `Metrics` interface structure in `build-result.ts`. Additionally, scenario YAML parsing happens via an inline `npx tsx` call in `run.sh` (function `parse_scenarios`, lines 15–28) with no reusable TypeScript module. This plan extracts shared types and creates a scenario loader as foundational pieces for the comparison module (plan-02) and the broader bash→TS migration.

## Implementation

### Overview

Create `lib/types.ts` containing all shared type definitions, and `lib/scenarios.ts` containing a typed YAML loader with group ID and variant label derivation functions. Update `lib/analyze.ts` and `lib/build-result.ts` to import from `lib/types.ts` instead of defining their own copies.

### Key Decisions

1. **`lib/types.ts` exports the superset of types used by both consumers.** Types unique to `build-result.ts` (`PhaseTimestamps`, `ModelAggregate`, `ReviewIssueDetail`, `EvaluationVerdict`, and the full `Metrics` interface) are included because `compare.ts` (plan-02) will also need them. Analysis-specific types (`Severity`, `Observation`, `Trend`, `AnalysisReport`) are also included since they may be useful for cross-module consumption.
2. **`ScenarioMetrics` in `analyze.ts` and `Metrics` in `build-result.ts` describe the same shape** — the `review` field is typed inline in `Metrics` and as `ReviewMetrics` in `ScenarioMetrics`, but they're structurally identical. Consolidate into a single `ScenarioMetrics` type using the named `ReviewMetrics` sub-type.
3. **`lib/scenarios.ts` uses the `yaml` package** already in devDependencies (`yaml@^2`). No new dependencies needed.
4. **`deriveGroupId` returns `"<fixture>::<prd>"`** (e.g., `"todo-api::docs/add-health-check.md"`). The `::` separator is unambiguous since neither fixture names nor PRD paths contain `::`.
5. **`deriveVariantLabel` extracts from `configOverlay`** — returns `configOverlay.backend` for simple backends (e.g., `"claude-sdk"`), or `"<backend>/<model-id>"` when `agents.models.max` is specified (e.g., `"pi/nemotron-3-super-120b-a12b:free"`). Falls back to scenario `id` if no configOverlay exists.

## Scope

### In Scope
- Create `lib/types.ts` with all shared type definitions
- Create `lib/scenarios.ts` with `loadScenarios()`, `deriveGroupId()`, and `deriveVariantLabel()` functions
- Update `lib/analyze.ts` to import types from `lib/types.ts`, removing lines 14–94
- Update `lib/build-result.ts` to import types from `lib/types.ts`, removing lines 34–88
- Ensure `pnpm type-check` passes after all changes

### Out of Scope
- Replacing the bash `parse_scenarios` function in `run.sh` — that's a future migration step
- Adding `compareGroup` or `variantLabel` fields to `scenarios.yaml`
- The comparison module itself (plan-02)

## Files

### Create
- `lib/types.ts` — Shared type definitions consolidated from `analyze.ts` and `build-result.ts`. Exports: `AgentAggregate`, `ModelAggregate`, `ReviewMetrics`, `ReviewIssueDetail`, `EvaluationVerdict`, `PhaseTimestamps`, `ScenarioMetrics`, `ExpectationCheck`, `ScenarioResult`, `Severity`, `Observation`, `Trend`, `AnalysisReport`. Also exports `ScenarioMeta` (typed scenario YAML shape used by `scenarios.ts` and `compare.ts`).
- `lib/scenarios.ts` — Library module with exported functions: `loadScenarios(yamlPath: string): ScenarioMeta[]`, `deriveGroupId(s: ScenarioMeta): string`, `deriveVariantLabel(s: ScenarioMeta): string`. Uses `yaml` package to parse `scenarios.yaml`.

### Modify
- `lib/analyze.ts` — Remove inline type definitions (lines 14–94). Add `import { type AgentAggregate, type ReviewMetrics, type ScenarioMetrics, type ExpectationCheck, type ScenarioResult, type Severity, type Observation, type Trend, type AnalysisReport } from './types.js';` after existing imports. No logic changes.
- `lib/build-result.ts` — Remove inline type definitions (lines 34–88). Add `import { type AgentAggregate, type ModelAggregate, type PhaseTimestamps, type ReviewIssueDetail, type EvaluationVerdict, type ScenarioMetrics } from './types.js';` after existing imports. Replace local `Metrics` type usage with imported `ScenarioMetrics`. No logic changes.

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `lib/analyze.ts` contains zero `interface` declarations — all types imported from `./types.js`
- [ ] `lib/build-result.ts` contains zero `interface` declarations — all types imported from `./types.js`
- [ ] `lib/types.ts` exports at least these types: `AgentAggregate`, `ModelAggregate`, `ReviewMetrics`, `ScenarioMetrics`, `ExpectationCheck`, `ScenarioResult`, `ScenarioMeta`
- [ ] `lib/scenarios.ts` exports `loadScenarios`, `deriveGroupId`, `deriveVariantLabel`
- [ ] `deriveGroupId({ id: 'x', fixture: 'todo-api', prd: 'docs/add-health-check.md' })` returns `"todo-api::docs/add-health-check.md"`
- [ ] `deriveVariantLabel` for a scenario with `configOverlay: { backend: 'claude-sdk' }` returns `"claude-sdk"`
- [ ] `deriveVariantLabel` for a scenario with `configOverlay: { backend: 'pi', agents: { models: { max: { provider: 'openrouter', id: 'nvidia/nemotron-3-super-120b-a12b:free' } } } }` returns `"pi/nemotron-3-super-120b-a12b:free"` (strips provider prefix from model ID)
- [ ] `deriveVariantLabel` for a scenario with `variantLabel: 'custom'` returns `"custom"` (explicit override takes precedence)
