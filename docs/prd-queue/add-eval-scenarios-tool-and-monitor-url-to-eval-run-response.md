---
title: Add `eval_scenarios` Tool and Monitor URL to `eval_run` Response
created: 2026-03-28
status: pending
---



# Add `eval_scenarios` Tool and Monitor URL to `eval_run` Response

## Problem / Motivation

The MCP server (`mcp-server/index.ts`, implemented in commit `c323ea0`) with 7 tools is missing two capabilities:

1. **No way to list available scenarios** — callers must read `scenarios.yaml` manually to discover what scenarios exist.
2. **`eval_run` doesn't return a monitor URL** — the monitor web UI starts during a run but the response only contains `{ runId, status }`, giving callers no way to access it.

## Goal

Expose available eval scenarios via a new `eval_scenarios` tool and return the monitor URL in `eval_run` and `eval_run_status` responses so callers can discover scenarios and access the monitor UI without manual file reading.

## Approach

### Monitor Port Resolution

Both `daemon.lock` and `monitors.json` are keyed by CWD. Regardless of which project invokes the MCP server:

- `PROJECT_ROOT` in the MCP server uses `import.meta.dirname` → always resolves to the eval project root
- `SCRIPT_DIR` in `run.sh` uses `dirname "${BASH_SOURCE[0]}"` → always the eval project root
- `eforge monitor` is started with `cd "$SCRIPT_DIR"` → CWD is always the eval project root

Available sources:
- **daemon.lock** → `<eval-root>/.eforge/daemon.lock` — `{ pid, port, startedAt }`, exists only while monitor is running
- **monitors.json** → `~/.config/eforge/monitors.json` — keyed by CWD path, `{ port, pid }`, persists across runs (may be stale)

**Decision:** Read `daemon.lock` as primary source (same as `run.sh` does). It's at a known stable path and only exists when the monitor is actually running. No need for `monitors.json`.

### 1. New Tool: `eval_scenarios`

**File:** `mcp-server/index.ts`

- Add `import { parse as parseYaml } from 'yaml'` (already a transitive dependency in `pnpm-lock`)
- Register `eval_scenarios` tool with no required parameters
- Read and parse `scenarios.yaml` from `PROJECT_ROOT`
- Return each scenario's `id`, `fixture`, `prd`, `description`, and `expect` fields
- Omit `validate` (implementation detail, not useful for callers choosing what to run)

### 2. Return Monitor URL from `eval_run` and `eval_run_status`

**File:** `mcp-server/index.ts`

- Define `DAEMON_LOCK = join(PROJECT_ROOT, '.eforge', 'daemon.lock')`
- Add a helper function `getMonitorUrl()` that reads `daemon.lock`, parses the port, and returns `"http://localhost:<port>"` or `undefined` if the file doesn't exist or can't be parsed
- **`eval_run`**: After spawning `run.sh`, add a short delay (~2s) for the monitor to start, then call `getMonitorUrl()` and include `monitorUrl` in the response
- **`eval_run_status`**: Also call `getMonitorUrl()` and include `monitorUrl` in the response — useful when the monitor wasn't ready at `eval_run` time, or when the caller is polling and wants the URL

If `daemon.lock` doesn't exist, omit `monitorUrl` from the response (monitor may not have started yet or may have been skipped in dry-run mode).

The delay in `eval_run` is acceptable — `run.sh` itself does `sleep 1` after starting the monitor, and the MCP tool is already async/fire-and-forget for the actual run.

## Scope

**In scope:**
- New `eval_scenarios` tool in `mcp-server/index.ts`
- Adding `monitorUrl` to `eval_run` response
- Adding `monitorUrl` to `eval_run_status` response
- Helper function `getMonitorUrl()` reading `daemon.lock`

**Out of scope:**
- Reading `monitors.json` (`~/.config/eforge/monitors.json`)
- Exposing the `validate` field from scenarios (implementation detail)
- Changes to any file other than `mcp-server/index.ts`

## Acceptance Criteria

1. `pnpm type-check` passes with no TypeScript errors.
2. Calling `eval_scenarios` returns a list of scenarios, each containing `id`, `fixture`, `prd`, `description`, and `expect` fields parsed from `scenarios.yaml`.
3. `eval_scenarios` does **not** include the `validate` field in its response.
4. Calling `eval_run` returns a response that includes `monitorUrl` (e.g., `"http://localhost:<port>"`) when the monitor is running (i.e., `daemon.lock` exists and is parseable).
5. Calling `eval_run_status` returns a response that includes `monitorUrl` when the monitor is running.
6. If `daemon.lock` does not exist or cannot be parsed, `monitorUrl` is omitted from both `eval_run` and `eval_run_status` responses (no error thrown).
7. The `yaml` package import resolves correctly (transitive dependency already present in `pnpm-lock`).
