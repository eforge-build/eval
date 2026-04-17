#!/usr/bin/env tsx
// Side-by-side backend comparison engine for eval runs.
// Usage: npx tsx lib/compare.ts <run-dir>
//
// Groups scenarios by base scenario ID, compares backends across eight
// dimensions, writes comparison.json and prints a human-readable table.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import {
  type ScenarioResult,
  type AgentAggregate,
} from './types.js';

// --- Comparison types ---

interface BackendValue<T> {
  backend: string;
  value: T;
}

interface PassFailComparison {
  ranked: BackendValue<{ passed: boolean; eforgeExitCode: number; validationPassed: boolean; expectationsPassed: boolean }>[];
  allPassed: boolean;
}

interface CostComparison {
  ranked: BackendValue<number>[];
  noData: string[];
  bestBackend: string;
  worstBackend: string;
  absoluteDelta: number;
  ratio?: number;
}

interface TokenComparison {
  ranked: BackendValue<{ input: number; output: number; total: number; cacheRead: number }>[];
  noData: string[];
  bestBackend: string;
  worstBackend: string;
}

interface DurationComparison {
  ranked: BackendValue<number>[];
  bestBackend: string;
  worstBackend: string;
  absoluteDelta: number;
}

interface CacheEfficiencyComparison {
  ranked: BackendValue<{ cacheRead: number; inputTokens: number; hitRate: number | null }>[];
  noData: string[];
  bestBackend: string;
  worstBackend: string;
}

interface AgentBreakdownEntry {
  agent: string;
  count: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
}

interface AgentBreakdownComparison {
  backends: BackendValue<AgentBreakdownEntry[] | 'no data'>[];
}

interface ReviewQualityComparison {
  backends: BackendValue<{ issueCount: number; accepted: number; rejected: number; bySeverity: Record<string, number> } | 'no data'>[];
}

interface ToolUsageComparison {
  backends: BackendValue<Record<string, Record<string, number>> | 'no data'>[];
}

interface ComparisonDimensions {
  passFail: PassFailComparison;
  cost: CostComparison;
  tokens: TokenComparison;
  duration: DurationComparison;
  cacheEfficiency: CacheEfficiencyComparison;
  agentBreakdown: AgentBreakdownComparison;
  reviewQuality: ReviewQualityComparison;
  toolUsage: ToolUsageComparison;
}

interface ComparisonGroup {
  groupId: string;
  fixture: string;
  prd: string;
  backends: string[];
  dimensions: ComparisonDimensions;
}

interface ComparisonReport {
  runTimestamp: string;
  groupCount: number;
  groups: ComparisonGroup[];
}

// --- Backend entry used internally ---

interface BackendEntry {
  label: string;
  result: ScenarioResult;
}

// --- Grouping ---

// Support reading both new (`backend`) and legacy (`variant`) result.json files
// so baseline comparisons against old runs keep working after the rename.
function resultLabel(result: ScenarioResult, scenarioId: string, separatorIdx: number): string {
  const legacy = (result as unknown as { variant?: { name?: string } }).variant;
  return result.backend?.name ?? legacy?.name ?? scenarioId.slice(separatorIdx + 2);
}

function groupByScenario(
  runDir: string,
): Map<string, { fixture: string; prd: string; backends: BackendEntry[] }> {
  const groups = new Map<string, { fixture: string; prd: string; backends: BackendEntry[] }>();

  if (!existsSync(runDir)) return groups;

  const entries = readdirSync(runDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const resultPath = join(runDir, entry.name, 'result.json');
    if (!existsSync(resultPath)) continue;

    let result: ScenarioResult;
    try {
      result = JSON.parse(readFileSync(resultPath, 'utf8')) as ScenarioResult;
    } catch {
      continue;
    }

    const scenarioId = result.scenario;
    // Derive the base scenario ID and backend label from the expanded ID
    const separatorIdx = scenarioId.indexOf('--');
    if (separatorIdx === -1) continue; // no backend suffix — skip
    const baseId = scenarioId.slice(0, separatorIdx);
    const label = resultLabel(result, scenarioId, separatorIdx);

    if (!groups.has(baseId)) {
      groups.set(baseId, { fixture: '', prd: '', backends: [] });
    }
    groups.get(baseId)!.backends.push({ label, result });
  }

  // Remove groups with fewer than 2 backends
  for (const [key, group] of groups) {
    if (group.backends.length < 2) {
      groups.delete(key);
    }
  }

  return groups;
}

// --- Helpers ---

/** Filter to backends that have metrics data; returns the full list as fallback. */
function backendsWithMetrics(backends: BackendEntry[]): { source: BackendEntry[]; noData: string[] } {
  const withData = backends.filter((v) => v.result.metrics != null);
  const noData = backends.filter((v) => v.result.metrics == null).map((v) => v.label);
  return { source: withData.length > 0 ? withData : backends, noData };
}

// --- Dimension comparators ---

function comparePassFail(backends: BackendEntry[]): PassFailComparison {
  const ranked = backends.map((v) => {
    const eforgeOk = v.result.eforgeExitCode === 0;
    const validationPassed = Object.values(v.result.validation || {}).every((val) => val.passed);
    // Expectations are informational, not pass/fail gates
    const expectationsPassed = !v.result.expectations || v.result.expectations.passed;
    return {
      backend: v.label,
      value: {
        passed: eforgeOk && validationPassed,
        eforgeExitCode: v.result.eforgeExitCode,
        validationPassed,
        expectationsPassed,
      },
    };
  });

  ranked.sort((a, b) => (a.value.passed === b.value.passed ? 0 : a.value.passed ? -1 : 1));

  return {
    ranked,
    allPassed: ranked.every((r) => r.value.passed),
  };
}

function compareCost(backends: BackendEntry[]): CostComparison {
  // Only include backends that have metrics data; backends without metrics
  // (e.g. eforge failed before producing monitor data) are excluded from ranking
  // so they don't appear as "$0 cheapest".
  const { source, noData } = backendsWithMetrics(backends);

  const values = source.map((v) => ({
    backend: v.label,
    value: v.result.metrics?.costUsd ?? 0,
  }));

  const ranked = [...values].sort((a, b) => a.value - b.value);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const absoluteDelta = worst.value - best.value;

  const result: CostComparison = {
    ranked,
    noData,
    bestBackend: best.backend,
    worstBackend: worst.backend,
    absoluteDelta,
  };

  if (best.value > 0) {
    result.ratio = worst.value / best.value;
  }

  return result;
}

function compareTokens(backends: BackendEntry[]): TokenComparison {
  const { source, noData } = backendsWithMetrics(backends);

  const values = source.map((v) => {
    const tokens = v.result.metrics?.tokens;
    return {
      backend: v.label,
      value: {
        input: tokens?.input ?? 0,
        output: tokens?.output ?? 0,
        total: tokens?.total ?? 0,
        cacheRead: tokens?.cacheRead ?? 0,
      },
    };
  });

  const ranked = [...values].sort((a, b) => a.value.total - b.value.total);

  return {
    ranked,
    noData,
    bestBackend: ranked[0].backend,
    worstBackend: ranked[ranked.length - 1].backend,
  };
}

function compareDuration(backends: BackendEntry[]): DurationComparison {
  const values = backends.map((v) => ({
    backend: v.label,
    value: v.result.durationSeconds,
  }));

  const ranked = [...values].sort((a, b) => a.value - b.value);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  return {
    ranked,
    bestBackend: best.backend,
    worstBackend: worst.backend,
    absoluteDelta: worst.value - best.value,
  };
}

function compareCacheEfficiency(backends: BackendEntry[]): CacheEfficiencyComparison {
  const { source, noData } = backendsWithMetrics(backends);

  const values = source.map((v) => {
    const tokens = v.result.metrics?.tokens;
    const inputTokens = tokens?.input ?? 0;
    const cacheRead = tokens?.cacheRead ?? 0;
    const hitRate = inputTokens > 0 ? cacheRead / inputTokens : null;
    return {
      backend: v.label,
      value: { cacheRead, inputTokens, hitRate },
    };
  });

  const ranked = [...values].sort((a, b) => {
    if (a.value.hitRate === null && b.value.hitRate === null) return 0;
    if (a.value.hitRate === null) return 1;
    if (b.value.hitRate === null) return -1;
    return b.value.hitRate - a.value.hitRate;
  });

  return {
    ranked,
    noData,
    bestBackend: ranked[0].backend,
    worstBackend: ranked[ranked.length - 1].backend,
  };
}

function compareAgentBreakdown(backends: BackendEntry[]): AgentBreakdownComparison {
  return {
    backends: backends.map((v) => {
      if (!v.result.metrics?.agents) {
        return { backend: v.label, value: 'no data' as const };
      }
      const agents: AgentBreakdownEntry[] = Object.entries(v.result.metrics.agents).map(
        ([agent, agg]: [string, AgentAggregate]) => ({
          agent,
          count: agg.count,
          totalTokens: agg.totalTokens,
          costUsd: agg.costUsd,
          durationMs: agg.durationMs,
        }),
      );
      agents.sort((a, b) => b.costUsd - a.costUsd);
      return { backend: v.label, value: agents };
    }),
  };
}

function compareReviewQuality(backends: BackendEntry[]): ReviewQualityComparison {
  return {
    backends: backends.map((v) => {
      if (!v.result.metrics?.review) {
        return { backend: v.label, value: 'no data' as const };
      }
      const r = v.result.metrics.review;
      return {
        backend: v.label,
        value: {
          issueCount: r.issueCount,
          accepted: r.accepted,
          rejected: r.rejected,
          bySeverity: r.bySeverity,
        },
      };
    }),
  };
}

function compareToolUsage(backends: BackendEntry[]): ToolUsageComparison {
  return {
    backends: backends.map((v) => {
      if (!v.result.metrics?.toolUsage) {
        return { backend: v.label, value: 'no data' as const };
      }
      return { backend: v.label, value: v.result.metrics.toolUsage };
    }),
  };
}

// --- Report builder ---

function buildComparisonReport(
  runTimestamp: string,
  groups: Map<string, { fixture: string; prd: string; backends: BackendEntry[] }>,
): ComparisonReport {
  const comparisonGroups: ComparisonGroup[] = [];

  for (const [groupId, group] of groups) {
    const { backends } = group;
    comparisonGroups.push({
      groupId,
      fixture: group.fixture,
      prd: group.prd,
      backends: backends.map((v) => v.label),
      dimensions: {
        passFail: comparePassFail(backends),
        cost: compareCost(backends),
        tokens: compareTokens(backends),
        duration: compareDuration(backends),
        cacheEfficiency: compareCacheEfficiency(backends),
        agentBreakdown: compareAgentBreakdown(backends),
        reviewQuality: compareReviewQuality(backends),
        toolUsage: compareToolUsage(backends),
      },
    });
  }

  return {
    runTimestamp,
    groupCount: comparisonGroups.length,
    groups: comparisonGroups,
  };
}

// --- Table printer ---

function printComparisonTable(report: ComparisonReport): void {
  const RESET = '\x1b[0m';
  const BOLD = '\x1b[1m';
  const GREEN = '\x1b[32m';
  const RED = '\x1b[31m';
  const CYAN = '\x1b[36m';
  const DIM = '\x1b[2m';

  const pad = (s: string, len: number) => s.padEnd(len);
  const line = '─'.repeat(100);

  console.log('');
  console.log(`${BOLD}━━━ Backend Comparison ━━━${RESET}`);
  console.log(`${DIM}${report.groupCount} comparison group(s)${RESET}`);
  console.log('');

  for (const group of report.groups) {
    console.log(`${BOLD}${CYAN}${group.groupId}${RESET}`);
    console.log(`${DIM}Backends: ${group.backends.join(', ')}${RESET}`);
    console.log(line);

    // Pass/Fail
    console.log(`${BOLD}  Pass/Fail:${RESET}`);
    for (const entry of group.dimensions.passFail.ranked) {
      const icon = entry.value.passed ? `${GREEN}✓ PASS${RESET}` : `${RED}✗ FAIL${RESET}`;
      console.log(`    ${pad(entry.backend, 30)} ${icon}`);
    }

    // Cost
    console.log(`${BOLD}  Cost:${RESET}`);
    for (const entry of group.dimensions.cost.ranked) {
      const isBest = entry.backend === group.dimensions.cost.bestBackend;
      const color = isBest ? GREEN : '';
      const reset = isBest ? RESET : '';
      console.log(`    ${pad(entry.backend, 30)} ${color}$${entry.value.toFixed(2)}${reset}`);
    }
    if (group.dimensions.cost.absoluteDelta > 0) {
      const ratioStr = group.dimensions.cost.ratio != null
        ? ` (${group.dimensions.cost.ratio.toFixed(1)}x)`
        : '';
      console.log(`    ${DIM}Δ $${group.dimensions.cost.absoluteDelta.toFixed(2)}${ratioStr}${RESET}`);
    }

    // Tokens
    console.log(`${BOLD}  Tokens:${RESET}`);
    for (const entry of group.dimensions.tokens.ranked) {
      const t = entry.value;
      const isBest = entry.backend === group.dimensions.tokens.bestBackend;
      const color = isBest ? GREEN : '';
      const reset = isBest ? RESET : '';
      console.log(`    ${pad(entry.backend, 30)} ${color}${Math.round(t.total / 1000)}k total${reset} (${Math.round(t.input / 1000)}k in, ${Math.round(t.output / 1000)}k out)`);
    }

    // Duration
    console.log(`${BOLD}  Duration:${RESET}`);
    for (const entry of group.dimensions.duration.ranked) {
      const mins = Math.floor(entry.value / 60);
      const secs = Math.round(entry.value % 60);
      const isBest = entry.backend === group.dimensions.duration.bestBackend;
      const color = isBest ? GREEN : '';
      const reset = isBest ? RESET : '';
      console.log(`    ${pad(entry.backend, 30)} ${color}${mins}m ${secs}s${reset}`);
    }
    if (group.dimensions.duration.absoluteDelta > 0) {
      const deltaMins = Math.floor(group.dimensions.duration.absoluteDelta / 60);
      const deltaSecs = Math.round(group.dimensions.duration.absoluteDelta % 60);
      console.log(`    ${DIM}Δ ${deltaMins}m ${deltaSecs}s${RESET}`);
    }

    // Cache Efficiency
    console.log(`${BOLD}  Cache Efficiency:${RESET}`);
    for (const entry of group.dimensions.cacheEfficiency.ranked) {
      const v = entry.value;
      const hitStr = v.hitRate != null ? `${(v.hitRate * 100).toFixed(0)}%` : 'n/a';
      const isBest = entry.backend === group.dimensions.cacheEfficiency.bestBackend;
      const color = isBest ? GREEN : '';
      const reset = isBest ? RESET : '';
      console.log(`    ${pad(entry.backend, 30)} ${color}${hitStr}${reset}`);
    }

    // Review Quality
    console.log(`${BOLD}  Review Quality:${RESET}`);
    for (const entry of group.dimensions.reviewQuality.backends) {
      if (entry.value === 'no data') {
        console.log(`    ${pad(entry.backend, 30)} ${DIM}no data${RESET}`);
      } else {
        const v = entry.value;
        console.log(`    ${pad(entry.backend, 30)} ${v.issueCount} issues, ${v.accepted} accepted, ${v.rejected} rejected`);
      }
    }

    console.log('');
  }
}

// --- Main ---

function main(): void {
  const runDir = process.argv[2];

  if (!runDir) {
    console.error('Usage: npx tsx lib/compare.ts <run-dir>');
    process.exit(1);
  }

  const groups = groupByScenario(runDir);

  if (groups.size === 0) {
    // No groups with ≥2 backends — exit silently
    return;
  }

  // Determine run timestamp from first result or directory name
  let runTimestamp = '';
  for (const group of groups.values()) {
    if (group.backends.length > 0) {
      runTimestamp = group.backends[0].result.timestamp;
      break;
    }
  }
  if (!runTimestamp) {
    runTimestamp = new Date().toISOString();
  }

  const report = buildComparisonReport(runTimestamp, groups);

  const outputPath = join(runDir, 'comparison.json');
  writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`Wrote ${outputPath} (${report.groupCount} comparison groups)`);

  printComparisonTable(report);
}

// CLI entry point
if (process.argv[1] && (process.argv[1].endsWith('compare.ts') || process.argv[1].endsWith('compare.js'))) {
  main();
}
