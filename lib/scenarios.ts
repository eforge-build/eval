// Scenario and backend loaders with cross-product expansion.
// Provides typed access to scenarios.yaml, eforge/backends/*.yaml, and
// backend-envs.yaml for TypeScript consumers.

import { readFileSync, readdirSync, existsSync } from 'fs';
import { basename, extname, join } from 'path';
import { parse } from 'yaml';
import type { ScenarioMeta, BackendDef, ExpandedScenario } from './types.js';

/**
 * Load and parse scenarios from a YAML file.
 */
export function loadScenarios(yamlPath: string): ScenarioMeta[] {
  const raw = readFileSync(yamlPath, 'utf8');
  const parsed = parse(raw) as { scenarios?: ScenarioMeta[] };
  if (!Array.isArray(parsed?.scenarios)) {
    throw new Error(`Expected "scenarios" array in ${yamlPath}`);
  }
  return parsed.scenarios;
}

/**
 * Discover available backends by scanning `eforge/backends/*.yaml` in the eval
 * directory and merging env-file mappings from `backend-envs.yaml`.
 *
 * @param backendsDir absolute path to the eval's `eforge/backends/` dir
 * @param envsFile    absolute path to `backend-envs.yaml`
 */
export function loadBackends(backendsDir: string, envsFile: string): BackendDef[] {
  let entries: string[];
  try {
    entries = readdirSync(backendsDir);
  } catch {
    throw new Error(`Backend profiles directory not found: ${backendsDir}`);
  }
  const names = entries
    .filter((f) => extname(f) === '.yaml')
    .map((f) => basename(f, '.yaml'))
    .sort();

  let envMap: Record<string, { envFile?: string }> = {};
  if (existsSync(envsFile)) {
    const raw = readFileSync(envsFile, 'utf8');
    const parsed = parse(raw) as { backends?: Record<string, { envFile?: string }> };
    envMap = parsed?.backends ?? {};
  }

  return names.map((name) => ({ name, envFile: envMap[name]?.envFile }));
}

/**
 * Cross-product scenarios with backends to produce expanded scenarios.
 * Every scenario is paired with every backend.
 */
export function expandScenarioBackends(
  scenarios: ScenarioMeta[],
  backends: BackendDef[],
): ExpandedScenario[] {
  return scenarios.flatMap((s) =>
    backends.map((b) => ({
      id: `${s.id}--${b.name}`,
      scenario: s,
      backend: b,
    })),
  );
}

/**
 * Derive a group ID for grouping backends of the same scenario.
 * Returns the base scenario ID so all backends are grouped together.
 */
export function deriveGroupId(e: ExpandedScenario): string {
  return e.scenario.id;
}
