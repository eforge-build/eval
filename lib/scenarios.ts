// Scenario YAML loader with group ID, variant label derivation, and matrix expansion.
// Provides typed access to scenarios.yaml for TypeScript consumers.

import { readFileSync } from 'fs';
import { parse } from 'yaml';
import type { ScenarioMeta } from './types.js';

/**
 * Deep merge two plain objects. Arrays are replaced (not concatenated).
 * Returns a new object without mutating inputs.
 */
function deepMerge<T extends Record<string, unknown>>(base: T, override: Record<string, unknown>): T {
  const result = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(override)) {
    const baseVal = result[key];
    const overVal = override[key];
    if (
      baseVal != null &&
      overVal != null &&
      typeof baseVal === 'object' &&
      typeof overVal === 'object' &&
      !Array.isArray(baseVal) &&
      !Array.isArray(overVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overVal as Record<string, unknown>,
      );
    } else {
      result[key] = overVal;
    }
  }
  return result as T;
}

/**
 * Expand matrix entries into a flat list of scenarios.
 * Scenarios without a matrix field pass through unchanged.
 */
export function expandMatrix(scenarios: ScenarioMeta[]): ScenarioMeta[] {
  return scenarios.flatMap((s) => {
    if (!s.matrix || s.matrix.length === 0) return [s];
    return s.matrix.map((variant) => ({
      ...s,
      id: `${s.id}--${variant.variantLabel}`,
      variantLabel: variant.variantLabel,
      compareGroup: s.compareGroup ?? s.id,
      envFile: variant.envFile ?? s.envFile,
      expect: variant.expect ?? s.expect,
      validate: variant.validate ?? s.validate,
      configOverlay: deepMerge(s.configOverlay ?? {}, variant.configOverlay ?? {}) as ScenarioMeta['configOverlay'],
      matrix: undefined,
    }));
  });
}

/**
 * Load and parse scenarios from a YAML file, expanding matrix entries.
 */
export function loadScenarios(yamlPath: string): ScenarioMeta[] {
  const raw = readFileSync(yamlPath, 'utf8');
  const parsed = parse(raw) as { scenarios?: ScenarioMeta[] };
  if (!Array.isArray(parsed?.scenarios)) {
    throw new Error(`Expected "scenarios" array in ${yamlPath}`);
  }
  return expandMatrix(parsed.scenarios);
}

/**
 * Derive a group ID from a scenario for grouping variants of the same task.
 * Format: "<fixture>::<prd>"
 */
export function deriveGroupId(s: ScenarioMeta): string {
  if (s.compareGroup) return s.compareGroup;
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
      const strippedModelId = modelId.includes('/') ? modelId.split('/').pop()! : modelId;
      return `${backend}/${strippedModelId}`;
    }

    if (backend) {
      return backend;
    }
  }

  return s.id;
}
