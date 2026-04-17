#!/usr/bin/env tsx
// MCP server exposing eval harness tools for Claude Code integration.
// Runs as a stdio-based MCP server using @modelcontextprotocol/sdk.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn } from 'child_process';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { loadScenarios, loadBackends } from '../lib/scenarios.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const RESULTS_DIR = join(PROJECT_ROOT, 'results');
const RUN_SCRIPT = join(PROJECT_ROOT, 'run.sh');
const SCENARIOS_FILE = join(PROJECT_ROOT, 'scenarios.yaml');
const BACKENDS_DIR = join(PROJECT_ROOT, 'eforge', 'backends');
const BACKEND_ENVS_FILE = join(PROJECT_ROOT, 'backend-envs.yaml');
const DAEMON_LOCK = join(PROJECT_ROOT, '.eforge', 'daemon.lock');

const server = new McpServer({
  name: 'eval-harness',
  version: '1.0.0',
});

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

// --- Tool: eval_scenarios ---
server.tool(
  'eval_scenarios',
  'List available eval scenarios from scenarios.yaml.',
  {},
  async () => {
    const scenarios = loadScenarios(SCENARIOS_FILE).map((s) => ({
      id: s.id,
      fixture: s.fixture,
      prd: s.prd,
      description: s.description,
      expect: s.expect,
    }));
    return { content: [{ type: 'text', text: JSON.stringify(scenarios) }] };
  },
);

// --- Tool: eval_backends ---
server.tool(
  'eval_backends',
  'List available backend profiles from eforge/backends/ (merged with backend-envs.yaml for env-file mappings).',
  {},
  async () => {
    const backends = loadBackends(BACKENDS_DIR, BACKEND_ENVS_FILE).map((b) => ({
      name: b.name,
      envFile: b.envFile,
    }));
    return { content: [{ type: 'text', text: JSON.stringify(backends) }] };
  },
);

// --- Tool: eval_run ---
server.tool(
  'eval_run',
  'Spawn an eval run. Returns immediately with a runId (timestamp). Use eval_run_status to check completion.',
  {
    scenarios: z.array(z.string()).optional().describe('Optional list of scenario IDs to run (prefix match supported)'),
    backend: z.string().describe('Comma-separated backend profile names to run (e.g. "claude-sdk" or "claude-sdk,pi-codex")'),
    repeat: z.number().optional().describe('Number of times to repeat each scenario'),
    compare: z.string().optional().describe('Timestamp of a previous run to compare against'),
  },
  async ({ scenarios, backend, repeat, compare }) => {
    const args: string[] = ['--backend', backend];

    if (repeat && repeat > 1) {
      args.push('--repeat', String(repeat));
    }
    if (compare) {
      args.push('--compare', compare);
    }
    if (scenarios && scenarios.length > 0) {
      args.push(...scenarios);
    } else {
      args.push('--all');
    }

    const child = spawn(RUN_SCRIPT, args, {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => {
      // Prevent unhandled error events (e.g. spawn failure) from crashing the server
    });
    child.unref();

    // The runId is the timestamp directory that run.sh will create.
    // We determine it by finding the newest directory after a short delay,
    // or we generate the expected timestamp format.
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const runId = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}T${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}`;

    // Wait briefly for monitor to start and write daemon.lock
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const monitorUrl = getMonitorUrl();

    return {
      content: [{ type: 'text', text: JSON.stringify({ runId, status: 'started', ...(monitorUrl && { monitorUrl }) }) }],
    };
  },
);

// --- Tool: eval_run_status ---
server.tool(
  'eval_run_status',
  'Check the status of an eval run by its runId (timestamp).',
  {
    runId: z.string().describe('The run timestamp ID'),
  },
  async ({ runId }) => {
    const runDir = join(RESULTS_DIR, runId);
    const monitorUrl = getMonitorUrl();

    if (!existsSync(runDir)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ runId, status: 'running', ...(monitorUrl && { monitorUrl }) }) }],
      };
    }

    const summaryPath = join(runDir, 'summary.json');
    if (existsSync(summaryPath)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ runId, status: 'completed', ...(monitorUrl && { monitorUrl }) }) }],
      };
    }

    // Directory exists but no summary yet — still running or failed
    // Check if there are any result.json files to distinguish running from failed
    const entries = readdirSync(runDir, { withFileTypes: true });
    const hasResults = entries.some(
      (e) => e.isDirectory() && existsSync(join(runDir, e.name, 'result.json')),
    );

    // If there are scenario results but no summary, it may have failed mid-run
    // We still report "running" since we can't definitively distinguish
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ runId, status: hasResults ? 'failed' : 'running', ...(monitorUrl && { monitorUrl }) }),
        },
      ],
    };
  },
);

// --- Tool: eval_runs ---
server.tool(
  'eval_runs',
  'List completed eval runs with summary info.',
  {},
  async () => {
    if (!existsSync(RESULTS_DIR)) {
      return { content: [{ type: 'text', text: JSON.stringify([]) }] };
    }

    const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;
    const entries = readdirSync(RESULTS_DIR, { withFileTypes: true });

    const runs: Array<{
      timestamp: string;
      eforgeVersion: string;
      passed: number;
      total: number;
      costUsd: number;
    }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!timestampPattern.test(entry.name)) continue;

      const summaryPath = join(RESULTS_DIR, entry.name, 'summary.json');
      if (!existsSync(summaryPath)) continue;

      try {
        const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
        runs.push({
          timestamp: summary.timestamp ?? entry.name,
          eforgeVersion: summary.eforgeVersion ?? 'unknown',
          passed: summary.passed ?? 0,
          total: summary.totalScenarios ?? 0,
          costUsd: summary.totals?.costUsd ?? 0,
        });
      } catch {
        // Skip malformed files
      }
    }

    runs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return { content: [{ type: 'text', text: JSON.stringify(runs) }] };
  },
);

// --- Tool: eval_results ---
server.tool(
  'eval_results',
  'Return scenario results for a given run. Optionally compare with another run.',
  {
    timestamp: z.string().describe('The run timestamp'),
    compare: z.string().optional().describe('Timestamp of another run to compare against'),
  },
  async ({ timestamp, compare }) => {
    const summaryPath = join(RESULTS_DIR, timestamp, 'summary.json');
    if (!existsSync(summaryPath)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `No summary found for run ${timestamp}` }) }],
        isError: true,
      };
    }

    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));

    if (!compare) {
      return { content: [{ type: 'text', text: JSON.stringify(summary) }] };
    }

    // Load baseline for comparison
    const baselinePath = join(RESULTS_DIR, compare, 'summary.json');
    if (!existsSync(baselinePath)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `No summary found for baseline run ${compare}` }) }],
        isError: true,
      };
    }

    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ current: summary, baseline }),
        },
      ],
    };
  },
);

// --- Tool: eval_observations ---
server.tool(
  'eval_observations',
  'Return the analysis observations for a given run.',
  {
    timestamp: z.string().describe('The run timestamp'),
  },
  async ({ timestamp }) => {
    const analysisPath = join(RESULTS_DIR, timestamp, 'analysis.json');
    if (!existsSync(analysisPath)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `No analysis.json found for run ${timestamp}` }) }],
        isError: true,
      };
    }

    const analysis = JSON.parse(readFileSync(analysisPath, 'utf8'));
    return { content: [{ type: 'text', text: JSON.stringify(analysis) }] };
  },
);

// --- Tool: eval_scenario_detail ---
server.tool(
  'eval_scenario_detail',
  'Return the full result.json for a specific scenario in a specific run.',
  {
    timestamp: z.string().describe('The run timestamp'),
    scenario: z.string().describe('The scenario ID'),
  },
  async ({ timestamp, scenario }) => {
    const resultPath = join(RESULTS_DIR, timestamp, scenario, 'result.json');
    if (!existsSync(resultPath)) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: `No result.json found for scenario ${scenario} in run ${timestamp}` }),
          },
        ],
        isError: true,
      };
    }

    const result = JSON.parse(readFileSync(resultPath, 'utf8'));
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
);

// --- Tool: eval_history ---
server.tool(
  'eval_history',
  'Return trend data from history.json filtered by metric and limit.',
  {
    metric: z.string().describe('Metric to extract: "passRate", "costUsd", "all"'),
    limit: z.number().optional().describe('Maximum number of entries to return (most recent first)'),
  },
  async ({ metric, limit }) => {
    const historyPath = join(RESULTS_DIR, 'history.json');
    if (!existsSync(historyPath)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'No history.json found. Run the harness at least once.' }) }],
        isError: true,
      };
    }

    const history = JSON.parse(readFileSync(historyPath, 'utf8'));
    let runs: Array<Record<string, unknown>> = history.runs ?? [];

    // Most recent first for limit
    runs = [...runs].reverse();
    if (limit && limit > 0) {
      runs = runs.slice(0, limit);
    }

    if (metric === 'all') {
      return { content: [{ type: 'text', text: JSON.stringify(runs) }] };
    }

    // Extract specific metric
    const series = runs.map((run) => {
      const entry: Record<string, unknown> = { timestamp: run.timestamp };
      if (metric === 'passRate') {
        const total = (run.total as number) || 1;
        entry.passRate = (run.passed as number) / total;
        entry.passed = run.passed;
        entry.total = run.total;
      } else if (metric === 'costUsd') {
        entry.costUsd = run.costUsd;
      } else {
        // Return whatever field matches
        entry[metric] = (run as Record<string, unknown>)[metric];
      }
      return entry;
    });

    return { content: [{ type: 'text', text: JSON.stringify(series) }] };
  },
);

// --- Tool: eval_compare ---
server.tool(
  'eval_compare',
  'Return the backend comparison report for a given run.',
  {
    timestamp: z.string().describe('The run timestamp'),
  },
  async ({ timestamp }) => {
    const comparisonPath = join(RESULTS_DIR, timestamp, 'comparison.json');
    if (!existsSync(comparisonPath)) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: `No comparison.json found for run ${timestamp}. This may be a single-backend run with no comparisons.`,
            }),
          },
        ],
        isError: true,
      };
    }

    let comparison: unknown;
    try {
      comparison = JSON.parse(readFileSync(comparisonPath, 'utf8'));
    } catch (e) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: `Failed to parse comparison.json for run ${timestamp}: ${e instanceof Error ? e.message : String(e)}`,
            }),
          },
        ],
        isError: true,
      };
    }
    return { content: [{ type: 'text', text: JSON.stringify(comparison) }] };
  },
);

// --- Start server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
