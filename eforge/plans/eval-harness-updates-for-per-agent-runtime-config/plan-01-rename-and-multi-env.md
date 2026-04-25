---
id: plan-01-rename-and-multi-env
name: Rename backend → profile, add envFiles list, add mixed-runtime profile
depends_on: []
branch: eval-harness-updates-for-per-agent-runtime-config/rename-and-multi-env
---

# Rename backend → profile, add envFiles list, add mixed-runtime profile

## Architecture Context

The eforge engine has been migrated to per-agent runtime configuration. The relevant engine-side renames have already shipped:

- `eforge/backends/` → `eforge/profiles/` (engine auto-migrates on load).
- `eforge/.active-backend` → `eforge/.active-profile`.
- Top-level scalar `backend:` in profile/config files → `agentRuntimes:` map plus required `defaultAgentRuntime:` (engine rejects legacy `backend:` with a migration error pointing to the new shape).
- Per-runtime kind is now declared via `harness:` (`claude-sdk` | `pi`).
- Per-role override field is `agents.roles.<role>.agentRuntime`.
- Monitor event `plan:profile` already exposes `profileName` (already consumed by `lib/build-result.ts`).

The eval harness at `/Users/markschaake/projects/eforge-build/eval-…/__merge__/` still uses the old vocabulary in source code (`BackendDef`, `loadBackends`, `pinBackendProfile`, `--backend`, `BACKENDS_DIR`, `.active-backend`), in the env-mapping file (`backend-envs.yaml` with `backends:` root and a single `envFile:` per entry), in the result schema (`result.json` field `backend: { name, profile, envFile }`), in the MCP server (`eval_backends` tool), and across docs (`README.md`, `CLAUDE.md`, `eforge/backends/README.md`). Every existing profile file under `eforge/backends/*.yaml` still uses the legacy `backend: claude-sdk` / `backend: pi` scalar that the new engine refuses to load.

This plan completes the eval-side rename in one cohesive change so the harness loads cleanly against the new engine, supports a mixed-runtime profile that exercises the new agentRuntimes capability, and supports multiple env files per profile so a profile that mixes runtimes (e.g. Anthropic for the planner + OpenRouter for the builder) can source credentials for both services.

## Implementation

### Overview

1. Rename TypeScript types, function names, CLI flags, and constants from `backend` → `profile` across `lib/`, `mcp-server/`, and `run.sh` help text.
2. Rename the `backend: { name, profile, envFile }` field on `result.json` to `profile: { name, config, envFile }`. The inner key changes from `profile` → `config` so the outer key can become `profile` without colliding. `envFile` becomes `envFiles: string[]`. Drop the legacy `variant` fallback in `lib/compare.ts` (PRD: no backward compatibility).
3. `git mv eforge/backends → eforge/profiles` and `git mv backend-envs.yaml → profile-envs.yaml`.
4. Rewrite `profile-envs.yaml` to the new shape with a `profiles:` root key and an `envFiles: []` list per entry. Keep `envFile: <single>` parsed as sugar for `envFiles: [<single>]` (decision: keep for minimal churn on existing entries — explicitly noted in scope).
5. Update `lib/runner.ts` to source every entry in `envFiles` in list order before spawning eforge, accumulating into `envOverrides` so later files win on key collision.
6. Update every existing profile YAML under `eforge/profiles/` to the new agentRuntimes shape: replace the top-level `backend: <name>` scalar with an `agentRuntimes:` map containing one entry whose `harness:` is the old backend kind, plus `defaultAgentRuntime:` pointing at that entry. Preserve all other fields verbatim (effort, models, claudeSdk overrides, etc.).
7. Add `eforge/profiles/mixed-opus-planner-pi-builder.yaml` exercising two named runtimes (Claude SDK Opus for the planner, Pi+OpenRouter for the builder) per the PRD.
8. Update `mcp-server/index.ts`: rename the `eval_backends` MCP tool → `eval_profiles`, the `backend` param on `eval_run` → `profile`, the constants and the description strings.
9. Update docs (`README.md`, `CLAUDE.md`, and the renamed `eforge/profiles/README.md`) to use the new names, the new flag, the new yaml shape (both for profile files and for `profile-envs.yaml`), the new active-profile marker, and to mention the new mixed-runtime profile.

No behavioral change to grouping: `deriveGroupId()` still keys on `scenario.id` (per scope: "stays the same"). No agentRuntime-level telemetry in `compare.ts` (out of scope).

The new mixed-runtime profile is added to the `eforge/profiles/` directory and is therefore part of the auto-discovered profile set; it can be selected via `--profile mixed-opus-planner-pi-builder` but is not invoked unless explicitly requested. Whether it joins the default `--all` set is left to PR review (PRD open decision); this plan does NOT change `--all` semantics — `--all` still cross-products every scenario with every selected profile, and no scenario list filtering changes.

### Key Decisions

1. **Inner field rename `profile` → `config` on `result.json`.** The outer `backend` field already nests an inner `profile` key (the parsed YAML). To rename outer to `profile` without collision, the inner is renamed to `config`. This is consistent with the PRD's terminology table (`profile: { name, config, envFile }`).
2. **`envFile: <single>` sugar kept.** PRD scope explicitly opts in. Implemented in the loader by normalising both shapes to `envFiles: string[]` immediately after parse so downstream code only deals with the list form.
3. **`envFiles` order = sourcing order.** Files later in the list override earlier files on key collision. This matches POSIX shell `source` semantics and is the least surprising behavior for a list.
4. **Drop legacy `variant` fallback in compare.ts.** PRD says no backward alias; existing `results/` is gitignored and contains no checked-in artifacts, so there is nothing in-repo that depends on the legacy field name.
5. **No new `hello-world` scenario.** PRD says the smoke-test scenario can be a reused fast one; `todo-api-errand-health-check` already exists and is the cheapest existing scenario. No `scenarios.yaml` changes required to satisfy the smoke-test acceptance criterion — operators run `./run.sh --profile opus-only,mixed-opus-planner-pi-builder todo-api-errand-health-check`.
6. **`opus-only` profile.** The PRD's acceptance criteria reference a profile literally named `opus-only`. The closest existing profile is `claude-sdk-4-7.yaml` (claude-sdk + opus-4-7). Add a new lightweight `opus-only.yaml` profile dedicated to the smoke test rather than renaming the existing controlled-comparison file (which other analyses still cite). It uses the new agentRuntimes shape with a single `claude-sdk` runtime and `claude-opus-4-7` as `max`.
7. **No engine-side dependency.** Engine has already shipped the renames and provides auto-migration of `eforge/backends/` → `eforge/profiles/`; the eval harness's own `eforge/profiles/` directory is the source of truth here, and the runner copies files from it into each workspace.

## Scope

### In Scope

- Mechanical terminology rename across `run.sh`, `lib/scenarios.ts`, `lib/runner.ts`, `lib/types.ts`, `lib/build-result.ts`, `lib/compare.ts`, `lib/check-expectations.ts` (only the comment/var names that reference "backend"), `mcp-server/index.ts`, `README.md`, `CLAUDE.md`, and the renamed `eforge/profiles/README.md`.
- `result.json` schema field rename: `backend: { name, profile, envFile }` → `profile: { name, config, envFiles }`.
- `profile-envs.yaml` shape: top-level `profiles:` with per-entry `envFiles: string[]`, and `envFile: <single>` sugar normalised to a single-element list.
- `git mv eforge/backends/ eforge/profiles/` (16 yaml files + `README.md`) and `git mv backend-envs.yaml profile-envs.yaml`.
- Update each migrated profile YAML's contents to use `agentRuntimes:` + `defaultAgentRuntime:` + `harness:` instead of the top-level `backend:` scalar. Preserve all other fields.
- Add `eforge/profiles/mixed-opus-planner-pi-builder.yaml`.
- Add `eforge/profiles/opus-only.yaml`.
- Update `mcp-server/index.ts`: rename `eval_backends` → `eval_profiles`, rename `backend` param on `eval_run` → `profile`, update descriptions and constants (`BACKENDS_DIR` → `PROFILES_DIR`, `BACKEND_ENVS_FILE` → `PROFILE_ENVS_FILE`).
- Source every file in `envFiles` in list order before spawning eforge in `lib/runner.ts`.
- Drop the legacy `variant` fallback in `lib/compare.ts`.

### Out of Scope

- agentRuntime-level telemetry/diff in `compare.ts` (PRD: out of scope).
- Adding a programmatic eval runner (PRD: CLI-spawn approach preserved).
- Changes to `deriveGroupId()` beyond keying on `scenario.id` (PRD: stays the same).
- New scenarios in `scenarios.yaml` (reuse `todo-api-errand-health-check` as the smoke target).
- Tests for the harness itself: there is no existing test suite (`package.json` exposes only `type-check` and `mcp-server`). Validation relies on `pnpm type-check` plus end-to-end smoke verification via the acceptance criteria.
- Rewriting historical analyses under `analyses/` (they are narrative reports, not programmatic field consumers; grep confirms they only reference "backend" as prose).
- Updating eval result artifacts under `results/` (gitignored, regenerated on each run).

## Files

### Create

- `eforge/profiles/mixed-opus-planner-pi-builder.yaml` — new mixed-runtime profile with two named runtimes: `opus` (claude-sdk, model `claude-opus-4-7` as `max`) and `pi-openrouter` (pi harness, `pi.apiKey: env:OPENROUTER_API_KEY`). `defaultAgentRuntime: opus`. `agents.roles.builder.agentRuntime: pi-openrouter` with `model: { provider: openrouter, id: qwen/qwen3-coder }`. `agents.models.max.id: claude-opus-4-7`, `agents.models.balanced.id: claude-sonnet-4-6`. Mirrors the PRD example.
- `eforge/profiles/opus-only.yaml` — single-runtime profile pinned to claude-sdk + opus-4-7 (mirror of existing `claude-sdk-4-7.yaml` content but in the new agentRuntimes shape; keeps `effort: high` for parity with controlled comparisons).

### Rename (git mv) and modify

- `eforge/backends/` → `eforge/profiles/` (directory rename, includes all 16 yaml files + `README.md`).
- `backend-envs.yaml` → `profile-envs.yaml` (shape change: top-level `profiles:` instead of `backends:`, per-entry `envFiles: [path, ...]` with `envFile: <single>` accepted as sugar; preserve all existing entries' file paths).
- For every yaml under the renamed `eforge/profiles/` (16 files: `claude-sdk-4-6{,-no-subagents}.yaml`, `claude-sdk-4-7{,-no-subagents}.yaml`, `claude-sdk-balanced{,-no-subagents}.yaml`, `pi-anthropic-4-6.yaml`, `pi-anthropic-4-7.yaml`, `pi-codex-5-4.yaml`, `pi-codex-5-5.yaml`, `pi-free.yaml`, `pi-gemma4.yaml`, `pi-glm.yaml`, `pi-kimi-k-2-6.yaml`, `pi-local-qwen-3-6-35B-A3B.yaml`, `pi-nemotron.yaml`): replace the top-level `backend: <kind>` scalar with `agentRuntimes: { default: { harness: <kind>, ...kind-specific config like claudeSdk:/pi: blocks if present } }` and `defaultAgentRuntime: default`. Move any existing top-level `claudeSdk:` or `pi:` block under the appropriate runtime entry. Preserve all other fields verbatim (including `agents.effort`, `agents.models.*`).
- `eforge/profiles/README.md` — rewrite "Backend profiles" → "Profiles", `--backend` → `--profile`, columns, env-file mapping references; add a short note describing the new `mixed-opus-planner-pi-builder.yaml` and `opus-only.yaml` profiles in their own section.

### Modify (no rename)

- `lib/types.ts` — rename `BackendDef` → `ProfileDef` (with `name: string; envFiles?: string[]`); rename `ExpandedScenario.backend` → `.profile` and its type to `ProfileDef`; on `ScenarioResult`, rename optional `backend?: { name; profile; envFile? }` → `profile?: { name: string; config: Record<string, unknown>; envFiles?: string[] }`. Update `id` example comment in `ExpandedScenario` to reflect `--profile` axis.
- `lib/scenarios.ts` — rename `loadBackends` → `loadProfiles` and its parameters (`backendsDir` → `profilesDir`, `envsFile` unchanged shape but reads `profiles:` root and accepts both `envFile:` and `envFiles:`, normalising to `envFiles: string[]`); rename `expandScenarioBackends` → `expandScenarioProfiles`; update returned object key from `backend` to `profile`; comment header references updated.
- `lib/runner.ts` — rename `BACKENDS_DIR` → `PROFILES_DIR` (`join(SCRIPT_DIR, 'eforge', 'profiles')`); rename `BACKEND_ENVS_FILE` → `PROFILE_ENVS_FILE` (`join(SCRIPT_DIR, 'profile-envs.yaml')`); rename CLI flag `--backend`/`--backends` → `--profile`/`--profiles`; rename `args.backendNames` → `args.profileNames`; rename `pinBackendProfile` → `pinActiveProfile` (writes `eforge/.active-profile` instead of `.active-backend`, copies the profile file into `workspace/eforge/profiles/`); rename `readBackendProfile` → `readProfile`; update grouping log lines (`backends` → `profiles`); update `printHelp()` text; update result.json wiring to use the new `profile: { name, config, envFiles }` field; in the env-sourcing block, iterate over `profile.envFiles ?? []` resolving each path against `SCRIPT_DIR` and merging into `envOverrides` in list order so later files override earlier ones; surface a clear error if any listed file is missing (preserve existing behavior of failing the scenario rather than silently skipping).
- `lib/build-result.ts` — rename the `BuildResultOpts.backend` option to `profile` with shape `{ name: string; config: Record<string, unknown>; envFiles?: string[] }`; update the `result` object spread to set `profile` instead of `backend`.
- `lib/check-expectations.ts` — comment-only updates where the prose mentions "backend" (no behavioral change); still reads run IDs by workspace cwd.
- `lib/compare.ts` — rename internal types/variables: `BackendValue` → `ProfileValue`, `BackendEntry` → `ProfileEntry`, `backendsWithMetrics` → `profilesWithMetrics`, the dimension fields (`bestBackend`/`worstBackend` → `bestProfile`/`worstProfile`, `noData` unchanged), grouping `backends:` → `profiles:` on `ComparisonGroup`/`AgentBreakdownComparison`/`ReviewQualityComparison`/`ToolUsageComparison`, etc.; in `resultLabel` drop the `variant` legacy fallback and read only `result.profile?.name`; update `groupByScenario` to use `profile` field; update the table printer headings (`Backend Comparison` → `Profile Comparison`, `Backends:` → `Profiles:`).
- `mcp-server/index.ts` — rename constants `BACKENDS_DIR` → `PROFILES_DIR` (`'eforge/profiles'`), `BACKEND_ENVS_FILE` → `PROFILE_ENVS_FILE` (`'profile-envs.yaml'`); change import from `loadBackends` to `loadProfiles`; rename the `eval_backends` server.tool registration → `eval_profiles` with description "List available profiles from eforge/profiles/ (merged with profile-envs.yaml for env-file mappings)." returning `{ name, envFiles }` per entry; on `eval_run`, rename `backend` zod input → `profile` and the spawn arg `--backend` → `--profile`.
- `run.sh` — no actual code change required (it's `exec npx tsx "$SCRIPT_DIR/lib/runner.ts" "$@"`); confirm and leave as-is.
- `README.md` — full rewrite of the usage block, examples, headings, and the env-vars/auth section to use `--profile`, `eforge/profiles/`, `profile-envs.yaml`, `eforge/.active-profile`, `eval_profiles`, and the new `envFiles: []` shape (with one-line note that `envFile: <single>` still works as sugar). Add a short "Mixed-runtime profile" subsection describing `mixed-opus-planner-pi-builder.yaml` and the smoke-test command from the acceptance criteria.
- `CLAUDE.md` — same renames as `README.md`, scoped to the architecture/data-flow descriptions.

## Verification

- [ ] `pnpm type-check` exits 0 from the eval root.
- [ ] `git ls-files eforge/backends` is empty; `git ls-files eforge/profiles` lists 18 yaml files (16 migrated + `mixed-opus-planner-pi-builder.yaml` + `opus-only.yaml`) plus `README.md`.
- [ ] `git ls-files | grep -E '^backend-envs.yaml$'` returns nothing; `git ls-files | grep -E '^profile-envs.yaml$'` returns the file.
- [ ] `grep -RIn --include='*.ts' --include='*.sh' --include='*.md' --include='*.yaml' -E '\b(backend|backends|--backend|BACKENDS_DIR|BACKEND_ENVS_FILE|\.active-backend|loadBackends|expandScenarioBackends|pinBackendProfile|BackendDef|eval_backends)\b' lib/ mcp-server/ run.sh README.md CLAUDE.md eforge/profiles/ scenarios.yaml profile-envs.yaml package.json` returns no matches (excluding any path containing `/results/` or `/analyses/`, which are out of scope per the in-scope list).
- [ ] Every yaml file under `eforge/profiles/` parses with `yaml` and contains exactly one top-level `agentRuntimes:` key plus a `defaultAgentRuntime:` whose value is a key in `agentRuntimes`. None contains a top-level `backend:` key.
- [ ] `profile-envs.yaml` has a top-level `profiles:` key (no `backends:` key); each entry has either `envFiles: [string, ...]` or `envFile: string` and no other fields.
- [ ] `./run.sh --help` prints `--profile` (not `--backend`) and references `eforge/profiles/` and `profile-envs.yaml`.
- [ ] `./run.sh --profile opus-only,mixed-opus-planner-pi-builder todo-api-errand-health-check` writes two `result.json` files under `results/<timestamp>/`. Each result has a top-level `profile.name` matching the requested profile and a `profile.config` containing the parsed yaml (verified by `node -e 'JSON.parse(require("fs").readFileSync(process.argv[1])).profile.name'`).
- [ ] In the mixed-runtime run's `eforge.log` (or monitor DB events), `agent:start` events emitted for the planner role record `agentRuntime: "opus"` and `harness: "claude-sdk"`, and the builder role records `agentRuntime: "pi-openrouter"` and `harness: "pi"` (the engine emits these fields on `agent:start` since the per-agent-runtime work landed).
- [ ] When the mixed-runtime run completes, `results/<timestamp>/comparison.json` exists with two profile entries (`opus-only` and `mixed-opus-planner-pi-builder`), and `mcp-server`'s `eval_compare` tool returns it without error.
- [ ] The `eval_profiles` MCP tool (registered in `mcp-server/index.ts`) returns each profile with `{ name, envFiles }` (a list, possibly empty).
- [ ] Sourcing order: a `profile-envs.yaml` entry with `envFiles: [a.env, b.env]` results in keys from `b.env` overriding `a.env` in `envOverrides` passed to the eforge child process (verified by adding two temp env files locally and inspecting `process.env` inside a `--dry-run` check, or by reading the runner's merge logic).
- [ ] `--dry-run` with the new `--profile` flag prints the expanded matrix (one row per scenario × profile) without spawning eforge.
