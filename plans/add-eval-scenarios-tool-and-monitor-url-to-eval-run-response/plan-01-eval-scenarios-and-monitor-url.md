---
id: plan-01-eval-scenarios-and-monitor-url
name: Add eval_scenarios Tool and Monitor URL to Responses
depends_on: []
branch: add-eval-scenarios-tool-and-monitor-url-to-eval-run-response/eval-scenarios-and-monitor-url
---

# Add eval_scenarios Tool and Monitor URL to Responses

## Architecture Context

The MCP server (`mcp-server/index.ts`) exposes 7 tools for the eval harness. This plan adds an 8th tool (`eval_scenarios`) and augments two existing tools (`eval_run`, `eval_run_status`) with a `monitorUrl` field. All changes are in the single MCP server file. The `yaml` package is already available as a dev dependency.

## Implementation

### Overview

Three additions to `mcp-server/index.ts`:
1. **`eval_scenarios` tool** — reads and parses `scenarios.yaml`, returns scenario metadata (omitting `validate`)
2. **`getMonitorUrl()` helper** — reads `.eforge/daemon.lock` to extract the monitor port and build a URL
3. **`monitorUrl` in `eval_run` and `eval_run_status` responses** — calls `getMonitorUrl()` and includes the URL when available

### Key Decisions

1. **Read `daemon.lock` not `monitors.json`** — `daemon.lock` is at a known path relative to `PROJECT_ROOT` and only exists when the monitor is running. No need for the global `monitors.json`.
2. **Omit `validate` from `eval_scenarios` response** — `validate` is an implementation detail (shell commands for the harness), not useful for callers choosing scenarios.
3. **2-second delay in `eval_run` before reading `daemon.lock`** — `run.sh` starts the monitor asynchronously. A short delay gives it time to write `daemon.lock`. This is acceptable since `eval_run` is already fire-and-forget.
4. **Graceful fallback** — if `daemon.lock` doesn't exist or can't be parsed, `monitorUrl` is omitted (not set to `null`, not an error).

## Scope

### In Scope
- New `eval_scenarios` tool registration with Zod schema
- `getMonitorUrl()` helper function
- `monitorUrl` field in `eval_run` response (after ~2s delay)
- `monitorUrl` field in `eval_run_status` response
- Import of `parse` from `yaml` package

### Out of Scope
- Reading `monitors.json` from `~/.config/eforge/`
- Exposing the `validate` field from scenarios
- Changes to any file other than `mcp-server/index.ts`
- Changes to `run.sh` or other harness scripts

## Files

### Modify
- `mcp-server/index.ts` — Add `yaml` import, `DAEMON_LOCK` constant, `getMonitorUrl()` helper, `eval_scenarios` tool, and `monitorUrl` to `eval_run`/`eval_run_status` responses

## Detailed Changes

### 1. New imports and constants

Add at the top of the file:
```typescript
import { parse as parseYaml } from 'yaml';
```

Add after the existing constants:
```typescript
const SCENARIOS_FILE = join(PROJECT_ROOT, 'scenarios.yaml');
const DAEMON_LOCK = join(PROJECT_ROOT, '.eforge', 'daemon.lock');
```

### 2. `getMonitorUrl()` helper

Add before the first tool registration:
```typescript
function getMonitorUrl(): string | undefined {
  try {
    if (!existsSync(DAEMON_LOCK)) return undefined;
    const lock = JSON.parse(readFileSync(DAEMON_LOCK, 'utf8'));
    if (typeof lock.port === 'number') {
      return `http://localhost:${lock.port}`;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
```

### 3. `eval_scenarios` tool

Register a new tool (before or after existing tools):
```typescript
server.tool(
  'eval_scenarios',
  'List available eval scenarios from scenarios.yaml.',
  {},
  async () => {
    const raw = readFileSync(SCENARIOS_FILE, 'utf8');
    const parsed = parseYaml(raw);
    const scenarios = (parsed.scenarios ?? []).map((s: Record<string, unknown>) => ({
      id: s.id,
      fixture: s.fixture,
      prd: s.prd,
      description: s.description,
      expect: s.expect,
    }));
    return { content: [{ type: 'text', text: JSON.stringify(scenarios) }] };
  },
);
```

### 4. Modify `eval_run` response

After `child.unref()` and the runId calculation, add a ~2s delay and read the monitor URL:
```typescript
// Wait briefly for monitor to start and write daemon.lock
await new Promise((resolve) => setTimeout(resolve, 2000));
const monitorUrl = getMonitorUrl();
```

Update the return to include `monitorUrl`:
```typescript
return {
  content: [{ type: 'text', text: JSON.stringify({ runId, status: 'started', ...(monitorUrl && { monitorUrl }) }) }],
};
```

### 5. Modify `eval_run_status` response

In each return branch, call `getMonitorUrl()` and spread it into the response object:
```typescript
const monitorUrl = getMonitorUrl();
// Then in each return: ...(monitorUrl && { monitorUrl })
```

## Verification

- [ ] `pnpm type-check` exits with code 0 and produces no TypeScript errors
- [ ] `eval_scenarios` tool is registered and returns an array where each element has keys `id`, `fixture`, `prd`, `description`, `expect`
- [ ] `eval_scenarios` response does not contain a `validate` key on any scenario object
- [ ] `eval_run` response JSON includes `monitorUrl` key with value matching `http://localhost:\d+` when `.eforge/daemon.lock` exists and contains a valid `port` field
- [ ] `eval_run_status` response JSON includes `monitorUrl` key when `.eforge/daemon.lock` exists and contains a valid `port` field
- [ ] When `.eforge/daemon.lock` does not exist, `monitorUrl` is absent from both `eval_run` and `eval_run_status` responses (no error thrown)
- [ ] The `yaml` import resolves without error (package is in devDependencies as `"yaml": "^2"`)
- [ ] All 3 return branches in `eval_run_status` (running, completed, failed) include the `monitorUrl` spread
