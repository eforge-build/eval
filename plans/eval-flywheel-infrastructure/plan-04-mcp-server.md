---
id: plan-04-mcp-server
name: MCP Server
depends_on: [plan-03-harness-enhancements]
branch: eval-flywheel-infrastructure/mcp-server
---

# MCP Server

## Architecture Context

The MCP server makes eval data accessible from Claude Code sessions. It wraps the harness CLI and result files behind MCP tools, enabling programmatic eval runs, result queries, and trend analysis. The server uses `@modelcontextprotocol/sdk` and runs as a stdio-based MCP server.

## Implementation

### Overview

Create a new MCP server that exposes seven tools for interacting with the eval harness. The server reads result files from the `results/` directory and spawns `run.sh` for new eval runs.

### Key Decisions

1. **Server location**: `mcp-server/index.ts` in the eval repo with its own section in `package.json` scripts. The server is a single file — the tools delegate to existing modules and shell scripts.
2. **stdio transport**: Standard MCP stdio transport for Claude Code integration. Configured via `.mcp.json` in the eforge project pointing to the eval repo.
3. **`eval_run` is async**: It spawns `run.sh` as a detached child process and returns immediately with a `runId` (the timestamp). Subsequent `eval_run_status` calls check for `summary.json` existence to determine completion.
4. **Result reading reuses the file system**: No in-memory state. Each tool reads the relevant JSON files from `results/`. This is simple and stateless.
5. **`@modelcontextprotocol/sdk` is added as a dependency** — it's the standard MCP SDK for TypeScript servers.
6. **The tsconfig include path is extended** to cover `mcp-server/**/*.ts`.

## Scope

### In Scope
- `mcp-server/index.ts` — MCP server with seven tools
- `eval_run` — Spawn `run.sh` with optional scenario filter, repeat, and compare flags; return runId
- `eval_run_status` — Check if a run is running/completed/failed by checking for summary.json
- `eval_runs` — List completed runs by scanning `results/` for timestamped directories with `summary.json`
- `eval_results` — Return scenario results for a given run timestamp; optional comparison with another run
- `eval_observations` — Return `analysis.json` for a given run timestamp
- `eval_scenario_detail` — Return full `result.json` for a specific scenario in a specific run
- `eval_history` — Return trend data from `history.json` filtered by metric and limit
- Adding `@modelcontextprotocol/sdk` to `package.json` dependencies
- Extending `tsconfig.json` include to cover `mcp-server/**/*.ts`
- Adding `mcp-server` script to `package.json`

### Out of Scope
- Configuring `.mcp.json` in the eforge project (that's the consumer's responsibility)
- Changes to existing harness code
- Authentication/authorization (local server only)

## Files

### Create
- `mcp-server/index.ts` — MCP server entry point; imports `@modelcontextprotocol/sdk`; registers seven tools (`eval_run`, `eval_run_status`, `eval_runs`, `eval_results`, `eval_observations`, `eval_scenario_detail`, `eval_history`); uses stdio transport; reads from `results/` directory relative to project root; spawns `run.sh` for `eval_run`

### Modify
- `package.json` — Add `@modelcontextprotocol/sdk` to dependencies; add `"mcp-server": "npx tsx mcp-server/index.ts"` script
- `tsconfig.json` — Extend `include` array to `["lib/**/*.ts", "mcp-server/**/*.ts"]`

## Verification

- [ ] `pnpm type-check` passes with zero errors after adding mcp-server code
- [ ] `pnpm install` installs `@modelcontextprotocol/sdk` without errors
- [ ] `mcp-server/index.ts` imports from `@modelcontextprotocol/sdk` and sets up a `StdioServerTransport`
- [ ] The server registers exactly seven tools: `eval_run`, `eval_run_status`, `eval_runs`, `eval_results`, `eval_observations`, `eval_scenario_detail`, `eval_history`
- [ ] `eval_run` tool accepts optional `scenarios` (string array), `repeat` (number), and `compare` (string) parameters
- [ ] `eval_run` tool spawns `run.sh` as a child process and returns `{ runId: string, status: "started" }` without blocking
- [ ] `eval_run_status` tool accepts `runId` (string) and returns status `"running"`, `"completed"`, or `"failed"`
- [ ] `eval_runs` tool returns an array of objects with `timestamp`, `eforgeVersion`, `passed`, `total`, `costUsd` fields
- [ ] `eval_results` tool accepts `timestamp` (string) and optional `compare` (string) and returns scenario results
- [ ] `eval_observations` tool accepts `timestamp` (string) and returns the parsed `analysis.json` content
- [ ] `eval_scenario_detail` tool accepts `timestamp` (string) and `scenario` (string) and returns the full `result.json` for that scenario
- [ ] `eval_history` tool accepts `metric` (string) and optional `limit` (number) and returns time series data
- [ ] `tsconfig.json` includes `"mcp-server/**/*.ts"` in the `include` array
- [ ] `package.json` contains `@modelcontextprotocol/sdk` in dependencies and a `mcp-server` script
