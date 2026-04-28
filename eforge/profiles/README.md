# Profiles

Each YAML file is a plain eforge profile (loaded into the workspace at run time via `--profile <name>`). Filename = profile name.

All profiles use the **tier-based config layer** (`agents.tiers.<tier>`): instead of overriding settings per agent role, effort and model class are set at the tier level. The four tiers are `planning`, `implementation`, `review`, and `evaluation`.

## Profile matrix

| Profile | Harness | `max` model | `balanced` model | Distinguishing feature |
| --- | --- | --- | --- | --- |
| `claude-sdk-opus` | claude-sdk | `claude-opus-4-7` | `claude-sonnet-4-6` | Flagship baseline. |
| `pi-opus` | pi (anthropic) | `claude-opus-4-7` | `claude-sonnet-4-6` | Same models as `claude-sdk-opus`, different harness. |
| `pi-gpt` | pi (openai-codex) | `gpt-5.5` | `gpt-5.5` | Frontier OpenAI lane. |
| `pi-kimi-k-2-6` | pi (openrouter) | `moonshotai/kimi-k2.6` | `moonshotai/kimi-k2.6` | Open-weights lane (Moonshot Kimi K2.6). |
| `pi-local-qwen-27b` | pi (llama-cpp) | `qwen-27b` | `qwen-27b` | Self-hosted local lane (Qwen 27b). |
| `claude-sdk-opus-no-subagents` | claude-sdk | `claude-opus-4-7` | `claude-sonnet-4-6` | `disableSubagents: true` — `Task` tool removed. |
| `claude-sdk-opus-xhigh-review` | claude-sdk | `claude-opus-4-7` | `claude-sonnet-4-6` | review + evaluation tiers run at `xhigh` effort. |
| `claude-sdk-opus-xhigh-plan-review` | claude-sdk | `claude-opus-4-7` | `claude-sonnet-4-6` | planning + review tiers run at `xhigh` effort. |
| `claude-sdk-opus-xhigh-planning-only` | claude-sdk | `claude-opus-4-7` | `claude-sonnet-4-6` | Only the planning tier runs at `xhigh`; one-leaf diff vs baseline. |
| `claude-sdk-opus-xhigh-eval-only` | claude-sdk | `claude-opus-4-7` | `claude-sonnet-4-6` | Only the evaluation tier runs at `xhigh`; one-leaf diff vs baseline. |
| `claude-sdk-opus-impl-opus-medium` | claude-sdk | `claude-opus-4-7` | `claude-sonnet-4-6` | Implementation tier uses `max` model class (Opus) instead of `balanced` (Sonnet). |
| `mixed-opus-planner-pi-builder` | claude-sdk + pi | `claude-opus-4-7` | `claude-sonnet-4-6` | `builder` role offloaded to local mlx-lm Qwen via Pi. |
| `mixed-opus-kimi-tester` | claude-sdk + pi | `claude-opus-4-7` | `claude-sonnet-4-6` | `tester` role offloaded to Pi + OpenRouter Kimi K2.6 (cheap open-weights). |
| `mixed-opus-kimi-evaluator` | claude-sdk + pi | `claude-opus-4-7` | `claude-sonnet-4-6` | `evaluator` role offloaded to Pi + OpenRouter Kimi K2.6 (cheap open-weights). |
| `mixed-kimi-planner-local-qwen-builder` | pi + pi | `moonshotai/kimi-k2.6` | `moonshotai/kimi-k2.6` | Planner/reviewer on Kimi K2.6; builder/fixer/tester offloaded to local Qwen 27b. |

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
| Implementation model upgrade (Sonnet → Opus, one-leaf, marginal-delta clean) | `--profile claude-sdk-opus,claude-sdk-opus-impl-opus-medium` |
| Local-builder offload | `--profile claude-sdk-opus,mixed-opus-planner-pi-builder` |
| Tester-role offload (Sonnet → Kimi K2.6) | `--profile claude-sdk-opus,mixed-opus-kimi-tester` |
| Evaluator-role offload (Opus → Kimi K2.6) | `--profile claude-sdk-opus,mixed-opus-kimi-evaluator` |
| Local Qwen builder vs Kimi | `--profile pi-kimi-k-2-6,pi-local-qwen-27b` |
| Kimi planner + local Qwen builder (mixed) | `--profile pi-kimi-k-2-6,mixed-kimi-planner-local-qwen-builder` |

### Controlled-comparison guarantees (claude-sdk-opus ↔ pi-opus)

- Matched: `agents.models.max.id`, `agents.models.balanced.id`, all four tier `effort`/`modelClass` values.
- Intentionally unset: `agents.thinking` — Pi maps `{ type: 'adaptive' }` to a fixed `'medium'` while Claude SDK truly does adaptive. Letting both derive thinking from `effort` is the cleanest mapping available without engine changes.
- Not controlled (and is part of what you're measuring): tool implementations, prompt-caching behavior, retry policy, and any other harness-specific request-pipeline characteristics.

## Tier model

### Tier categories and roles

| Tier | Roles |
| --- | --- |
| `planning` | planner, module-planner, pipeline-composer, formatter, dependency-detector |
| `implementation` | builder, review-fixer, validation-fixer, tester, test-writer, gap-closer, doc-updater, recovery-analyst, merge-conflict-resolver |
| `review` | reviewer, architecture-reviewer, cohesion-reviewer, plan-reviewer, staleness-assessor, prd-validator |
| `evaluation` | evaluator, architecture-evaluator, cohesion-evaluator, plan-evaluator |

Built-in defaults: `effort: high, modelClass: max` for planning/review/evaluation; `effort: medium, modelClass: balanced` for implementation.

### Per-tier knobs

`effort`, `modelClass`, `model`, `thinking`, `maxTurns`, `maxBudgetUsd`, `allowedTools`, `disallowedTools`, `agentRuntime`.

### Resolution precedence (highest → lowest)

1. Plan-file override
2. Per-role override (`agents.roles.<role>.<field>`)
3. Per-tier override (`agents.tiers.<tier>.<field>`)
4. Global setting (`agents.<field>`)
5. Built-in per-role exception
6. Built-in per-tier default

`mixed-opus-planner-pi-builder` and `mixed-kimi-planner-local-qwen-builder` are the canonical examples of per-role overriding per-tier: in the former, implementation tier defaults to Sonnet on the `opus` runtime but the `builder` role is pinned to local mlx-lm Qwen on `pi-local`; in the latter, all tiers default to Kimi K2.6 on `pi-kimi` but `builder`, `fixer`, and `tester` are pinned to local Qwen 27b on `pi-local`.
