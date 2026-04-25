// Scenario and profile loaders with cross-product expansion.
// Provides typed access to scenarios.yaml, eforge/profiles/*.yaml, and
// profile-envs.yaml for TypeScript consumers.

import { readFileSync, readdirSync, existsSync } from 'fs';
import { basename, extname, join } from 'path';
import { parse } from 'yaml';
import type { ScenarioMeta, ProfileDef, ExpandedScenario } from './types.js';

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
 * Discover available profiles by scanning `eforge/profiles/*.yaml` in the eval
 * directory and merging env-file mappings from `profile-envs.yaml`.
 *
 * Accepts both `envFiles: [...]` and `envFile: <single>` in the envs file,
 * normalising both shapes to `envFiles: string[]`.
 *
 * @param profilesDir absolute path to the eval's `eforge/profiles/` dir
 * @param envsFile    absolute path to `profile-envs.yaml`
 */
export function loadProfiles(profilesDir: string, envsFile: string): ProfileDef[] {
  let entries: string[];
  try {
    entries = readdirSync(profilesDir);
  } catch {
    throw new Error(`Profile directory not found: ${profilesDir}`);
  }
  const names = entries
    .filter((f) => extname(f) === '.yaml')
    .map((f) => basename(f, '.yaml'))
    .sort();

  let envMap: Record<string, { envFile?: string; envFiles?: string[] }> = {};
  if (existsSync(envsFile)) {
    const raw = readFileSync(envsFile, 'utf8');
    const parsed = parse(raw) as { profiles?: Record<string, { envFile?: string; envFiles?: string[] }> };
    envMap = parsed?.profiles ?? {};
  }

  return names.map((name) => {
    const entry = envMap[name];
    let envFiles: string[] | undefined;
    if (entry?.envFiles && entry.envFiles.length > 0) {
      envFiles = entry.envFiles;
    } else if (entry?.envFile) {
      envFiles = [entry.envFile];
    }
    return { name, ...(envFiles && { envFiles }) };
  });
}

/**
 * Cross-product scenarios with profiles to produce expanded scenarios.
 * Every scenario is paired with every profile.
 */
export function expandScenarioProfiles(
  scenarios: ScenarioMeta[],
  profiles: ProfileDef[],
): ExpandedScenario[] {
  return scenarios.flatMap((s) =>
    profiles.map((p) => ({
      id: `${s.id}--${p.name}`,
      scenario: s,
      profile: p,
    })),
  );
}

/**
 * Derive a group ID for grouping profiles of the same scenario.
 * Returns the base scenario ID so all profiles are grouped together.
 */
export function deriveGroupId(e: ExpandedScenario): string {
  return e.scenario.id;
}
