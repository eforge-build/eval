# eforge eval

End-to-end evaluation harness for [eforge](https://github.com/eforge-build/eforge). Runs eforge against fixture projects and validates the output compiles and tests pass.

## Prerequisites

- Node.js >= 22.6.0 (for native SQLite support)
- `eforge` on PATH (or set `EFORGE_BIN`)
- `pnpm` — installs harness deps and is also invoked by fixture `validate:` steps (`pnpm install`, `pnpm type-check`, `pnpm test`)

## Setup

```bash
pnpm install
```

## Usage

`--variant` is required and names one or more entries from [`variants.yaml`](./variants.yaml). Comma-separated variants run in parallel per scenario.

```bash
./run.sh --variant claude-sdk todo-api-errand-health-check              # One scenario, one variant
./run.sh --variant claude-sdk,pi-codex todo-api-errand-health-check     # Same scenario, two variants in parallel
./run.sh --variant claude-sdk todo-api-errand-health-check--claude-sdk  # Exact expanded ID
./run.sh --variant claude-sdk --all                                     # Every scenario
./run.sh --variant claude-sdk --all --env-file .env                     # With extra env vars (e.g. Langfuse creds)
./run.sh --variant claude-sdk --all --repeat 3                          # Run each scenario 3 times, aggregate pass rate
./run.sh --variant claude-sdk --all --compare 2026-04-15T12-00-00       # Diff against a prior run
./run.sh --variant claude-sdk --dry-run todo-api-errand-health-check    # Set up workspace only, skip eforge
./run.sh --cleanup                                                      # Remove all results
./open-monitor.sh                                                       # Open monitor UI over the shared DB
```

Scenario filters match on the base scenario ID (prefix-expanded across all selected variants) or the fully expanded `<scenario-id>--<variant>` form.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EFORGE_BIN` | `eforge` | Path to eforge binary. Use this to test a local build (e.g. `EFORGE_BIN=~/projects/eforge/dist/cli.js`) |
| `EFORGE_MONITOR_DB` | (auto-set) | Shared SQLite DB for metrics. Set automatically by the harness. |
| `EFORGE_TRACE_TAGS` | (auto-set) | Langfuse trace tags. Set automatically per scenario. |

`--env-file` sources an additional dotenv-style file into the eforge child process (useful for Langfuse credentials or other global secrets). Per-variant secrets belong on the variant's `envFile` instead.

### Pi provider auth

Pi-backed variants authenticate in one of two ways:

- **API-key variants** (e.g. `pi-nemotron`, `pi-free`, `anthropic-api`) load creds from the variant's `envFile` — see [`env/pi.env`](./env/pi.env) and [`env/anthropic.env`](./env/anthropic.env).
- **OAuth variants** (e.g. `pi-codex`) rely on cached credentials at `~/.pi/agent/auth.json`. Run `pi login` once in your user environment before evaluating.

In variant configs, the provider/model live under `agents.models.<class>` (usually `max`). There is no `pi.provider` or `pi.model` key — those are not part of eforge's Pi config schema.

## How it works

1. Each scenario copies a fixture to a temp directory in `/tmp/` and initializes a fresh git repo.
2. The selected variant's `configOverlay` is merged into `eforge/config.yaml` inside the workspace.
3. Runs `eforge run <prd> --auto --verbose --foreground --no-monitor` from the workspace.
4. Events are recorded to a shared SQLite DB (`results/monitor.db`) via `EFORGE_MONITOR_DB`.
5. Validation commands run against the workspace (type-check, tests, etc.).
6. Results are aggregated into `results/<timestamp>/summary.json`.

A monitor server starts from the eval repo root, providing a stable web UI for observing runs. Individual eforge runs use `--no-monitor` (foreground mode, writing directly to the shared DB). When multiple variants are requested for the same scenario, they execute concurrently; scenarios themselves run sequentially.

## Adding scenarios

Scenarios describe **what to build**. Edit [`scenarios.yaml`](./scenarios.yaml):

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
      # skip: true             # Opt in when the PRD is expected to be already satisfied
```

Create the fixture under `fixtures/my-fixture/` with source code and the PRD file.

Expectation checks are recorded on `result.json` under `expectations.checks`. `mode` and build-stage checks are informational (judgment calls). The `skip` check is a **gating** expectation: a mismatch fails the scenario. Scenarios that set `expect.mode` or declare non-empty `validate` steps implicitly expect `skip: false`; the synthesized check is tagged `implicit: true` on `result.json` so you can tell it apart from an explicit `expect.skip`.

## Adding variants

Variants describe **how to build** — backend, model, optional env file. Edit [`variants.yaml`](./variants.yaml):

```yaml
variants:
  my-variant:
    envFile: env/my.env              # Optional: dotenv file sourced into eforge's env
    configOverlay:                    # Merged into eforge/config.yaml in the workspace
      backend: claude-sdk             # or: pi
      agents:
        models:
          max:
            provider: openrouter      # provider keys are backend-specific
            id: some-model-id
```

The map key becomes the variant name and is used as the `<scenario-id>--<variant-name>` suffix on the expanded scenario ID. Variants of the same base scenario auto-group for side-by-side comparison — no extra field required.

## Results

Results are stored in `results/<timestamp>/` (gitignored). Only the last 50 runs are kept; older runs are pruned automatically.

Per run:
- `summary.json` — aggregate metrics across all scenarios
- `analysis.json` — observations/warnings produced by `lib/analyze.ts`
- `comparison.json` — side-by-side variant comparison (written when a scenario ran with multiple variants)

Per scenario (`<timestamp>/<scenario-id>--<variant>/`):
- `result.json` — metrics, validation results, expectations, and the full variant config used
- `eforge.log` — full eforge output
- `orchestration.yaml` — preserved plan metadata
- `validate-*.log` — per-validation-command output (one file per `validate:` step)
- `workspace-path.txt` — path to the temp workspace that was used (deleted after the run)

With `--repeat N > 1`, each scenario directory additionally contains `run-1/`, `run-2/`, … with their own `result.json`; the top-level `result.json` becomes an aggregate with `passRate` and per-run pass flags.
