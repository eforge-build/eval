#!/usr/bin/env tsx
// Check scenario expectations against orchestration.yaml and monitor.db.
// Usage: npx tsx check-expectations.ts <result.json> <expect-json> <scenario-dir>
//
// Reads orchestration.yaml and monitor.db from scenario-dir, checks expect config,
// and writes an `expectations` key into result.json with pass/fail per check.

process.removeAllListeners('warning');
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { DatabaseSync } from 'node:sqlite';

interface ExpectConfig {
  mode?: string;
  buildStagesContain?: string[];
  buildStagesExclude?: string[];
  skip?: boolean;
}

interface ExpectationResult {
  check: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
}

interface OrchestrationPlanEntry {
  id: string;
  name: string;
  build: Array<string | string[]>;
  [key: string]: unknown;
}

interface OrchestrationData {
  mode: string;
  plans: OrchestrationPlanEntry[];
  [key: string]: unknown;
}

const [, , resultFile, expectJson, scenarioDir] = process.argv;

if (!resultFile || !expectJson || !scenarioDir) {
  console.error('Usage: check-expectations.ts <result.json> <expect-json> <scenario-dir>');
  process.exit(1);
}

// Parse expect config
let expect: ExpectConfig = {};
try {
  expect = JSON.parse(expectJson);
} catch {
  // Empty or malformed — no expectations
}

// If no expectations defined, nothing to check
if (Object.keys(expect).length === 0) {
  process.exit(0);
}

const results: ExpectationResult[] = [];

// Load orchestration.yaml — look for it in the scenario dir (copied there by run-scenario.sh)
let orchestration: OrchestrationData | undefined;
const orchPath = join(scenarioDir, 'orchestration.yaml');
if (existsSync(orchPath)) {
  try {
    orchestration = parseYaml(readFileSync(orchPath, 'utf8')) as OrchestrationData;
  } catch {
    // Malformed orchestration.yaml
  }
}

// Check mode
if (expect.mode !== undefined) {
  const actualMode = orchestration?.mode;
  results.push({
    check: 'mode',
    passed: actualMode === expect.mode,
    expected: expect.mode,
    actual: actualMode ?? null,
  });
}

// Flatten all build stages from all plan entries
function flattenBuildStages(plans: OrchestrationPlanEntry[]): string[] {
  const stages: string[] = [];
  for (const plan of plans) {
    if (!plan.build) continue;
    for (const spec of plan.build) {
      if (Array.isArray(spec)) {
        stages.push(...spec);
      } else {
        stages.push(spec);
      }
    }
  }
  return stages;
}

// Check buildStagesContain
if (expect.buildStagesContain !== undefined) {
  const allStages = orchestration?.plans ? flattenBuildStages(orchestration.plans) : [];
  const uniqueStages = [...new Set(allStages)];
  const missing = expect.buildStagesContain.filter(s => !uniqueStages.includes(s));
  results.push({
    check: 'buildStagesContain',
    passed: missing.length === 0,
    expected: expect.buildStagesContain,
    actual: uniqueStages,
  });
}

// Check buildStagesExclude
if (expect.buildStagesExclude !== undefined) {
  const allStages = orchestration?.plans ? flattenBuildStages(orchestration.plans) : [];
  const uniqueStages = [...new Set(allStages)];
  const found = expect.buildStagesExclude.filter(s => uniqueStages.includes(s));
  results.push({
    check: 'buildStagesExclude',
    passed: found.length === 0,
    expected: expect.buildStagesExclude,
    actual: found.length > 0 ? found : [],
  });
}

// Check skip
if (expect.skip !== undefined) {
  let hasSkipEvent = false;
  const dbPath = join(scenarioDir, 'monitor.db');
  if (existsSync(dbPath)) {
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const tableCheck = db.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='events'`
        ).get() as unknown as { name: string } | undefined;
        if (tableCheck) {
          const row = db.prepare(
            `SELECT COUNT(*) as cnt FROM events WHERE type = 'plan:skip'`
          ).get() as unknown as { cnt: number };
          hasSkipEvent = row.cnt > 0;
        }
      } finally {
        db.close();
      }
    } catch {
      // DB may not exist or be corrupted
    }
  }
  results.push({
    check: 'skip',
    passed: hasSkipEvent === expect.skip,
    expected: expect.skip,
    actual: hasSkipEvent,
  });
}

// Write expectations into result.json
const allPassed = results.every(r => r.passed);
try {
  const resultData = JSON.parse(readFileSync(resultFile, 'utf8'));
  resultData.expectations = {
    passed: allPassed,
    checks: results,
  };
  writeFileSync(resultFile, JSON.stringify(resultData, null, 2) + '\n');
} catch (err) {
  console.error(`Failed to update result.json: ${err}`);
  process.exit(1);
}

// Exit with appropriate code
process.exit(allPassed ? 0 : 1);
