---
title: Eval Harness Updates for Per-Agent Runtime Config
created: 2026-04-25
---

# Eval Harness Updates for Per-Agent Runtime Config

## Problem / Motivation

The main per-agent runtime configuration work (tracked in the eforge repo) renames `backend` → `harness`, replaces the scalar `backend:` config field with a named-entry `agentRuntimes:` map, and renames the profile system (`eforge/backends/` → `eforge/profiles/`, `.active-backend` → `.active-profile`, MCP tool `eforge_backend` → `eforge_profile`, slash commands likewise).

The eval harness at `/Users/markschaake/projects/eforge-build/eval/` already treats each "backend" as a full `PartialEforgeConfig` fragment (see `eval/lib/scenarios.ts:29-49`, `eval/lib/runner.ts:308-318`), so the conceptual model survives. However, paperwork renames, an API-key-mapping tweak, and a smoke test of the new mixed-runtime capability are still required.

This work lands **after** the main engine PRD merges and a release containing the renames is available.

## Goal

Update the eval harness to align with the engine's renamed profile/runtime terminology, support multiple env files per profile, and validate the new mixed-runtime capability via a smoke test.

## Approach

Follow-on PRD to the main per-agent runtime configuration work in the eforge repo. The changes are:

1. **Mechanical terminology rename** across files, flags, types, and result schema.
2. **Profile-envs mapping shape change** to support multiple env files per profile, with single-file sugar for backward minimal churn.
3. **Add a mixed-runtime profile** that exercises the new capability and verify it via the existing smoke test machinery.
4. **Update eval MCP tools** to surface "profile" instead of "backend" concepts.

### 1. Terminology rename (mechanical)

| Old | New |
| --- | --- |
| `eval/eforge/backends/*.yaml` (dir) | `eval/eforge/profiles/*.yaml` |
| `eval/backend-envs.yaml` | `eval/profile-envs.yaml` |
| `./run.sh --backend A,B,C` | `./run.sh --profile A,B,C` |
| `result.json` field `backend: { name, profile, envFile }` | `profile: { name, config, envFile }` |
| Internal `BackendDef`, `loadBackends`, `expandScenarioBackends`, `pinBackendProfile` | `ProfileDef`, `loadProfiles`, `expandScenarioProfiles`, `pinActiveProfile` |
| `--backend` axis in CLI help + README | `--profile` |

Files touched:
- `eval/run.sh` — flag parsing, help text.
- `eval/lib/scenarios.ts` — `loadBackends()` L29-49, `expandScenarioBackends()` L55-66, exported types.
- `eval/lib/runner.ts` — `pinBackendProfile()` L308-318, `deriveGroupId()` L248, result.json writer L540-556.
- `eval/lib/compare.ts` — reads `result.json`; follow renamed field.
- `eval/README.md`, `eval/CLAUDE.md` — docs.
- `eval/mcp-server/` — if the MCP server references these fields, update tool schemas.

### 2. Profile-envs mapping: support multiple env files per profile

Today `eval/backend-envs.yaml` maps one backend name → one env file. A mixed-runtime profile (e.g. planner on Claude + builder on Pi) may need credentials for both services. Change the mapping shape:

```yaml
# profile-envs.yaml
profiles:
  opus-only:
    envFiles: [env/anthropic.env]
  mixed-opus-pi-openrouter:
    envFiles: [env/anthropic.env, env/openrouter.env]
  pi-nemotron:
    envFiles: [env/pi-nemotron.env]
```

`envFile: <single>` is kept as sugar for `envFiles: [<single>]` to minimize churn on existing entries.

`eval/lib/runner.ts` L491-507 updated to source each file in list order before spawning eforge.

### 3. Mixed-runtime smoke test

Add one new profile to `eval/eforge/profiles/` that exercises the new capability:

```yaml
# eval/eforge/profiles/mixed-opus-planner-pi-builder.yaml
agentRuntimes:
  opus:
    harness: claude-sdk
  pi-openrouter:
    harness: pi
    pi:
      apiKey: env:OPENROUTER_API_KEY

defaultAgentRuntime: opus

agents:
  models:
    max:      { id: claude-opus-4-7 }
    balanced: { id: claude-sonnet-4-6 }
  roles:
    builder:
      agentRuntime: pi-openrouter
      model: { provider: openrouter, id: qwen/qwen3-coder }
```

Add a minimal scenario (or reuse a fast one like `hello-world`) to the smoke set. Verify:
- `agent:start` events show `agentRuntime: opus, harness: claude-sdk` for the planner and `agentRuntime: pi-openrouter, harness: pi` for the builder.
- `result.json` records the full profile bundle in `profile.config`.
- `eval_compare` over two profiles (all-Opus vs. mixed) produces a side-by-side diff.

### 4. Update eval MCP tools

`packages/eval-mcp` (if it surfaces backend concepts): rename `eval_backends` MCP tool → `eval_profiles`. Update tool descriptions that mention "backend" to say "profile".

Check: `mcp__eval__eval_backends`, `eval_compare`, `eval_results` — which accept or return backend-related fields. Adjust their Zod schemas + tool impl.

### Migration

- One-shot rename commit in the eval repo; no backward alias for the old `--backend` flag (consistent with the engine's no-compat stance).
- Existing `eval/eforge/backends/*.yaml` files `git mv`'d to `eval/eforge/profiles/` — contents updated by hand to use `agentRuntimes:` + `defaultAgentRuntime:` (the inner shape changes per the engine PRD).
- `eval/backend-envs.yaml` → `eval/profile-envs.yaml` via `git mv`; shape updated to `profiles:` root + `envFiles: []`.
- Update any saved eval result artifacts under `eval/results/` that are referenced by ongoing analyses — the `backend` → `profile` field rename will break field lookups in analysis scripts.

### Open decisions (defer to PR review)

- Whether `envFile: <single>` sugar stays or we force the list form everywhere.
- Whether the mixed-runtime smoke test is part of the default `./run.sh --all` set or opt-in.

## Scope

### In scope

- Mechanical terminology rename (files, flags, types, result.json schema, docs).
- Profile-envs mapping shape change to support multiple env files per profile, with `envFile: <single>` sugar.
- Sourcing each env file in list order before spawning eforge in `eval/lib/runner.ts` L491-507.
- New mixed-runtime profile `eval/eforge/profiles/mixed-opus-planner-pi-builder.yaml` and adding it (or a reused fast scenario like `hello-world`) to the smoke set.
- Updating eval MCP tools (`eval_backends` → `eval_profiles`, descriptions, Zod schemas, tool impl for `eval_compare`, `eval_results`).
- Updating any saved eval result artifacts under `eval/results/` referenced by ongoing analyses for the `backend` → `profile` field rename.

### Out of scope

- Adding agentRuntime-level telemetry to `compare.ts` (e.g. diff by agentRuntime name within a scenario). The existing per-scenario cost/duration/pass comparison is enough for phase 1; richer per-agentRuntime drilldown can follow if needed.
- Changing `deriveGroupId()` beyond keying on `scenario.id` — stays the same.
- Programmatic eval runner (current CLI-spawn approach preserved).

## Acceptance Criteria

- `./run.sh --profile opus-only,mixed-opus-planner-pi-builder --scenario hello-world` produces two `result.json` files, both valid, with expected per-agent `agentRuntime` + `harness` fields.
- `agent:start` events show `agentRuntime: opus, harness: claude-sdk` for the planner and `agentRuntime: pi-openrouter, harness: pi` for the builder when running the mixed-runtime profile.
- `result.json` records the full profile bundle in `profile.config`.
- `eval_compare` MCP tool consumes both outputs cleanly and produces a side-by-side diff over two profiles (all-Opus vs. mixed).
- Existing eval analyses under `eval/analyses/` still load (any hard-coded field lookups updated for the renamed `profile` field).
- Dry-run: `--dry-run` (if supported) lists the expanded matrix correctly under the new flag name.
- All renames listed in the terminology table are applied across `eval/run.sh`, `eval/lib/scenarios.ts`, `eval/lib/runner.ts`, `eval/lib/compare.ts`, `eval/README.md`, `eval/CLAUDE.md`, and `eval/mcp-server/` (where applicable).
- `eval/profile-envs.yaml` supports `envFiles: []` lists and the `envFile: <single>` sugar form, with all listed files sourced in order before eforge is spawned.
- `git mv` is used for `eval/eforge/backends/` → `eval/eforge/profiles/` and `eval/backend-envs.yaml` → `eval/profile-envs.yaml`; no backward alias is provided for the old `--backend` flag.
