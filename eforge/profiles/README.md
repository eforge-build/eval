# Profiles

Each YAML file is a plain eforge profile (loaded into the workspace at run time via `--profile <name>`). Filename = profile name.

Profile files use the `agentRuntimes` shape required by the current engine:

```yaml
agentRuntimes:
  default:
    harness: claude-sdk     # or: pi
    # claudeSdk: / pi: blocks go here when needed
defaultAgentRuntime: default
agents:
  effort: high
  models:
    max:
      id: claude-opus-4-7
    balanced:
      id: claude-sonnet-4-6
```

## Controlled-comparison pairs

For apples-to-apples profile A/B evals, these profiles deliberately match the variables that affect agent behavior, and isolate only the harness implementation:

| Profile | Harness | Model (max) | Model (balanced) | Effort |
| --- | --- | --- | --- | --- |
| `claude-sdk-4-7.yaml` | claude-sdk | `claude-opus-4-7` | `claude-sonnet-4-6` | `high` |
| `pi-anthropic-4-7.yaml` | pi (anthropic) | `claude-opus-4-7` | `claude-sonnet-4-6` | `high` |
| `claude-sdk-4-6.yaml` | claude-sdk | `claude-opus-4-6` | `claude-sonnet-4-6` | `high` |
| `pi-anthropic-4-6.yaml` | pi (anthropic) | `claude-opus-4-6` | `claude-sonnet-4-6` | `high` |

Run a controlled 4.7 comparison with `--profile claude-sdk-4-7,pi-anthropic-4-7`. The 4.6 pair gives a baseline lane (2x2: harness × model).

### What is matched

- `agents.effort` — explicitly set to `high` on both profiles, isolating the eval from per-role default changes in the engine.
- `agents.models.max.id` and `agents.models.balanced.id` — pinned to the same model IDs.

### What is intentionally left unset

- `agents.thinking` — Pi maps `{ type: 'adaptive' }` to a fixed `'medium'` string while the Claude SDK truly does adaptive. Leaving thinking unset means both harnesses derive their thinking level from `effort`, which is the cleanest mapping available without engine changes.

### What is NOT controlled (and is part of what you're measuring)

- Tool implementations (Pi's tool surface vs the Claude Agent SDK's preset)
- Prompt-caching behavior, retry policy, cost/latency characteristics
- Anything else specific to each SDK's request pipeline

## `-no-subagents` variants

For each `claude-sdk-*.yaml` profile there is a sibling `claude-sdk-*-no-subagents.yaml` that is identical except it sets:

```yaml
agentRuntimes:
  default:
    harness: claude-sdk
    claudeSdk:
      disableSubagents: true
```

This appends `'Task'` to `disallowedTools` on every agent run, so the Claude Code `Task` tool is unavailable and roles cannot fan out into subagents. Pair a profile with its `-no-subagents` sibling to measure the contribution of subagent usage to a run:

| Lane | Profile | Sibling |
| --- | --- | --- |
| opus-4-7 | `claude-sdk-4-7.yaml` | `claude-sdk-4-7-no-subagents.yaml` |
| opus-4-6 | `claude-sdk-4-6.yaml` | `claude-sdk-4-6-no-subagents.yaml` |
| sonnet-4-6 (balanced) | `claude-sdk-balanced.yaml` | `claude-sdk-balanced-no-subagents.yaml` |

Example: `--profile claude-sdk-4-7,claude-sdk-4-7-no-subagents`.

There is no Pi counterpart — Pi has no `Task` tool / subagent concept, so `claudeSdk.disableSubagents` is Claude SDK-only.

## Mixed-runtime profiles

These profiles use the `agentRuntimes` map to assign different harnesses to different roles:

### `mixed-opus-planner-pi-builder.yaml`

Two named runtimes: `opus` (claude-sdk, `claude-opus-4-7`) for planning/review roles, `pi-openrouter` (pi, OpenRouter `qwen/qwen3-coder`) for the builder role. Requires `OPENROUTER_API_KEY` in the environment.

Smoke-test command:
```bash
./run.sh --profile opus-only,mixed-opus-planner-pi-builder todo-api-errand-health-check
```

## `opus-only.yaml`

Single-runtime profile pinned to claude-sdk + `claude-opus-4-7` with `effort: high`. Used as a fast smoke-test baseline alongside mixed-runtime profiles.

## Tier-layer profiles

These profiles exercise the `agents.tiers.<tier>` layer that sits between global agent settings and per-role overrides. The four tiers are `planning`, `implementation`, `review`, and `evaluation`; built-in defaults are `effort=high, modelClass=max` for planning/review/evaluation and `effort=medium, modelClass=balanced` for implementation.

### `claude-sdk-tiers-quality.yaml`

Quality-tilted variant of `claude-sdk-4-7.yaml`: review and evaluation tiers run at `effort: xhigh` while planning and implementation stay at the global `high` baseline. Isolates the effect of harder-thinking review/eval without changing the build path.

```bash
./run.sh --profile claude-sdk-4-7,claude-sdk-tiers-quality <scenario>
```

### `claude-sdk-tiers-demo.yaml`

Demonstration profile with all four tiers populated. Values match the built-in tier defaults, so this profile resolves identically to a no-tiers profile — its purpose is to show the shape and inline the role-to-tier membership so per-tier knobs can be edited without re-checking the source. Not intended as a measurement lane on its own.

## Other profiles

`claude-sdk-balanced.yaml` and the `pi-{codex,free,gemma4,glm,kimi-k-2-6,local-qwen-3-6-35B-A3B,nemotron}.yaml` profiles are out of the controlled-comparison pairs above. Use them for separate experiments.
