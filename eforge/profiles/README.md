# Profiles

Each YAML file is a plain eforge profile. Filename = profile name.

All profiles use the **single-axis tier schema** (`agents.tiers.<tier>`). Each tier is a self-contained recipe: harness + harness-specific config + model + effort. There is no shared model-class table, no separate runtime registry; tiers cross-reference nothing. The four tiers are `planning`, `implementation`, `review`, and `evaluation`.

## Profile matrix

| Profile | Harness | Planning model | Impl model | Review model | Eval model | Distinguishing feature |
| --- | --- | --- | --- | --- | --- | --- |
| `claude-sdk-opus` | claude-sdk | `claude-opus-4-7` | `claude-sonnet-4-6` | `claude-opus-4-7` | `claude-opus-4-7` | Flagship baseline. |
| `pi-opus` | pi (anthropic) | `claude-opus-4-7` | `claude-sonnet-4-6` | `claude-opus-4-7` | `claude-opus-4-7` | Same models as `claude-sdk-opus`, different harness. |
| `pi-gpt` | pi (openai-codex) | `gpt-5.5` | `gpt-5.5` | `gpt-5.5` | `gpt-5.5` | Frontier OpenAI lane. |
| `pi-kimi-k-2-6` | pi (openrouter) | `moonshotai/kimi-k2.6` | `moonshotai/kimi-k2.6` | `moonshotai/kimi-k2.6` | `moonshotai/kimi-k2.6` | Open-weights lane (Moonshot Kimi K2.6). |
| `claude-sdk-opus-no-subagents` | claude-sdk | `claude-opus-4-7` | `claude-sonnet-4-6` | `claude-opus-4-7` | `claude-opus-4-7` | `disableSubagents: true` on every tier; `Task` tool removed. |
| `claude-sdk-opus-xhigh-review` | claude-sdk | `claude-opus-4-7` | `claude-sonnet-4-6` | `claude-opus-4-7` | `claude-opus-4-7` | review + evaluation tiers run at `xhigh` effort. |
| `claude-sdk-opus-xhigh-plan-review` | claude-sdk | `claude-opus-4-7` | `claude-sonnet-4-6` | `claude-opus-4-7` | `claude-opus-4-7` | planning + review tiers run at `xhigh` effort. |
| `claude-sdk-opus-xhigh-planning-only` | claude-sdk | `claude-opus-4-7` | `claude-sonnet-4-6` | `claude-opus-4-7` | `claude-opus-4-7` | Only the planning tier runs at `xhigh`; one-leaf diff vs baseline. |
| `claude-sdk-opus-xhigh-eval-only` | claude-sdk | `claude-opus-4-7` | `claude-sonnet-4-6` | `claude-opus-4-7` | `claude-opus-4-7` | Only the evaluation tier runs at `xhigh`; one-leaf diff vs baseline. |
| `claude-sdk-opus-impl-opus-medium` | claude-sdk | `claude-opus-4-7` | `claude-opus-4-7` | `claude-opus-4-7` | `claude-opus-4-7` | Implementation tier uses Opus instead of Sonnet at the same effort. |
| `mixed-opus-kimi-evaluator` | claude-sdk + pi | `claude-opus-4-7` | `claude-sonnet-4-6` | `claude-opus-4-7` | `moonshotai/kimi-k2.6` | Evaluation tier wholesale moved to Pi + OpenRouter Kimi K2.6 (cheap open-weights). |

## Pairings

Each pair holds all but one variable constant so the comparison isolates that variable:

| Compares | Command |
| --- | --- |
| Harness (Claude SDK vs Pi) | `--profile claude-sdk-opus,pi-opus` |
| Model family (Opus vs GPT) | `--profile pi-opus,pi-gpt` |
| Model family (Opus vs Kimi vs GPT) | `--profile pi-opus,pi-gpt,pi-kimi-k-2-6` |
| Subagent contribution | `--profile claude-sdk-opus,claude-sdk-opus-no-subagents` |
| Review/eval effort tier | `--profile claude-sdk-opus,claude-sdk-opus-xhigh-review` |
| Plan/review effort tier | `--profile claude-sdk-opus,claude-sdk-opus-xhigh-plan-review` |
| Planning-only effort bump (one-leaf, marginal-delta clean) | `--profile claude-sdk-opus,claude-sdk-opus-xhigh-planning-only` |
| Eval-only effort bump (one-leaf, marginal-delta clean) | `--profile claude-sdk-opus,claude-sdk-opus-xhigh-eval-only` |
| Implementation model upgrade (Sonnet -> Opus, one-leaf, marginal-delta clean) | `--profile claude-sdk-opus,claude-sdk-opus-impl-opus-medium` |
| Evaluation-tier offload (Opus -> Kimi K2.6) | `--profile claude-sdk-opus,mixed-opus-kimi-evaluator` |

### Controlled-comparison guarantees (claude-sdk-opus <-> pi-opus)

- Matched: per-tier `model` and `effort` values are identical across the two profiles.
- Intentionally unset: `thinking` - Pi maps `{ type: 'adaptive' }` to a fixed `'medium'` while Claude SDK truly does adaptive. Letting both derive thinking from `effort` is the cleanest mapping available without engine changes.
- Not controlled (and is part of what you're measuring): tool implementations, prompt-caching behavior, retry policy, and any other harness-specific request-pipeline characteristics.

## Tier model

### Tier categories and roles

| Tier | Roles |
| --- | --- |
| `planning` | planner, module-planner, formatter, pipeline-composer, merge-conflict-resolver, doc-updater, gap-closer |
| `implementation` | builder, review-fixer, validation-fixer, test-writer, tester, recovery-analyst, dependency-detector, prd-validator, staleness-assessor |
| `review` | reviewer, architecture-reviewer, cohesion-reviewer, plan-reviewer |
| `evaluation` | evaluator, architecture-evaluator, cohesion-evaluator, plan-evaluator |

A user can reassign a single role via `agents.roles.<role>.tier`.

### Per-tier knobs

Required: `harness`, `model`, `effort`. Optional: `pi.provider` (when harness=pi), `pi.thinkingLevel`, `pi.compaction`, `pi.retry`, `claudeSdk.disableSubagents` (when harness=claude-sdk), `thinking`, `fallbackModel`, `maxTurns`, `allowedTools`, `disallowedTools`, `promptAppend`.

### Per-role overrides

Per-role overrides splice individual fields over the tier recipe. Allowed fields: `tier`, `effort`, `thinking`, `maxTurns`, `allowedTools`, `disallowedTools`, `promptAppend`, `shards`. Per-role harness/model/provider overrides are **not** supported in this schema; to run a single role on a different harness, declare a tier with that recipe and reassign the role via `roles.<role>.tier`.

### Resolution precedence (highest -> lowest)

1. Plan-file override (per-field on the role)
2. Per-role override (`agents.roles.<role>.<field>`)
3. Tier recipe (`agents.tiers.<tier>.<field>`)

Provenance is stamped on every resolved field as `tier | role | plan`.

## Removed profiles

Three earlier profiles relied on per-role harness/model overrides that the new schema does not expose:

- `mixed-opus-planner-pi-builder` (builder -> pi/mlx-lm/qwen)
- `mixed-opus-kimi-tester` (tester -> pi/openrouter/kimi)
- `mixed-kimi-planner-local-qwen-builder` (builder/review-fixer/tester -> pi/llama-cpp/qwen)

Single-role offload to a different harness within an otherwise-shared tier requires a follow-up schema change (open-string tier names referenceable from `roles.<role>.tier`). Until then, only whole-tier offload is expressible (see `mixed-opus-kimi-evaluator`).
