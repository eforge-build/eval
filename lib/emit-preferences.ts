#!/usr/bin/env tsx
// Emit a preferences manifest from a results dir.
// Usage: npx tsx lib/emit-preferences.ts <run-dir> [--criterion=costPerQuality|cost|quality]
//
// Reads <run-dir>/comparison.json, picks the winning profile per archetype by
// the chosen criterion, decomposes its tier-level config, and writes
// <run-dir>/preferences.yaml — input for a future budget-aware picker.

process.removeAllListeners('warning');
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const SCRIPT_DIR = resolve(import.meta.dirname, '..');
const PROFILES_DIR = join(SCRIPT_DIR, 'eforge', 'profiles');

// Minimal subset of comparison.json schema we consume
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
}

interface ComparisonReport {
  runTimestamp: string;
  archetypes?: ArchetypeRollup[];
}

type Criterion = 'costPerQuality' | 'cost' | 'quality';

interface TierConfig {
  runtime: string;
  harness: string;
  effort: string;
  modelClass: string;
  model: string;
}

interface DecomposedConfig {
  planning: TierConfig;
  implementation: TierConfig;
  review: TierConfig;
  evaluation: TierConfig;
}

interface CostFrontierEntry {
  profile: string;
  meanCostUsd: number;
  meanQuality: number;
  meanCostPerQuality: number;
}

interface PreferenceEntry {
  winner: string;
  why: {
    meanCostUsd?: number;
    meanQuality?: number;
    meanCostPerQuality?: number;
    passRate: number;
  };
  config: DecomposedConfig;
}

interface PreferencesManifest {
  sourceRunDir: string;
  sourceRunTimestamp: string;
  criterion: Criterion;
  recommendations: Record<string, PreferenceEntry>;
  costFrontier: Record<string, CostFrontierEntry[]>;
}

const TIER_DEFAULTS: Record<string, { effort: string; modelClass: string }> = {
  planning: { effort: 'high', modelClass: 'max' },
  implementation: { effort: 'medium', modelClass: 'balanced' },
  review: { effort: 'high', modelClass: 'max' },
  evaluation: { effort: 'high', modelClass: 'max' },
};

function pickWinner(
  rollup: ArchetypeRollup,
  criterion: Criterion,
): ArchetypePerProfile | undefined {
  const eligible = rollup.perProfile.filter((p) => p.passes === p.scenarios && p.scenarios > 0);
  // Fall back to the full pool if nothing has a perfect pass rate.
  const pool = eligible.length > 0 ? eligible : rollup.perProfile;
  if (pool.length === 0) return undefined;

  if (criterion === 'cost') {
    const sorted = pool
      .filter((p) => p.meanCost != null)
      .sort((a, b) => a.meanCost! - b.meanCost!);
    return sorted[0];
  }
  if (criterion === 'quality') {
    const sorted = pool
      .filter((p) => p.meanQuality != null)
      .sort((a, b) => b.meanQuality! - a.meanQuality!);
    return sorted[0];
  }
  // costPerQuality (default): lowest $/quality-point wins.
  const sorted = pool
    .filter((p) => p.meanCostPerQuality != null)
    .sort((a, b) => a.meanCostPerQuality! - b.meanCostPerQuality!);
  return sorted[0];
}

function readProfileConfig(profileName: string): Record<string, unknown> {
  const path = join(PROFILES_DIR, `${profileName}.yaml`);
  if (!existsSync(path)) {
    throw new Error(`Profile not found: ${path}`);
  }
  const raw = readFileSync(path, 'utf8');
  const parsed = parseYaml(raw);
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
}

function decomposeProfile(config: Record<string, unknown>): DecomposedConfig {
  const defaultRuntime = (config.defaultAgentRuntime as string | undefined) ?? 'default';
  const runtimes = (config.agentRuntimes ?? {}) as Record<string, { harness?: string }>;
  const agents = (config.agents ?? {}) as Record<string, unknown>;
  const tiersConfig = (agents.tiers ?? {}) as Record<
    string,
    { effort?: string; modelClass?: string; model?: { id?: string } }
  >;
  const modelsConfig = (agents.models ?? {}) as Record<string, { id?: string }>;

  const tierResult: Record<string, TierConfig> = {};
  for (const tier of ['planning', 'implementation', 'review', 'evaluation']) {
    const tCfg = tiersConfig[tier] ?? {};
    const defaults = TIER_DEFAULTS[tier];
    const effort = tCfg.effort ?? defaults.effort;
    const modelClass = tCfg.modelClass ?? defaults.modelClass;
    const model = tCfg.model?.id ?? modelsConfig[modelClass]?.id ?? 'unknown';
    const harness = runtimes[defaultRuntime]?.harness ?? 'unknown';
    tierResult[tier] = { runtime: defaultRuntime, harness, effort, modelClass, model };
  }
  return tierResult as unknown as DecomposedConfig;
}

function buildCostFrontier(rollup: ArchetypeRollup): CostFrontierEntry[] {
  const entries: CostFrontierEntry[] = [];
  for (const p of rollup.perProfile) {
    if (p.meanCost != null && p.meanQuality != null && p.meanCostPerQuality != null) {
      entries.push({
        profile: p.profile,
        meanCostUsd: round(p.meanCost, 2),
        meanQuality: round(p.meanQuality, 2),
        meanCostPerQuality: round(p.meanCostPerQuality, 3),
      });
    }
  }
  entries.sort((a, b) => a.meanCostUsd - b.meanCostUsd);
  return entries;
}

function round(n: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function emitPreferences(runDir: string, criterion: Criterion): PreferencesManifest {
  const compPath = join(runDir, 'comparison.json');
  if (!existsSync(compPath)) {
    throw new Error(`comparison.json not found at ${compPath}. Run compare.ts on this run dir first.`);
  }

  const report = JSON.parse(readFileSync(compPath, 'utf8')) as ComparisonReport;
  if (!report.archetypes || report.archetypes.length === 0) {
    throw new Error(
      'No archetype rollups in comparison.json. Re-run compare.ts on a results dir with multi-profile groups so archetypes are derived.',
    );
  }

  const recommendations: Record<string, PreferenceEntry> = {};
  const costFrontier: Record<string, CostFrontierEntry[]> = {};

  for (const ar of report.archetypes) {
    const winner = pickWinner(ar, criterion);
    if (!winner) {
      console.warn(`  Skip archetype ${ar.archetype}: no winner under criterion ${criterion}.`);
      continue;
    }
    let config: DecomposedConfig;
    try {
      const profileConfig = readProfileConfig(winner.profile);
      config = decomposeProfile(profileConfig);
    } catch (err) {
      console.warn(`  Skip archetype ${ar.archetype}: cannot read profile ${winner.profile} (${(err as Error).message}).`);
      continue;
    }

    const why: PreferenceEntry['why'] = { passRate: round(winner.passRate, 2) };
    if (winner.meanCost != null) why.meanCostUsd = round(winner.meanCost, 2);
    if (winner.meanQuality != null) why.meanQuality = round(winner.meanQuality, 2);
    if (winner.meanCostPerQuality != null) why.meanCostPerQuality = round(winner.meanCostPerQuality, 3);

    recommendations[ar.archetype] = { winner: winner.profile, why, config };
    costFrontier[ar.archetype] = buildCostFrontier(ar);
  }

  return {
    sourceRunDir: runDir,
    sourceRunTimestamp: report.runTimestamp,
    criterion,
    recommendations,
    costFrontier,
  };
}

function parseCriterion(arg: string | undefined): Criterion {
  const v = arg?.split('=')[1];
  if (v === 'cost' || v === 'quality' || v === 'costPerQuality') return v;
  return 'costPerQuality';
}

async function main(): Promise<void> {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
  const runDir = positional[0];
  const criterionFlag = flags.find((f) => f.startsWith('--criterion'));

  if (!runDir) {
    console.error('Usage: npx tsx lib/emit-preferences.ts <run-dir> [--criterion=costPerQuality|cost|quality]');
    process.exit(1);
  }

  const criterion = parseCriterion(criterionFlag);
  const manifest = emitPreferences(runDir, criterion);

  const yamlOut = stringifyYaml(manifest);
  const outPath = join(runDir, 'preferences.yaml');
  writeFileSync(outPath, yamlOut);

  console.log(`Wrote ${outPath}`);
  console.log(`  Source: ${manifest.sourceRunDir} (${manifest.sourceRunTimestamp})`);
  console.log(`  Criterion: ${manifest.criterion}`);
  const archetypes = Object.keys(manifest.recommendations);
  console.log(`  Archetypes covered: ${archetypes.length > 0 ? archetypes.join(', ') : 'none'}`);
  for (const arch of archetypes) {
    const rec = manifest.recommendations[arch];
    console.log(`    ${arch} → ${rec.winner}`);
  }
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith('emit-preferences.ts') || process.argv[1].endsWith('emit-preferences.js'))
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
