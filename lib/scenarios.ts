// Scenario and variant loaders with cross-product expansion.
// Provides typed access to scenarios.yaml and variants.yaml for TypeScript consumers.

import { readFileSync } from 'fs';
import { parse } from 'yaml';
import type { ScenarioMeta, VariantDef, ExpandedScenario } from './types.js';

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
 * Load and parse variant definitions from a YAML file.
 * The YAML uses a map keyed by variant name; each value becomes a VariantDef
 * with the `name` field populated from the key.
 */
export function loadVariants(yamlPath: string): VariantDef[] {
  const raw = readFileSync(yamlPath, 'utf8');
  const parsed = parse(raw) as { variants?: Record<string, Omit<VariantDef, 'name'>> };
  if (!parsed?.variants || typeof parsed.variants !== 'object') {
    throw new Error(`Expected "variants" map in ${yamlPath}`);
  }
  return Object.entries(parsed.variants).map(([name, def]) => ({
    name,
    ...def,
  }));
}

/**
 * Cross-product scenarios with variants to produce expanded scenarios.
 * Every scenario is paired with every variant.
 */
export function expandScenarioVariants(
  scenarios: ScenarioMeta[],
  variants: VariantDef[],
): ExpandedScenario[] {
  return scenarios.flatMap((s) =>
    variants.map((v) => ({
      id: `${s.id}--${v.name}`,
      scenario: s,
      variant: v,
    })),
  );
}

/**
 * Derive a group ID for grouping variants of the same scenario.
 * Returns the base scenario ID so all variants are grouped together.
 */
export function deriveGroupId(e: ExpandedScenario): string {
  return e.scenario.id;
}

