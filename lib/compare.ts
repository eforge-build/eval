#!/usr/bin/env tsx
// Side-by-side profile comparison engine for eval runs.
// Usage: npx tsx lib/compare.ts <run-dir>
//
// Groups scenarios by base scenario ID, compares profiles across eight
// dimensions, writes comparison.json and prints a human-readable table.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import {
  type ScenarioResult,
  type AgentAggregate,
} from './types.js';
import { scorePairwise, loadJudgeConfig, formatCostUsd } from './score-quality.js';
import type { PairwiseScoreWithUsage } from './score-quality.js';

// --- Comparison types ---

interface ProfileValue<T> {
  profile: string;
  value: T;
}

interface PassFailComparison {
  ranked: ProfileValue<{ passed: boolean; eforgeExitCode: number; validationPassed: boolean; expectationsPassed: boolean }>[];
  allPassed: boolean;
}

interface CostEntry {
  profile: string;
  value: number; // costUsd
  costPerQuality?: number; // USD per weighted quality point
}

interface CostComparison {
  ranked: CostEntry[];
  noData: string[];
  bestProfile: string;
  worstProfile: string;
  absoluteDelta: number;
  ratio?: number;
  bestCostPerQualityProfile?: string;
}

interface TokenComparison {
  ranked: ProfileValue<{ input: number; output: number; total: number; cacheRead: number }>[];
  noData: string[];
  bestProfile: string;
  worstProfile: string;
}

interface DurationComparison {
  ranked: ProfileValue<number>[];
  bestProfile: string;
  worstProfile: string;
  absoluteDelta: number;
}

interface CacheEfficiencyComparison {
  ranked: ProfileValue<{ cacheRead: number; inputTokens: number; hitRate: number | null }>[];
  noData: string[];
  bestProfile: string;
  worstProfile: string;
}

interface AgentBreakdownEntry {
  agent: string;
  count: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
}

interface AgentBreakdownComparison {
  profiles: ProfileValue<AgentBreakdownEntry[] | 'no data'>[];
}

interface ReviewQualityComparison {
  profiles: ProfileValue<{ issueCount: number; accepted: number; rejected: number; bySeverity: Record<string, number> } | 'no data'>[];
}

interface ToolUsageComparison {
  profiles: ProfileValue<Record<string, Record<string, number>> | 'no data'>[];
}

// --- Quality comparison types ---

interface QualityAbsoluteEntry {
  profile: string;
  weighted: number;
  dimensions: {
    prdAdherence: number;
    codeQuality: number;
    testQuality: number;
    changeDiscipline: number;
  };
}

interface QualityAbsoluteSubBlock {
  ranked: QualityAbsoluteEntry[];
  bestProfile: string;
  noData: string[];
}

interface PairwiseDimResult {
  winner: string; // profile label or 'tie'
  justification: string;
}

interface PairwiseEntry {
  profileA: string;
  profileB: string;
  perDimension: {
    prdAdherence: PairwiseDimResult;
    codeQuality: PairwiseDimResult;
    testQuality: PairwiseDimResult;
    changeDiscipline: PairwiseDimResult;
  };
}

interface QualityPairwiseSubBlock {
  pairs: PairwiseEntry[];
  summary: {
    perDimension: Record<string, Record<string, number>>;
  };
}

interface QualityComparison {
  absolute?: QualityAbsoluteSubBlock;
  pairwise?: QualityPairwiseSubBlock;
}

// --- Marginal delta + archetype rollup types ---

interface MarginalDelta {
  profileA: string;
  profileB: string;
  changedKnob: { path: string; oldValue: unknown; newValue: unknown };
  costDelta: number; // costB - costA (USD)
  qualityDelta?: number; // qualityB - qualityA (weighted)
  qualityPerDollar?: number; // qualityDelta / costDelta when both available and costDelta != 0
}

interface ArchetypePerProfile {
  profile: string;
  scenarios: number;
  passes: number;
  passRate: number;
  meanCost?: number;
  meanDuration: number;
  meanQuality?: number;
  meanCostPerQuality?: number;
}

interface ArchetypeRollup {
  archetype: string;
  scenarioCount: number;
  perProfile: ArchetypePerProfile[];
  best: {
    cost?: { profile: string; value: number };
    quality?: { profile: string; value: number };
    duration?: { profile: string; value: number };
    costPerQuality?: { profile: string; value: number };
    passRate?: { profile: string; value: number };
  };
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
  quality?: QualityComparison;
}

interface ComparisonGroup {
  groupId: string;
  fixture: string;
  prd: string;
  archetype?: string;
  profiles: string[];
  dimensions: ComparisonDimensions;
  marginalDeltas?: MarginalDelta[];
}

interface ComparisonReport {
  runTimestamp: string;
  groupCount: number;
  groups: ComparisonGroup[];
  archetypes?: ArchetypeRollup[];
}

// --- Profile entry used internally ---

interface ProfileEntry {
  label: string;
  result: ScenarioResult;
  qualityDir?: string; // path to <scenarioDir>/quality/ if it exists
}

// --- Grouping ---

function resultLabel(result: ScenarioResult, scenarioId: string, separatorIdx: number): string {
  return result.profile?.name ?? scenarioId.slice(separatorIdx + 2);
}

function groupByScenario(
  runDir: string,
): Map<string, { fixture: string; prd: string; profiles: ProfileEntry[] }> {
  const groups = new Map<string, { fixture: string; prd: string; profiles: ProfileEntry[] }>();

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
    // Derive the base scenario ID and profile label from the expanded ID
    const separatorIdx = scenarioId.indexOf('--');
    if (separatorIdx === -1) continue; // no profile suffix — skip
    const baseId = scenarioId.slice(0, separatorIdx);
    const label = resultLabel(result, scenarioId, separatorIdx);

    // Populate qualityDir if snapshot exists
    const potentialQualityDir = join(runDir, entry.name, 'quality');
    const qualityDir = existsSync(potentialQualityDir) ? potentialQualityDir : undefined;

    if (!groups.has(baseId)) {
      groups.set(baseId, { fixture: '', prd: '', profiles: [] });
    }
    groups.get(baseId)!.profiles.push({ label, result, qualityDir });
  }

  // Remove groups with fewer than 2 profiles
  for (const [key, group] of groups) {
    if (group.profiles.length < 2) {
      groups.delete(key);
    }
  }

  return groups;
}

// --- Helpers ---

/** Filter to profiles that have metrics data; returns the full list as fallback. */
function profilesWithMetrics(profiles: ProfileEntry[]): { source: ProfileEntry[]; noData: string[] } {
  const withData = profiles.filter((v) => v.result.metrics != null);
  const noData = profiles.filter((v) => v.result.metrics == null).map((v) => v.label);
  return { source: withData.length > 0 ? withData : profiles, noData };
}

/** Read the absolute weighted quality score off a result, if scored. */
function getWeightedQuality(result: ScenarioResult): number | undefined {
  return result.quality?.absolute?.overall.weighted;
}

/** Flatten a nested config object to a {path: leaf} map. Arrays serialize as JSON for shallow equality. */
function flattenConfig(
  obj: unknown,
  prefix = '',
  out = new Map<string, unknown>(),
): Map<string, unknown> {
  if (obj == null || typeof obj !== 'object') {
    if (prefix) out.set(prefix, obj);
    return out;
  }
  if (Array.isArray(obj)) {
    out.set(prefix, JSON.stringify(obj));
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      flattenConfig(v, path, out);
    } else if (Array.isArray(v)) {
      out.set(path, JSON.stringify(v));
    } else {
      out.set(path, v);
    }
  }
  return out;
}

function diffProfileConfigs(
  a: unknown,
  b: unknown,
): Array<{ path: string; oldValue: unknown; newValue: unknown }> {
  const flatA = flattenConfig(a);
  const flatB = flattenConfig(b);
  const allKeys = new Set<string>([...flatA.keys(), ...flatB.keys()]);
  const diffs: Array<{ path: string; oldValue: unknown; newValue: unknown }> = [];
  for (const k of allKeys) {
    const av = flatA.get(k);
    const bv = flatB.get(k);
    if (av !== bv) {
      diffs.push({ path: k, oldValue: av, newValue: bv });
    }
  }
  return diffs;
}

/** Derive scenario archetype from expectations (preferred) or scenario ID. */
function deriveArchetype(groupId: string, profiles: ProfileEntry[]): string | undefined {
  for (const p of profiles) {
    const modeCheck = p.result.expectations?.checks?.find((c) => c.check === 'mode');
    if (modeCheck && typeof modeCheck.expected === 'string') {
      return modeCheck.expected;
    }
  }
  for (const archetype of ['errand', 'excursion', 'expedition']) {
    if (groupId.includes(`-${archetype}-`) || groupId.endsWith(`-${archetype}`)) {
      return archetype;
    }
  }
  return undefined;
}

// --- Dimension comparators ---

function comparePassFail(profiles: ProfileEntry[]): PassFailComparison {
  const ranked = profiles.map((v) => {
    const eforgeOk = v.result.eforgeExitCode === 0;
    const validationPassed = Object.values(v.result.validation || {}).every((val) => val.passed);
    // Expectations are informational, not pass/fail gates
    const expectationsPassed = !v.result.expectations || v.result.expectations.passed;
    return {
      profile: v.label,
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

function compareCost(profiles: ProfileEntry[]): CostComparison {
  // Only include profiles that have metrics data; profiles without metrics
  // (e.g. eforge failed before producing monitor data) are excluded from ranking
  // so they don't appear as "$0 cheapest".
  const { source, noData } = profilesWithMetrics(profiles);

  const values: CostEntry[] = source.map((v) => {
    const cost = v.result.metrics?.costUsd ?? 0;
    const quality = getWeightedQuality(v.result);
    const entry: CostEntry = { profile: v.label, value: cost };
    if (quality != null && quality > 0 && cost > 0) {
      entry.costPerQuality = cost / quality;
    }
    return entry;
  });

  const ranked = [...values].sort((a, b) => a.value - b.value);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const absoluteDelta = worst.value - best.value;

  const result: CostComparison = {
    ranked,
    noData,
    bestProfile: best.profile,
    worstProfile: worst.profile,
    absoluteDelta,
  };

  if (best.value > 0) {
    result.ratio = worst.value / best.value;
  }

  // Best cost-per-quality (lowest $/quality-point wins).
  const withCpq = ranked.filter((e) => e.costPerQuality != null);
  if (withCpq.length > 0) {
    const bestCpq = [...withCpq].sort((a, b) => a.costPerQuality! - b.costPerQuality!)[0];
    result.bestCostPerQualityProfile = bestCpq.profile;
  }

  return result;
}

function compareTokens(profiles: ProfileEntry[]): TokenComparison {
  const { source, noData } = profilesWithMetrics(profiles);

  const values = source.map((v) => {
    const tokens = v.result.metrics?.tokens;
    return {
      profile: v.label,
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
    bestProfile: ranked[0].profile,
    worstProfile: ranked[ranked.length - 1].profile,
  };
}

function compareDuration(profiles: ProfileEntry[]): DurationComparison {
  const values = profiles.map((v) => ({
    profile: v.label,
    value: v.result.durationSeconds,
  }));

  const ranked = [...values].sort((a, b) => a.value - b.value);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  return {
    ranked,
    bestProfile: best.profile,
    worstProfile: worst.profile,
    absoluteDelta: worst.value - best.value,
  };
}

function compareCacheEfficiency(profiles: ProfileEntry[]): CacheEfficiencyComparison {
  const { source, noData } = profilesWithMetrics(profiles);

  const values = source.map((v) => {
    const tokens = v.result.metrics?.tokens;
    const inputTokens = tokens?.input ?? 0;
    const cacheRead = tokens?.cacheRead ?? 0;
    const hitRate = inputTokens > 0 ? cacheRead / inputTokens : null;
    return {
      profile: v.label,
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
    bestProfile: ranked[0].profile,
    worstProfile: ranked[ranked.length - 1].profile,
  };
}

function compareAgentBreakdown(profiles: ProfileEntry[]): AgentBreakdownComparison {
  return {
    profiles: profiles.map((v) => {
      if (!v.result.metrics?.agents) {
        return { profile: v.label, value: 'no data' as const };
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
      return { profile: v.label, value: agents };
    }),
  };
}

function compareReviewQuality(profiles: ProfileEntry[]): ReviewQualityComparison {
  return {
    profiles: profiles.map((v) => {
      if (!v.result.metrics?.review) {
        return { profile: v.label, value: 'no data' as const };
      }
      const r = v.result.metrics.review;
      return {
        profile: v.label,
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

function compareToolUsage(profiles: ProfileEntry[]): ToolUsageComparison {
  return {
    profiles: profiles.map((v) => {
      if (!v.result.metrics?.toolUsage) {
        return { profile: v.label, value: 'no data' as const };
      }
      return { profile: v.label, value: v.result.metrics.toolUsage };
    }),
  };
}

// --- Marginal deltas (one-knob attribution) ---

function computeMarginalDeltas(profiles: ProfileEntry[]): MarginalDelta[] {
  const deltas: MarginalDelta[] = [];

  for (const [a, b] of uniquePairs(profiles)) {
    const configA = a.result.profile?.config;
    const configB = b.result.profile?.config;
    if (!configA || !configB) continue;

    const diffs = diffProfileConfigs(configA, configB);
    if (diffs.length !== 1) continue; // only attribute when exactly one knob differs

    const costA = a.result.metrics?.costUsd;
    const costB = b.result.metrics?.costUsd;
    if (costA == null || costB == null) continue;

    const costDelta = costB - costA;
    const delta: MarginalDelta = {
      profileA: a.label,
      profileB: b.label,
      changedKnob: diffs[0],
      costDelta,
    };

    const qualityA = getWeightedQuality(a.result);
    const qualityB = getWeightedQuality(b.result);
    if (qualityA != null && qualityB != null) {
      delta.qualityDelta = qualityB - qualityA;
      if (costDelta !== 0) {
        delta.qualityPerDollar = delta.qualityDelta / costDelta;
      }
    }

    deltas.push(delta);
  }

  return deltas;
}

// --- Archetype rollups (mean across scenarios per archetype) ---

interface ProfileAcc {
  scenarios: number;
  passes: number;
  costSum: number;
  costN: number;
  durationSum: number;
  durationN: number;
  qualitySum: number;
  qualityN: number;
  cpqSum: number;
  cpqN: number;
}

function emptyAcc(): ProfileAcc {
  return {
    scenarios: 0, passes: 0, costSum: 0, costN: 0,
    durationSum: 0, durationN: 0, qualitySum: 0, qualityN: 0, cpqSum: 0, cpqN: 0,
  };
}

function computeArchetypeRollups(groups: ComparisonGroup[]): ArchetypeRollup[] {
  const byArchetype = new Map<string, ComparisonGroup[]>();
  for (const group of groups) {
    if (!group.archetype) continue;
    if (!byArchetype.has(group.archetype)) byArchetype.set(group.archetype, []);
    byArchetype.get(group.archetype)!.push(group);
  }

  const rollups: ArchetypeRollup[] = [];
  for (const [archetype, groupList] of byArchetype) {
    const perProfileAcc = new Map<string, ProfileAcc>();

    const ensure = (label: string): ProfileAcc => {
      if (!perProfileAcc.has(label)) perProfileAcc.set(label, emptyAcc());
      return perProfileAcc.get(label)!;
    };

    for (const group of groupList) {
      const dims = group.dimensions;
      for (const entry of dims.passFail.ranked) {
        const acc = ensure(entry.profile);
        acc.scenarios += 1;
        if (entry.value.passed) acc.passes += 1;
      }
      for (const entry of dims.cost.ranked) {
        const acc = ensure(entry.profile);
        acc.costSum += entry.value;
        acc.costN += 1;
        if (entry.costPerQuality != null) {
          acc.cpqSum += entry.costPerQuality;
          acc.cpqN += 1;
        }
      }
      for (const entry of dims.duration.ranked) {
        const acc = ensure(entry.profile);
        acc.durationSum += entry.value;
        acc.durationN += 1;
      }
      if (dims.quality?.absolute) {
        for (const entry of dims.quality.absolute.ranked) {
          const acc = ensure(entry.profile);
          acc.qualitySum += entry.weighted;
          acc.qualityN += 1;
        }
      }
    }

    const perProfile: ArchetypePerProfile[] = [];
    for (const [profile, acc] of perProfileAcc) {
      const entry: ArchetypePerProfile = {
        profile,
        scenarios: acc.scenarios,
        passes: acc.passes,
        passRate: acc.scenarios > 0 ? acc.passes / acc.scenarios : 0,
        meanDuration: acc.durationN > 0 ? acc.durationSum / acc.durationN : 0,
      };
      if (acc.costN > 0) entry.meanCost = acc.costSum / acc.costN;
      if (acc.qualityN > 0) entry.meanQuality = acc.qualitySum / acc.qualityN;
      if (acc.cpqN > 0) entry.meanCostPerQuality = acc.cpqSum / acc.cpqN;
      perProfile.push(entry);
    }

    const best: ArchetypeRollup['best'] = {};
    const byCost = perProfile.filter((e) => e.meanCost != null).sort((a, b) => a.meanCost! - b.meanCost!);
    if (byCost.length > 0) best.cost = { profile: byCost[0].profile, value: byCost[0].meanCost! };

    const byQuality = perProfile.filter((e) => e.meanQuality != null).sort((a, b) => b.meanQuality! - a.meanQuality!);
    if (byQuality.length > 0) best.quality = { profile: byQuality[0].profile, value: byQuality[0].meanQuality! };

    const byDuration = perProfile.filter((e) => e.meanDuration > 0).sort((a, b) => a.meanDuration - b.meanDuration);
    if (byDuration.length > 0) best.duration = { profile: byDuration[0].profile, value: byDuration[0].meanDuration };

    const byCpq = perProfile.filter((e) => e.meanCostPerQuality != null).sort((a, b) => a.meanCostPerQuality! - b.meanCostPerQuality!);
    if (byCpq.length > 0) best.costPerQuality = { profile: byCpq[0].profile, value: byCpq[0].meanCostPerQuality! };

    if (perProfile.length > 0) {
      const sortedByPass = [...perProfile].sort((a, b) => b.passRate - a.passRate);
      best.passRate = { profile: sortedByPass[0].profile, value: sortedByPass[0].passRate };
    }

    rollups.push({ archetype, scenarioCount: groupList.length, perProfile, best });
  }

  const order = ['errand', 'excursion', 'expedition'];
  rollups.sort((a, b) => {
    const ai = order.indexOf(a.archetype);
    const bi = order.indexOf(b.archetype);
    if (ai === -1 && bi === -1) return a.archetype.localeCompare(b.archetype);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return rollups;
}

// --- Quality comparison ---

/** Generate all unique pairs from an array. */
function* uniquePairs<T>(arr: T[]): Generator<[T, T]> {
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      yield [arr[i], arr[j]];
    }
  }
}

/** Accumulated pairwise usage for summary logging. */
interface PairwiseUsageAccumulator {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

async function compareQuality(
  profiles: ProfileEntry[],
  skipQuality: boolean,
  usageAccumulator: PairwiseUsageAccumulator,
): Promise<QualityComparison | undefined> {
  const DIMENSIONS = ['prdAdherence', 'codeQuality', 'testQuality', 'changeDiscipline'] as const;
  type Dim = typeof DIMENSIONS[number];

  // Build absolute block from existing result.quality.absolute data
  const withAbsolute = profiles.filter((p) => p.result.quality?.absolute != null);
  const noData = profiles.filter((p) => p.result.quality?.absolute == null).map((p) => p.label);
  const hasAbsolute = withAbsolute.length > 0;

  // With --skip-quality, suppress only when there is no pre-existing absolute data
  // to display. Existing data from a prior scored run still surfaces.
  if (skipQuality && !hasAbsolute) {
    return undefined;
  }

  let absoluteBlock: QualityAbsoluteSubBlock | undefined;
  if (hasAbsolute) {
    const entries: QualityAbsoluteEntry[] = withAbsolute.map((p) => {
      const abs = p.result.quality!.absolute!;
      return {
        profile: p.label,
        weighted: abs.overall.weighted,
        dimensions: {
          prdAdherence: abs.dimensions.prdAdherence.score,
          codeQuality: abs.dimensions.codeQuality.score,
          testQuality: abs.dimensions.testQuality.score,
          changeDiscipline: abs.dimensions.changeDiscipline.score,
        },
      };
    });
    entries.sort((a, b) => b.weighted - a.weighted);
    absoluteBlock = {
      ranked: entries,
      bestProfile: entries[0].profile,
      noData,
    };
  }

  // Pairwise: default-on, runs when not skipped AND snapshot files exist
  let pairwiseBlock: QualityPairwiseSubBlock | undefined;
  if (!skipQuality && profiles.length >= 2) {
    const pairs: PairwiseEntry[] = [];
    const summary: Record<Dim, Record<string, number>> = {
      prdAdherence: {},
      codeQuality: {},
      testQuality: {},
      changeDiscipline: {},
    };

    // Initialize win counters
    for (const p of profiles) {
      for (const dim of DIMENSIONS) {
        summary[dim][p.label] = 0;
      }
    }
    for (const dim of DIMENSIONS) {
      summary[dim]['tie'] = 0;
    }

    let judgeConfig;
    try {
      judgeConfig = loadJudgeConfig();
    } catch (err) {
      console.error(`  Quality pairwise scoring skipped: could not load judge config: ${(err as Error).message}`);
      judgeConfig = null;
    }

    if (judgeConfig) {
      for (const [entryA, entryB] of uniquePairs(profiles)) {
        // Both entries must have quality snapshots
        if (!entryA.qualityDir || !entryB.qualityDir) continue;

        const prdPathA = join(entryA.qualityDir, 'prd.md');
        const diffPathA = join(entryA.qualityDir, 'diff.patch');
        const diffPathB = join(entryB.qualityDir, 'diff.patch');

        if (!existsSync(prdPathA) || !existsSync(diffPathA) || !existsSync(diffPathB)) continue;

        try {
          const prd = readFileSync(prdPathA, 'utf8');
          const diffA = readFileSync(diffPathA, 'utf8');
          const diffB = readFileSync(diffPathB, 'utf8');

          const result: PairwiseScoreWithUsage = await scorePairwise({
            prd,
            diffA,
            diffB,
            profileA: entryA.label,
            profileB: entryB.label,
            judgeConfig,
          });

          // Accumulate usage for summary logging
          usageAccumulator.calls += 1;
          usageAccumulator.inputTokens += result._usage.inputTokens;
          usageAccumulator.outputTokens += result._usage.outputTokens;

          // Denormalize winners to profile labels
          const pairEntry: PairwiseEntry = {
            profileA: entryA.label,
            profileB: entryB.label,
            perDimension: {} as PairwiseEntry['perDimension'],
          };

          for (const dim of DIMENSIONS) {
            const dimResult = result.perDimension[dim];
            const winnerLabel =
              dimResult.winner === 'a'
                ? entryA.label
                : dimResult.winner === 'b'
                  ? entryB.label
                  : 'tie';

            (pairEntry.perDimension as Record<string, PairwiseDimResult>)[dim] = {
              winner: winnerLabel,
              justification: dimResult.justification,
            };

            // Update summary counters
            if (summary[dim][winnerLabel] !== undefined) {
              summary[dim][winnerLabel]++;
            } else {
              summary[dim][winnerLabel] = 1;
            }
          }

          pairs.push(pairEntry);
        } catch (err) {
          console.error(`  Pairwise scoring failed for ${entryA.label} vs ${entryB.label}: ${(err as Error).message}`);
        }
      }

      if (pairs.length > 0) {
        pairwiseBlock = {
          pairs,
          summary: { perDimension: summary as Record<string, Record<string, number>> },
        };
      }
    }
  }

  if (!absoluteBlock && !pairwiseBlock) return undefined;

  return {
    ...(absoluteBlock && { absolute: absoluteBlock }),
    ...(pairwiseBlock && { pairwise: pairwiseBlock }),
  };
}

// --- Report builder ---

async function buildComparisonReport(
  runTimestamp: string,
  groups: Map<string, { fixture: string; prd: string; profiles: ProfileEntry[] }>,
  skipQuality: boolean,
  pairwiseUsage: PairwiseUsageAccumulator,
): Promise<ComparisonReport> {
  const comparisonGroups: ComparisonGroup[] = [];

  for (const [groupId, group] of groups) {
    const { profiles } = group;
    const quality = await compareQuality(profiles, skipQuality, pairwiseUsage);
    const archetype = deriveArchetype(groupId, profiles);
    const marginalDeltas = computeMarginalDeltas(profiles);
    comparisonGroups.push({
      groupId,
      fixture: group.fixture,
      prd: group.prd,
      ...(archetype && { archetype }),
      profiles: profiles.map((v) => v.label),
      dimensions: {
        passFail: comparePassFail(profiles),
        cost: compareCost(profiles),
        tokens: compareTokens(profiles),
        duration: compareDuration(profiles),
        cacheEfficiency: compareCacheEfficiency(profiles),
        agentBreakdown: compareAgentBreakdown(profiles),
        reviewQuality: compareReviewQuality(profiles),
        toolUsage: compareToolUsage(profiles),
        ...(quality && { quality }),
      },
      ...(marginalDeltas.length > 0 && { marginalDeltas }),
    });
  }

  const archetypes = computeArchetypeRollups(comparisonGroups);

  return {
    runTimestamp,
    groupCount: comparisonGroups.length,
    groups: comparisonGroups,
    ...(archetypes.length > 0 && { archetypes }),
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
  console.log(`${BOLD}━━━ Profile Comparison ━━━${RESET}`);
  console.log(`${DIM}${report.groupCount} comparison group(s)${RESET}`);
  console.log('');

  for (const group of report.groups) {
    const archetypeStr = group.archetype ? ` ${DIM}[${group.archetype}]${RESET}` : '';
    console.log(`${BOLD}${CYAN}${group.groupId}${RESET}${archetypeStr}`);
    console.log(`${DIM}Profiles: ${group.profiles.join(', ')}${RESET}`);
    console.log(line);

    // Pass/Fail
    console.log(`${BOLD}  Pass/Fail:${RESET}`);
    for (const entry of group.dimensions.passFail.ranked) {
      const icon = entry.value.passed ? `${GREEN}✓ PASS${RESET}` : `${RED}✗ FAIL${RESET}`;
      console.log(`    ${pad(entry.profile, 30)} ${icon}`);
    }

    // Cost
    console.log(`${BOLD}  Cost:${RESET}`);
    for (const entry of group.dimensions.cost.ranked) {
      const isBest = entry.profile === group.dimensions.cost.bestProfile;
      const isBestCpq = entry.profile === group.dimensions.cost.bestCostPerQualityProfile;
      const color = isBest ? GREEN : '';
      const reset = isBest ? RESET : '';
      const cpqStr = entry.costPerQuality != null
        ? `  ${isBestCpq ? GREEN : DIM}$${entry.costPerQuality.toFixed(3)}/Q${RESET}`
        : '';
      console.log(`    ${pad(entry.profile, 30)} ${color}$${entry.value.toFixed(2)}${reset}${cpqStr}`);
    }
    if (group.dimensions.cost.absoluteDelta > 0) {
      const ratioStr = group.dimensions.cost.ratio != null
        ? ` (${group.dimensions.cost.ratio.toFixed(1)}x)`
        : '';
      console.log(`    ${DIM}Δ $${group.dimensions.cost.absoluteDelta.toFixed(2)}${ratioStr}${RESET}`);
    }
    if (group.dimensions.cost.bestCostPerQualityProfile) {
      console.log(`    ${DIM}Best $/Q: ${group.dimensions.cost.bestCostPerQualityProfile}${RESET}`);
    }

    // Tokens
    console.log(`${BOLD}  Tokens:${RESET}`);
    for (const entry of group.dimensions.tokens.ranked) {
      const t = entry.value;
      const isBest = entry.profile === group.dimensions.tokens.bestProfile;
      const color = isBest ? GREEN : '';
      const reset = isBest ? RESET : '';
      console.log(`    ${pad(entry.profile, 30)} ${color}${Math.round(t.total / 1000)}k total${reset} (${Math.round(t.input / 1000)}k in, ${Math.round(t.output / 1000)}k out)`);
    }

    // Duration
    console.log(`${BOLD}  Duration:${RESET}`);
    for (const entry of group.dimensions.duration.ranked) {
      const mins = Math.floor(entry.value / 60);
      const secs = Math.round(entry.value % 60);
      const isBest = entry.profile === group.dimensions.duration.bestProfile;
      const color = isBest ? GREEN : '';
      const reset = isBest ? RESET : '';
      console.log(`    ${pad(entry.profile, 30)} ${color}${mins}m ${secs}s${reset}`);
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
      const isBest = entry.profile === group.dimensions.cacheEfficiency.bestProfile;
      const color = isBest ? GREEN : '';
      const reset = isBest ? RESET : '';
      console.log(`    ${pad(entry.profile, 30)} ${color}${hitStr}${reset}`);
    }

    // Review Quality
    console.log(`${BOLD}  Review Quality:${RESET}`);
    for (const entry of group.dimensions.reviewQuality.profiles) {
      if (entry.value === 'no data') {
        console.log(`    ${pad(entry.profile, 30)} ${DIM}no data${RESET}`);
      } else {
        const v = entry.value;
        console.log(`    ${pad(entry.profile, 30)} ${v.issueCount} issues, ${v.accepted} accepted, ${v.rejected} rejected`);
      }
    }

    // Quality (LLM-as-judge)
    if (group.dimensions.quality) {
      const q = group.dimensions.quality;
      console.log(`${BOLD}  Quality (LLM-as-judge):${RESET}`);

      if (q.absolute) {
        console.log(`    ${DIM}Absolute scores (weighted overall):${RESET}`);
        for (const entry of q.absolute.ranked) {
          const isBest = entry.profile === q.absolute.bestProfile;
          const color = isBest ? GREEN : '';
          const reset = isBest ? RESET : '';
          console.log(
            `    ${pad(entry.profile, 30)} ${color}${entry.weighted.toFixed(2)}${reset}` +
            ` (prd=${entry.dimensions.prdAdherence} code=${entry.dimensions.codeQuality}` +
            ` test=${entry.dimensions.testQuality} disc=${entry.dimensions.changeDiscipline})`,
          );
        }
        if (q.absolute.noData.length > 0) {
          console.log(`    ${DIM}No absolute data: ${q.absolute.noData.join(', ')}${RESET}`);
        }
      }

      if (q.pairwise && q.pairwise.pairs.length > 0) {
        console.log(`    ${DIM}Pairwise results:${RESET}`);
        for (const pair of q.pairwise.pairs) {
          const dims = pair.perDimension;
          const entries = [
            `prd→${dims.prdAdherence.winner}`,
            `code→${dims.codeQuality.winner}`,
            `test→${dims.testQuality.winner}`,
            `disc→${dims.changeDiscipline.winner}`,
          ];
          console.log(`    ${pair.profileA} vs ${pair.profileB}: ${entries.join(', ')}`);
        }
        // Print win summary
        const summary = q.pairwise.summary.perDimension;
        const DIMS_DISPLAY = ['prdAdherence', 'codeQuality', 'testQuality', 'changeDiscipline'];
        console.log(`    ${DIM}Win counts per dimension:${RESET}`);
        for (const dim of DIMS_DISPLAY) {
          if (!summary[dim]) continue;
          const counts = Object.entries(summary[dim])
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');
          console.log(`      ${pad(dim, 20)} ${counts}`);
        }
      }
    }

    // Marginal deltas (one-knob attribution)
    if (group.marginalDeltas && group.marginalDeltas.length > 0) {
      console.log(`${BOLD}  Marginal deltas (one-knob diffs):${RESET}`);
      for (const md of group.marginalDeltas) {
        const oldStr = JSON.stringify(md.changedKnob.oldValue);
        const newStr = JSON.stringify(md.changedKnob.newValue);
        console.log(
          `    ${md.profileA} → ${md.profileB}  ${DIM}[${md.changedKnob.path}: ${oldStr} → ${newStr}]${RESET}`,
        );
        const sign = md.costDelta >= 0 ? '+' : '−';
        console.log(`      Δcost: ${sign}$${Math.abs(md.costDelta).toFixed(2)}`);
        if (md.qualityDelta != null) {
          const qSign = md.qualityDelta >= 0 ? '+' : '−';
          console.log(`      Δquality: ${qSign}${Math.abs(md.qualityDelta).toFixed(2)}`);
          if (md.qualityPerDollar != null) {
            const ppSign = md.qualityPerDollar >= 0 ? '+' : '−';
            console.log(`      Quality per +$1: ${ppSign}${Math.abs(md.qualityPerDollar).toFixed(2)}`);
          }
        }
      }
    }

    console.log('');
  }

  // Archetype rollups (cross-group)
  if (report.archetypes && report.archetypes.length > 0) {
    console.log(`${BOLD}━━━ Archetype rollups ━━━${RESET}`);
    console.log('');
    for (const ar of report.archetypes) {
      console.log(`${BOLD}${CYAN}${ar.archetype}${RESET} ${DIM}(${ar.scenarioCount} scenario${ar.scenarioCount === 1 ? '' : 's'})${RESET}`);
      const b = ar.best;
      if (b.cost) {
        console.log(`  Best mean cost:        ${pad(b.cost.profile, 32)} ${GREEN}$${b.cost.value.toFixed(2)}${RESET}`);
      }
      if (b.quality) {
        console.log(`  Best mean quality:     ${pad(b.quality.profile, 32)} ${GREEN}${b.quality.value.toFixed(2)}${RESET}`);
      }
      if (b.costPerQuality) {
        console.log(`  Best mean $/Q:         ${pad(b.costPerQuality.profile, 32)} ${GREEN}$${b.costPerQuality.value.toFixed(3)}/Q${RESET}`);
      }
      if (b.duration) {
        const mins = Math.floor(b.duration.value / 60);
        const secs = Math.round(b.duration.value % 60);
        console.log(`  Best mean duration:    ${pad(b.duration.profile, 32)} ${GREEN}${mins}m ${secs}s${RESET}`);
      }
      if (b.passRate) {
        console.log(`  Best pass rate:        ${pad(b.passRate.profile, 32)} ${GREEN}${(b.passRate.value * 100).toFixed(0)}%${RESET}`);
      }
      console.log(`  ${DIM}Per-profile means:${RESET}`);
      for (const p of ar.perProfile) {
        const parts: string[] = [`${p.passes}/${p.scenarios} pass`];
        if (p.meanCost != null) parts.push(`$${p.meanCost.toFixed(2)}`);
        if (p.meanQuality != null) parts.push(`Q=${p.meanQuality.toFixed(2)}`);
        if (p.meanCostPerQuality != null) parts.push(`$${p.meanCostPerQuality.toFixed(3)}/Q`);
        const dMins = Math.floor(p.meanDuration / 60);
        const dSecs = Math.round(p.meanDuration % 60);
        parts.push(`${dMins}m ${dSecs}s`);
        console.log(`    ${pad(p.profile, 32)} ${parts.join('  ')}`);
      }
      console.log('');
    }
  }
}

// --- Main ---

async function main(): Promise<void> {
  // Parse args: <run-dir> [--skip-quality]
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
  const runDir = positional[0];
  const skipQuality = flags.includes('--skip-quality');

  if (!runDir) {
    console.error('Usage: npx tsx lib/compare.ts <run-dir> [--skip-quality]');
    process.exit(1);
  }

  const groups = groupByScenario(runDir);

  if (groups.size === 0) {
    // No groups with ≥2 profiles — exit silently
    return;
  }

  // Determine run timestamp from first result or directory name
  let runTimestamp = '';
  for (const group of groups.values()) {
    if (group.profiles.length > 0) {
      runTimestamp = group.profiles[0].result.timestamp;
      break;
    }
  }
  if (!runTimestamp) {
    runTimestamp = new Date().toISOString();
  }

  const pairwiseUsage: PairwiseUsageAccumulator = { calls: 0, inputTokens: 0, outputTokens: 0 };

  const report = await buildComparisonReport(runTimestamp, groups, skipQuality, pairwiseUsage);

  const outputPath = join(runDir, 'comparison.json');
  writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`Wrote ${outputPath} (${report.groupCount} comparison groups)`);

  printComparisonTable(report);

  // Log pairwise usage summary if any pairwise calls were made
  if (pairwiseUsage.calls > 0) {
    const inStr = pairwiseUsage.inputTokens.toLocaleString();
    const outStr = pairwiseUsage.outputTokens.toLocaleString();
    let costStr = '~$0.00';
    try {
      const judgeConfig = loadJudgeConfig();
      costStr = formatCostUsd(
        { inputTokens: pairwiseUsage.inputTokens, outputTokens: pairwiseUsage.outputTokens },
        judgeConfig.pricing,
      );
    } catch {
      // If config can't be loaded, fall back to ~$0.00
    }
    console.log(`pairwise quality scoring: ${pairwiseUsage.calls} call(s), ${inStr} input + ${outStr} output tokens, ${costStr}`);
  }
}

// CLI entry point
if (process.argv[1] && (process.argv[1].endsWith('compare.ts') || process.argv[1].endsWith('compare.js'))) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
