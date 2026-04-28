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

`--profile` is required and names one or more profiles from [`eforge/profiles/`](./eforge/profiles/). Comma-separated profiles run in parallel per scenario.

```bash
./run.sh --profile claude-sdk-opus todo-api-errand-health-check                  # One scenario, one profile
./run.sh --profile claude-sdk-opus,pi-opus todo-api-errand-health-check          # Same scenario, two profiles in parallel
./run.sh --profile claude-sdk-opus todo-api-errand-health-check--claude-sdk-opus # Exact expanded ID
./run.sh --profile claude-sdk-opus --all                                         # Every scenario
./run.sh --profile claude-sdk-opus --all --env-file .env                         # With extra env vars (e.g. Langfuse creds)
./run.sh --profile claude-sdk-opus --all --repeat 3                              # Run each scenario 3 times, aggregate pass rate
./run.sh --profile claude-sdk-opus --all --compare 2026-04-15T12-00-00           # Diff against a prior run
./run.sh --profile claude-sdk-opus --dry-run todo-api-errand-health-check        # Set up workspace only, skip eforge
./run.sh --profile claude-sdk-opus,pi-opus --skip-quality --all                  # Skip LLM-as-judge quality scoring (default: enabled)
./run.sh --cleanup                                                      # Remove all results
./open-monitor.sh                                                       # Open monitor UI over the shared DB
```

Scenario filters match on the base scenario ID (prefix-expanded across all selected profiles) or the fully expanded `<scenario-id>--<profile>` form.

### Profile isolation

Eval runs pin the chosen profile into the workspace at step 1 of eforge's 3-step [profile resolution chain](../eforge/packages/engine/src/config.ts) by copying the profile file into the workspace's `eforge/profiles/` and writing a project-scope `eforge/.active-profile` marker. This means eval results are **not** affected by whatever profile a developer has set in `~/.config/eforge/` (user-scope marker or profile files).

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EFORGE_BIN` | `eforge` | Path to eforge binary. Use this to test a local build (e.g. `EFORGE_BIN=~/projects/eforge/dist/cli.js`) |
| `EFORGE_MONITOR_DB` | (auto-set) | Shared SQLite DB for metrics. Set automatically by the harness. |
| `EFORGE_TRACE_TAGS` | (auto-set) | Langfuse trace tags. Set automatically per scenario. |

`--env-file` sources an additional dotenv-style file into the eforge child process (useful for Langfuse credentials or other global secrets). Per-profile secrets belong in the env-file mapping in [`profile-envs.yaml`](./profile-envs.yaml) instead.

`profile-envs.yaml` accepts a list of env files per profile (sourced in order, later files win on key collision):

```yaml
profiles:
  my-profile:
    envFiles:
      - env/primary.env
      - env/secondary.env   # keys here override primary.env
```

A single-file shorthand is also accepted: `envFile: env/my.env`.

### Pi provider auth

Pi-backed profiles authenticate in one of two ways:

- **API-key providers** (e.g. anthropic, openrouter) read credentials from environment variables. Declare a per-profile env file in [`profile-envs.yaml`](./profile-envs.yaml) if needed — see [`env/pi.env`](./env/pi.env) for the OpenRouter-style template.
- **OAuth providers** (e.g. openai-codex used by `pi-gpt`) rely on cached credentials at `~/.pi/agent/auth.json`. Run `pi login` once in your user environment before evaluating.

In profile files, provider/model live under `agents.models.<class>` (usually `max`). There is no `pi.provider` or `pi.model` key — those are not part of eforge's Pi config schema.

### Mixed-runtime profile

`mixed-opus-planner-pi-builder.yaml` exercises the `agentRuntimes` map: planning, review, and evaluation tiers run on claude-sdk + opus-4-7, while the `builder` role is offloaded to a local mlx-lm Qwen model via Pi. Run a smoke test comparing it with the single-runtime `claude-sdk-opus` baseline:

```bash
./run.sh --profile claude-sdk-opus,mixed-opus-planner-pi-builder todo-api-errand-health-check
```

Requires the local mlx-lm server to be reachable; no API key needed.

## How it works

1. Each scenario copies a fixture to a temp directory in `/tmp/` and initializes a fresh git repo.
2. The selected profile is copied into the workspace as `eforge/profiles/<name>.yaml`, and `eforge/.active-profile` is written with the profile name — pinning step 1 of eforge's profile precedence.
3. Runs `eforge run <prd> --auto --verbose --foreground --no-monitor` from the workspace.
4. Events are recorded to a shared SQLite DB (`results/monitor.db`) via `EFORGE_MONITOR_DB`.
5. Validation commands run against the workspace (type-check, tests, etc.).
6. Results are aggregated into `results/<timestamp>/summary.json`.

A monitor server starts from the eval repo root, providing a stable web UI for observing runs. Individual eforge runs use `--no-monitor` (foreground mode, writing directly to the shared DB). When multiple profiles are requested for the same scenario, they execute concurrently; scenarios themselves run sequentially.

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

## Adding profiles

Profiles describe **how to build** — harness, models, optional env file. They are plain eforge profile files living under [`eforge/profiles/`](./eforge/profiles/). Drop a new file in that directory:

```yaml
# eforge/profiles/my-profile.yaml
agentRuntimes:
  default:
    harness: pi               # or: claude-sdk
defaultAgentRuntime: default
agents:
  models:
    max:
      provider: openrouter    # provider keys are harness-specific
      id: some-model-id
```

The filename (minus `.yaml`) becomes the profile name and is used as the `<scenario-id>--<profile>` suffix on expanded scenario IDs. Profiles of the same base scenario auto-group for side-by-side comparison — no extra field required.

If the profile needs an env file (for API keys, etc.), add an entry to [`profile-envs.yaml`](./profile-envs.yaml):

```yaml
profiles:
  my-profile:
    envFiles:
      - env/my.env
```

Profiles without an entry in `profile-envs.yaml` run without a custom env file (OAuth profiles like `pi-gpt` fall into this bucket — they rely on cached credentials).

Because profile files are native eforge format, you can also copy one from your own `~/.config/eforge/profiles/` into `eval/eforge/profiles/` to measure it in the eval harness.

## Results

Results are stored in `results/<timestamp>/` (gitignored). Only the last 50 runs are kept; older runs are pruned automatically.

Per run:
- `summary.json` — aggregate metrics across all scenarios
- `analysis.json` — observations/warnings produced by `lib/analyze.ts`
- `comparison.json` — side-by-side profile comparison (written when a scenario ran with multiple profiles)

Per scenario (`<timestamp>/<scenario-id>--<profile>/`):
- `result.json` — metrics, validation results, expectations, and the profile used. By default, also contains a `quality.absolute` block (per-dimension scores + weighted overall); pass `--skip-quality` to disable.
- `eforge.log` — full eforge output
- `orchestration.yaml` — preserved plan metadata
- `validate-*.log` — per-validation-command output (one file per `validate:` step)
- `workspace-path.txt` — path to the temp workspace that was used (deleted after the run)
- `quality/` (omitted with `--skip-quality`) — `prd.md` and `diff.patch` snapshots taken before workspace cleanup, used by `compare.ts` to re-score pairwise without re-running eforge

With `--repeat N > 1`, each scenario directory additionally contains `run-1/`, `run-2/`, … with their own `result.json`; the top-level `result.json` becomes an aggregate with `passRate` and per-run pass flags.

## Quality scoring (LLM-as-judge)

Quality scoring runs by default on every eval, adding an LLM-as-judge layer on top of the correctness/cost metrics. Pass `--skip-quality` to disable it (useful when you don't have judge auth available or want to keep a run cheap).

- **Absolute** (per scenario, inline) — graded on a 4-dimension rubric (PRD adherence, code quality, test quality, change discipline) with anchored 1–5 scales. Output lands in `result.json.quality.absolute`.
- **Pairwise** (during `compare.ts`, for each scenario group with ≥2 profiles) — judges each profile pair per dimension and emits a winner/tie. A/B order is randomized per pair to mitigate position bias. Output lands in `comparison.json.groups[].dimensions.quality`.

`compare.ts` includes the quality dimension whenever any input `result.json` has populated `quality.absolute` data — re-running `npx tsx lib/compare.ts <existing-results-dir>` regenerates pairwise scores from `<scenario>/quality/{prd.md,diff.patch}` snapshots without re-running eforge. Pass `--skip-quality` to that invocation to suppress new pairwise scoring (existing absolute data is still surfaced).

Configuration lives in `judge.yaml` at the eval root:

```yaml
model: claude-opus-4-7
maxOutputTokens: 2048
weights:
  prdAdherence: 0.4
  codeQuality: 0.25
  testQuality: 0.25
  changeDiscipline: 0.1   # weights must sum to 1.0
maxDiffBytes: 80000        # diffs above this are truncated with a marker
```

Auth: judge calls go through `@anthropic-ai/claude-agent-sdk`, which inherits Claude Code's host auth (subscription if logged in) and falls back to `ANTHROPIC_API_KEY`. If neither is available, scoring logs a non-fatal warning and the eval run continues without a `quality` block — pass `--skip-quality` upfront to silence it. The judge runs with `allowedTools: []` — no file, shell, or MCP access — so it sees only the prompt + diff text passed in.
