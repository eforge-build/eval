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

`--backend` is required and names one or more backend profiles from [`eforge/backends/`](./eforge/backends/). Comma-separated backends run in parallel per scenario.

```bash
./run.sh --backend claude-sdk todo-api-errand-health-check              # One scenario, one backend
./run.sh --backend claude-sdk,pi-codex todo-api-errand-health-check     # Same scenario, two backends in parallel
./run.sh --backend claude-sdk todo-api-errand-health-check--claude-sdk  # Exact expanded ID
./run.sh --backend claude-sdk --all                                     # Every scenario
./run.sh --backend claude-sdk --all --env-file .env                     # With extra env vars (e.g. Langfuse creds)
./run.sh --backend claude-sdk --all --repeat 3                          # Run each scenario 3 times, aggregate pass rate
./run.sh --backend claude-sdk --all --compare 2026-04-15T12-00-00       # Diff against a prior run
./run.sh --backend claude-sdk --dry-run todo-api-errand-health-check    # Set up workspace only, skip eforge
./run.sh --cleanup                                                      # Remove all results
./open-monitor.sh                                                       # Open monitor UI over the shared DB
```

Scenario filters match on the base scenario ID (prefix-expanded across all selected backends) or the fully expanded `<scenario-id>--<backend>` form.

### Backend isolation

Eval runs pin the chosen backend profile into the workspace at step 1 of eforge's 5-step [profile resolution chain](../eforge/packages/engine/src/config.ts) by copying the profile file into the workspace's `eforge/backends/` and writing a project-scope `eforge/.active-backend` marker. This means eval results are **not** affected by whatever backend a developer has set in `~/.config/eforge/` (user-scope marker or config).

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EFORGE_BIN` | `eforge` | Path to eforge binary. Use this to test a local build (e.g. `EFORGE_BIN=~/projects/eforge/dist/cli.js`) |
| `EFORGE_MONITOR_DB` | (auto-set) | Shared SQLite DB for metrics. Set automatically by the harness. |
| `EFORGE_TRACE_TAGS` | (auto-set) | Langfuse trace tags. Set automatically per scenario. |

`--env-file` sources an additional dotenv-style file into the eforge child process (useful for Langfuse credentials or other global secrets). Per-backend secrets belong in the env-file mapping in [`backend-envs.yaml`](./backend-envs.yaml) instead.

### Pi provider auth

Pi-backed backends authenticate in one of two ways:

- **API-key backends** (e.g. `pi-nemotron`, `pi-free`, `anthropic-api`) load creds from the env file declared in [`backend-envs.yaml`](./backend-envs.yaml) — see [`env/pi.env`](./env/pi.env) and [`env/anthropic.env`](./env/anthropic.env).
- **OAuth backends** (e.g. `pi-codex`) rely on cached credentials at `~/.pi/agent/auth.json`. Run `pi login` once in your user environment before evaluating.

In backend profiles, provider/model live under `agents.models.<class>` (usually `max`). There is no `pi.provider` or `pi.model` key — those are not part of eforge's Pi config schema.

## How it works

1. Each scenario copies a fixture to a temp directory in `/tmp/` and initializes a fresh git repo.
2. The selected backend profile is copied into the workspace as `eforge/backends/<name>.yaml`, and `eforge/.active-backend` is written with the backend name — pinning step 1 of eforge's profile precedence.
3. Runs `eforge run <prd> --auto --verbose --foreground --no-monitor` from the workspace.
4. Events are recorded to a shared SQLite DB (`results/monitor.db`) via `EFORGE_MONITOR_DB`.
5. Validation commands run against the workspace (type-check, tests, etc.).
6. Results are aggregated into `results/<timestamp>/summary.json`.

A monitor server starts from the eval repo root, providing a stable web UI for observing runs. Individual eforge runs use `--no-monitor` (foreground mode, writing directly to the shared DB). When multiple backends are requested for the same scenario, they execute concurrently; scenarios themselves run sequentially.

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

## Adding backends

Backends describe **how to build** — backend kind, models, optional env file. They are plain eforge [backend profile](../eforge/packages/engine/src/config.ts) files living under [`eforge/backends/`](./eforge/backends/). Drop a new file in that directory:

```yaml
# eforge/backends/my-backend.yaml
backend: pi                       # or: claude-sdk
agents:
  models:
    max:
      provider: openrouter        # provider keys are backend-specific
      id: some-model-id
```

The filename (minus `.yaml`) becomes the backend name and is used as the `<scenario-id>--<backend>` suffix on expanded scenario IDs. Backends of the same base scenario auto-group for side-by-side comparison — no extra field required.

If the backend needs an env file (for API keys, etc.), add an entry to [`backend-envs.yaml`](./backend-envs.yaml):

```yaml
backends:
  my-backend:
    envFile: env/my.env
```

Backends without an entry in `backend-envs.yaml` run without a custom env file (OAuth backends like `pi-codex` fall into this bucket — they rely on cached credentials).

Because backend profiles are native eforge format, you can also copy one from your own `~/.config/eforge/backends/` into `eval/eforge/backends/` to measure it in the eval harness.

## Results

Results are stored in `results/<timestamp>/` (gitignored). Only the last 50 runs are kept; older runs are pruned automatically.

Per run:
- `summary.json` — aggregate metrics across all scenarios
- `analysis.json` — observations/warnings produced by `lib/analyze.ts`
- `comparison.json` — side-by-side backend comparison (written when a scenario ran with multiple backends)

Per scenario (`<timestamp>/<scenario-id>--<backend>/`):
- `result.json` — metrics, validation results, expectations, and the backend profile used
- `eforge.log` — full eforge output
- `orchestration.yaml` — preserved plan metadata
- `validate-*.log` — per-validation-command output (one file per `validate:` step)
- `workspace-path.txt` — path to the temp workspace that was used (deleted after the run)

With `--repeat N > 1`, each scenario directory additionally contains `run-1/`, `run-2/`, … with their own `result.json`; the top-level `result.json` becomes an aggregate with `passRate` and per-run pass flags.
