# eforge eval

End-to-end evaluation harness for [eforge](https://github.com/eforge-build/eforge). Runs eforge against fixture projects and validates the output compiles and tests pass.

## Prerequisites

- Node.js >= 22.6.0 (for native SQLite support)
- `eforge` on PATH (or set `EFORGE_BIN`)
- `pnpm` (for dependency installation)

## Setup

```bash
pnpm install
```

## Usage

```bash
./run.sh todo-api-errand-health-check                          # Run all variants (prefix match)
./run.sh todo-api-errand-health-check --variants claude-sdk,pi-codex  # Only these variants
./run.sh todo-api-errand-health-check--claude-sdk              # One specific variant
./run.sh --all                                                 # Run every scenario
./run.sh --all --variants claude-sdk                           # All scenarios, claude-sdk only
./run.sh --all --env-file .env                                 # Run all with env vars
./run.sh --dry-run todo-api-errand-health-check                # Set up workspace only
./run.sh --cleanup                                             # Remove all results
./open-monitor.sh                                              # Open monitor UI
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EFORGE_BIN` | `eforge` | Path to eforge binary. Use this to test a local build (e.g. `EFORGE_BIN=~/projects/eforge/dist/cli.js`) |
| `EFORGE_MONITOR_DB` | (auto-set) | Shared SQLite DB for metrics. Set automatically by the harness. |
| `EFORGE_TRACE_TAGS` | (auto-set) | Langfuse trace tags. Set automatically per scenario. |

### Pi provider auth

Pi-backed scenarios can authenticate in two ways:

- API key env vars via a scenario `envFile` such as [`env/pi.env`](./env/pi.env)
- OAuth or cached credentials from `~/.pi/agent/auth.json`

This repo now includes Pi scenarios for both:

- OpenRouter API-key-based Pi runs
- OpenAI Codex OAuth runs using `pi.provider: openai-codex` and `agents.models.max: gpt-5.4`

If you are testing Codex through Pi, make sure you have already logged in with Pi in your user environment before running the evals.

## How it works

1. Each scenario copies a fixture to a temp directory in `/tmp/` and initializes a fresh git repo
2. Runs `eforge run <prd> --auto --verbose --foreground --no-monitor` from the temp workspace
3. Events are recorded to a shared SQLite DB (`results/monitor.db`) via `EFORGE_MONITOR_DB`
4. Validation commands run against the workspace (type-check, tests, etc.)
5. Results are aggregated into `results/<timestamp>/summary.json`

A monitor server starts from the eval repo root, providing a stable web UI for observing runs. Individual eforge runs use `--no-monitor` (foreground mode, writing directly to the shared DB).

## Adding scenarios

Edit `scenarios.yaml`:

```yaml
scenarios:
  - id: my-scenario
    fixture: my-fixture        # Directory under fixtures/
    prd: docs/my-prd.md        # PRD path within the fixture
    description: "What this tests"
    validate:
      - pnpm install
      - pnpm type-check
      - pnpm test
    expect:                    # Optional
      mode: errand
      buildStagesContain: [implement]
```

Create the fixture under `fixtures/my-fixture/` with source code and the PRD file.

### Variant matrix

To compare the same scenario across different configs, use a `matrix` instead of duplicating the full scenario:

```yaml
scenarios:
  - id: my-scenario
    fixture: my-fixture
    prd: docs/my-prd.md
    validate: [pnpm install, pnpm type-check, pnpm test]
    expect:
      mode: excursion
    matrix:
      - variantLabel: claude-sdk
        configOverlay:
          backend: claude-sdk
      - variantLabel: pi-nemotron
        envFile: env/pi.env
        configOverlay:
          backend: pi
          agents:
            models:
              max: { provider: openrouter, id: nvidia/nemotron-3-super-120b-a12b:free }
```

Each matrix entry expands into a full scenario with ID `<base-id>--<variantLabel>`. Variants share a `compareGroup` for side-by-side comparison. Per-variant `envFile`, `expect`, and `validate` overrides are supported.

For Pi scenarios, configure the provider under `pi.provider` and the model under `agents.model` or `agents.models.*`. Do not use `pi.model`; that is no longer part of eforge's Pi config schema.

## Results

Results are stored in `results/<timestamp>/` (gitignored) with:
- `summary.json` - aggregate metrics across all scenarios
- `<scenario>/result.json` - per-scenario metrics, validation, expectations
- `<scenario>/eforge.log` - full eforge output
- `<scenario>/orchestration.yaml` - preserved plan metadata
