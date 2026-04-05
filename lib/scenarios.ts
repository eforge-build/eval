// Scenario YAML loader with group ID and variant label derivation.
// Provides typed access to scenarios.yaml for TypeScript consumers.

import { readFileSync } from 'fs';
import { parse } from 'yaml';
import type { ScenarioMeta } from './types.js';

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
 * Derive a group ID from a scenario for grouping variants of the same task.
 * Format: "<fixture>::<prd>"
 */
export function deriveGroupId(s: ScenarioMeta): string {
  return `${s.fixture}::${s.prd}`;
}

/**
 * Derive a human-readable variant label from a scenario.
 *
 * Priority:
 * 1. Explicit `variantLabel` field on the scenario
 * 2. `configOverlay.backend` with optional model suffix when `agents.models.max` is set
 * 3. Falls back to scenario `id`
 */
export function deriveVariantLabel(s: ScenarioMeta): string {
  // Explicit override takes precedence
  if (s.variantLabel) return s.variantLabel;

  if (s.configOverlay) {
    const backend = s.configOverlay.backend;
    const modelId = s.configOverlay.agents?.models?.max?.id;

    if (backend && modelId) {
      return `${backend}/${modelId}`;
    }

    if (backend) {
      return backend;
    }
  }

  return s.id;
}
