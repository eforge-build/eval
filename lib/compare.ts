#!/usr/bin/env tsx
// Side-by-side variant comparison engine for eval runs.
// Usage: npx tsx lib/compare.ts <run-dir>
//
// Groups scenarios by fixture+PRD, compares variants across eight dimensions,
// writes comparison.json and prints a human-readable table.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import {
  type ScenarioResult,
  type AgentAggregate,
} from './types.js';

// --- Comparison types ---

interface VariantValue<T> {
  variant: string;
  value: T;
}

interface PassFailComparison {
  ranked: VariantValue<{ passed: boolean; eforgeExitCode: number; validationPassed: boolean; expectationsPassed: boolean }>[];
  allPassed: boolean;
}

interface CostComparison {
  ranked: VariantValue<number>[];
  noData: string[];
  bestVariant: string;
  worstVariant: string;
  absoluteDelta: number;
  ratio?: number;
}

interface TokenComparison {
  ranked: VariantValue<{ input: number; output: number; total: number; cacheRead: number }>[];
  noData: string[];
  bestVariant: string;
  worstVariant: string;
}

interface DurationComparison {
  ranked: VariantValue<number>[];
  bestVariant: string;
  worstVariant: string;
  absoluteDelta: number;
}

interface CacheEfficiencyComparison {
  ranked: VariantValue<{ cacheRead: number; inputTokens: number; hitRate: number | null }>[];
  noData: string[];
  bestVariant: string;
  worstVariant: string;
}

interface AgentBreakdownEntry {
  agent: string;
  count: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
}

interface AgentBreakdownComparison {
  variants: VariantValue<AgentBreakdownEntry[] | 'no data'>[];
}

interface ReviewQualityComparison {
  variants: VariantValue<{ issueCount: number; accepted: number; rejected: number; bySeverity: Record<string, number> } | 'no data'>[];
}

interface ToolUsageComparison {
  variants: VariantValue<Record<string, Record<string, number>> | 'no data'>[];
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
  variants: string[];
  dimensions: ComparisonDimensions;
}

interface ComparisonReport {
  runTimestamp: string;
  groupCount: number;
  groups: ComparisonGroup[];
}

// --- Variant entry used internally ---

interface VariantEntry {
  label: string;
  result: ScenarioResult;
}

// --- Grouping ---

function groupVariants(
  runDir: string,
): Map<string, { fixture: string; prd: string; variants: VariantEntry[] }> {
  const groups = new Map<string, { fixture: string; prd: string; variants: VariantEntry[] }>();

  // Read all result.json files from subdirectories
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
    // Derive the base scenario ID and variant label from the expanded ID
    const separatorIdx = scenarioId.indexOf('--');
    if (separatorIdx === -1) continue; // no variant suffix — skip
    const baseId = scenarioId.slice(0, separatorIdx);
    const label = result.variant?.name ?? scenarioId.slice(separatorIdx + 2);

    if (!groups.has(baseId)) {
      groups.set(baseId, { fixture: '', prd: '', variants: [] });
    }
    groups.get(baseId)!.variants.push({ label, result });
  }

  // Remove groups with fewer than 2 variants
  for (const [key, group] of groups) {
    if (group.variants.length < 2) {
      groups.delete(key);
    }
  }

  return groups;
}

// --- Helpers ---

/** Filter to variants that have metrics data; returns the full list as fallback. */
function variantsWithMetrics(variants: VariantEntry[]): { source: VariantEntry[]; noData: string[] } {
  const withData = variants.filter((v) => v.result.metrics != null);
  const noData = variants.filter((v) => v.result.metrics == null).map((v) => v.label);
  return { source: withData.length > 0 ? withData : variants, noData };
}

// --- Dimension comparators ---

function comparePassFail(variants: VariantEntry[]): PassFailComparison {
  const ranked = variants.map((v) => {
    const eforgeOk = v.result.eforgeExitCode === 0;
    const validationPassed = Object.values(v.result.validation || {}).every((val) => val.passed);
    // Expectations are informational, not pass/fail gates
    const expectationsPassed = !v.result.expectations || v.result.expectations.passed;
    return {
      variant: v.label,
      value: {
        passed: eforgeOk && validationPassed,
        eforgeExitCode: v.result.eforgeExitCode,
        validationPassed,
        expectationsPassed,
      },
    };
  });

  // Sort passes first for consistency with other comparators
  ranked.sort((a, b) => (a.value.passed === b.value.passed ? 0 : a.value.passed ? -1 : 1));

  return {
    ranked,
    allPassed: ranked.every((r) => r.value.passed),
  };
}

function compareCost(variants: VariantEntry[]): CostComparison {
  // Only include variants that have metrics data; variants without metrics
  // (e.g. eforge failed before producing monitor data) are excluded from ranking
  // so they don't appear as "$0 cheapest".
  const { source, noData } = variantsWithMetrics(variants);

  const values = source.map((v) => ({
    variant: v.label,
    value: v.result.metrics?.costUsd ?? 0,
  }));

  const ranked = [...values].sort((a, b) => a.value - b.value);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const absoluteDelta = worst.value - best.value;

  const result: CostComparison = {
    ranked,
    noData,
    bestVariant: best.variant,
    worstVariant: worst.variant,
    absoluteDelta,
  };

  // Only include ratio when best is non-zero (avoids Infinity)
  if (best.value > 0) {
    result.ratio = worst.value / best.value;
  }

  return result;
}

function compareTokens(variants: VariantEntry[]): TokenComparison {
  const { source, noData } = variantsWithMetrics(variants);

  const values = source.map((v) => {
    const tokens = v.result.metrics?.tokens;
    return {
      variant: v.label,
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
    bestVariant: ranked[0].variant,
    worstVariant: ranked[ranked.length - 1].variant,
  };
}

function compareDuration(variants: VariantEntry[]): DurationComparison {
  const values = variants.map((v) => ({
    variant: v.label,
    value: v.result.durationSeconds,
  }));

  const ranked = [...values].sort((a, b) => a.value - b.value);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  return {
    ranked,
    bestVariant: best.variant,
    worstVariant: worst.variant,
    absoluteDelta: worst.value - best.value,
  };
}

function compareCacheEfficiency(variants: VariantEntry[]): CacheEfficiencyComparison {
  const { source, noData } = variantsWithMetrics(variants);

  const values = source.map((v) => {
    const tokens = v.result.metrics?.tokens;
    const inputTokens = tokens?.input ?? 0;
    const cacheRead = tokens?.cacheRead ?? 0;
    const hitRate = inputTokens > 0 ? cacheRead / inputTokens : null;
    return {
      variant: v.label,
      value: { cacheRead, inputTokens, hitRate },
    };
  });

  // Sort by hit rate descending (best first), null at end
  const ranked = [...values].sort((a, b) => {
    if (a.value.hitRate === null && b.value.hitRate === null) return 0;
    if (a.value.hitRate === null) return 1;
    if (b.value.hitRate === null) return -1;
    return b.value.hitRate - a.value.hitRate;
  });

  return {
    ranked,
    noData,
    bestVariant: ranked[0].variant,
    worstVariant: ranked[ranked.length - 1].variant,
  };
}

function compareAgentBreakdown(variants: VariantEntry[]): AgentBreakdownComparison {
  return {
    variants: variants.map((v) => {
      if (!v.result.metrics?.agents) {
        return { variant: v.label, value: 'no data' as const };
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
      // Sort by cost descending
      agents.sort((a, b) => b.costUsd - a.costUsd);
      return { variant: v.label, value: agents };
    }),
  };
}

function compareReviewQuality(variants: VariantEntry[]): ReviewQualityComparison {
  return {
    variants: variants.map((v) => {
      if (!v.result.metrics?.review) {
        return { variant: v.label, value: 'no data' as const };
      }
      const r = v.result.metrics.review;
      return {
        variant: v.label,
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

function compareToolUsage(variants: VariantEntry[]): ToolUsageComparison {
  return {
    variants: variants.map((v) => {
      if (!v.result.metrics?.toolUsage) {
        return { variant: v.label, value: 'no data' as const };
      }
      return { variant: v.label, value: v.result.metrics.toolUsage };
    }),
  };
}

// --- Report builder ---

function buildComparisonReport(
  runTimestamp: string,
  groups: Map<string, { fixture: string; prd: string; variants: VariantEntry[] }>,
): ComparisonReport {
  const comparisonGroups: ComparisonGroup[] = [];

  for (const [groupId, group] of groups) {
    const { variants } = group;
    comparisonGroups.push({
      groupId,
      fixture: group.fixture,
      prd: group.prd,
      variants: variants.map((v) => v.label),
      dimensions: {
        passFail: comparePassFail(variants),
        cost: compareCost(variants),
        tokens: compareTokens(variants),
        duration: compareDuration(variants),
        cacheEfficiency: compareCacheEfficiency(variants),
        agentBreakdown: compareAgentBreakdown(variants),
        reviewQuality: compareReviewQuality(variants),
        toolUsage: compareToolUsage(variants),
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
  const YELLOW = '\x1b[33m';
  const CYAN = '\x1b[36m';
  const DIM = '\x1b[2m';

  const pad = (s: string, len: number) => s.padEnd(len);
  const line = '─'.repeat(100);

  console.log('');
  console.log(`${BOLD}━━━ Variant Comparison ━━━${RESET}`);
  console.log(`${DIM}${report.groupCount} comparison group(s)${RESET}`);
  console.log('');

  for (const group of report.groups) {
    console.log(`${BOLD}${CYAN}${group.groupId}${RESET}`);
    console.log(`${DIM}Variants: ${group.variants.join(', ')}${RESET}`);
    console.log(line);

    // Pass/Fail
    console.log(`${BOLD}  Pass/Fail:${RESET}`);
    for (const entry of group.dimensions.passFail.ranked) {
      const icon = entry.value.passed ? `${GREEN}✓ PASS${RESET}` : `${RED}✗ FAIL${RESET}`;
      console.log(`    ${pad(entry.variant, 30)} ${icon}`);
    }

    // Cost
    console.log(`${BOLD}  Cost:${RESET}`);
    for (const entry of group.dimensions.cost.ranked) {
      const isBest = entry.variant === group.dimensions.cost.bestVariant;
      const color = isBest ? GREEN : '';
      const reset = isBest ? RESET : '';
      console.log(`    ${pad(entry.variant, 30)} ${color}$${entry.value.toFixed(2)}${reset}`);
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
      const isBest = entry.variant === group.dimensions.tokens.bestVariant;
      const color = isBest ? GREEN : '';
      const reset = isBest ? RESET : '';
      console.log(`    ${pad(entry.variant, 30)} ${color}${Math.round(t.total / 1000)}k total${reset} (${Math.round(t.input / 1000)}k in, ${Math.round(t.output / 1000)}k out)`);
    }

    // Duration
    console.log(`${BOLD}  Duration:${RESET}`);
    for (const entry of group.dimensions.duration.ranked) {
      const mins = Math.floor(entry.value / 60);
      const secs = Math.round(entry.value % 60);
      const isBest = entry.variant === group.dimensions.duration.bestVariant;
      const color = isBest ? GREEN : '';
      const reset = isBest ? RESET : '';
      console.log(`    ${pad(entry.variant, 30)} ${color}${mins}m ${secs}s${reset}`);
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
      const isBest = entry.variant === group.dimensions.cacheEfficiency.bestVariant;
      const color = isBest ? GREEN : '';
      const reset = isBest ? RESET : '';
      console.log(`    ${pad(entry.variant, 30)} ${color}${hitStr}${reset}`);
    }

    // Review Quality
    console.log(`${BOLD}  Review Quality:${RESET}`);
    for (const entry of group.dimensions.reviewQuality.variants) {
      if (entry.value === 'no data') {
        console.log(`    ${pad(entry.variant, 30)} ${DIM}no data${RESET}`);
      } else {
        const v = entry.value;
        console.log(`    ${pad(entry.variant, 30)} ${v.issueCount} issues, ${v.accepted} accepted, ${v.rejected} rejected`);
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

  const groups = groupVariants(runDir);

  if (groups.size === 0) {
    // No groups with ≥2 variants — exit silently
    return;
  }

  // Determine run timestamp from first result or directory name
  let runTimestamp = '';
  for (const group of groups.values()) {
    if (group.variants.length > 0) {
      runTimestamp = group.variants[0].result.timestamp;
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
