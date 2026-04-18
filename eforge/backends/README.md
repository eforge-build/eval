# Backend profiles

Each YAML file is a plain eforge backend profile (loaded into the workspace at run time via `--backend <name>`). Filename = profile name.

## Controlled-comparison pairs

For apples-to-apples backend A/B evals, these profiles deliberately match the variables that affect agent behavior, and isolate only the backend implementation:

| Profile | Backend | Model (max) | Model (balanced) | Effort |
| --- | --- | --- | --- | --- |
| `claude-sdk-4-7.yaml` | claude-sdk | `claude-opus-4-7` | `claude-sonnet-4-6` | `high` |
| `pi-anthropic-4-7.yaml` | pi (anthropic) | `claude-opus-4-7` | `claude-sonnet-4-6` | `high` |
| `claude-sdk-4-6.yaml` | claude-sdk | `claude-opus-4-6` | `claude-sonnet-4-6` | `high` |
| `pi-anthropic-4-6.yaml` | pi (anthropic) | `claude-opus-4-6` | `claude-sonnet-4-6` | `high` |

Run a controlled 4.7 comparison with `--backend claude-sdk-4-7,pi-anthropic-4-7`. The 4.6 pair gives a baseline lane (2x2: backend × model).

### What is matched

- `agents.effort` — explicitly set to `high` on both backends, isolating the eval from per-role default changes in the engine.
- `agents.models.max.id` and `agents.models.balanced.id` — pinned to the same model IDs.

### What is intentionally left unset

- `agents.thinking` — Pi maps `{ type: 'adaptive' }` to a fixed `'medium'` string while the Claude SDK truly does adaptive. Leaving thinking unset means both backends derive their thinking level from `effort`, which is the cleanest mapping available without engine changes.

### What is NOT controlled (and is part of what you're measuring)

- Tool implementations (Pi's tool surface vs the Claude Agent SDK's preset)
- Prompt-caching behavior, retry policy, cost/latency characteristics
- Anything else specific to each SDK's request pipeline

## Other profiles

`claude-sdk-balanced.yaml` and the `pi-{codex,free,gemma4,glm,nemotron}.yaml` profiles are out of the controlled-comparison pairs above. Use them for separate experiments.
