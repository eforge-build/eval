#!/usr/bin/env tsx
// Check scenario expectations against monitor DB events.
// Usage: npx tsx check-expectations.ts <result.json> <expect-json> <scenario-dir> <monitor-db-path>
//
// Reads plan:pipeline and plan:skip events from the shared monitor DB,
// checks expect config, and writes an `expectations` key into result.json.

process.removeAllListeners('warning');
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import { type ExpectationCheck } from './types.js';

export interface ExpectConfig {
  mode?: string;
  buildStagesContain?: string[];
  buildStagesExclude?: string[];
  skip?: boolean;
}

export interface ExpectationsResult {
  passed: boolean;
  checks: ExpectationCheck[];
}

export interface CheckExpectOpts {
  resultFile: string;
  expectConfig: ExpectConfig;
  monitorDbPath: string;
  runIds: string[];
}

interface PipelineEvent {
  scope: string;
  defaultBuild: Array<string | string[]>;
}

/**
 * Read plan:pipeline event from monitor DB for the given run IDs.
 */
function readPipelineEvent(dbPath: string, runIds: string[]): PipelineEvent | undefined {
  if (!existsSync(dbPath)) return undefined;

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return undefined;
  }

  try {
    const tableCheck = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='events'`,
    ).get() as unknown as { name: string } | undefined;
    if (!tableCheck) return undefined;

    const hasFilter = runIds.length > 0;
    const placeholders = runIds.map(() => '?').join(', ');
    const runFilter = hasFilter ? `AND run_id IN (${placeholders})` : '';

    const stmt = db.prepare(
      `SELECT data FROM events WHERE type = 'plan:pipeline' ${runFilter} LIMIT 1`,
    );
    const row = (hasFilter ? stmt.get(...runIds) : stmt.get()) as unknown as { data: string } | undefined;
    if (!row) return undefined;

    return JSON.parse(row.data) as PipelineEvent;
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

/**
 * Check whether a plan:skip event exists in the monitor DB.
 */
function hasSkipEvent(dbPath: string, runIds: string[]): boolean {
  if (!existsSync(dbPath)) return false;

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return false;
  }

  try {
    const tableCheck = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='events'`,
    ).get() as unknown as { name: string } | undefined;
    if (!tableCheck) return false;

    const hasFilter = runIds.length > 0;
    const placeholders = runIds.map(() => '?').join(', ');
    const runFilter = hasFilter ? `AND run_id IN (${placeholders})` : '';

    const stmt = db.prepare(
      `SELECT COUNT(*) as cnt FROM events WHERE type = 'plan:skip' ${runFilter}`,
    );
    const row = (hasFilter ? stmt.get(...runIds) : stmt.get()) as unknown as { cnt: number };
    return row.cnt > 0;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

/**
 * Flatten build stages from a defaultBuild array (which may contain nested arrays
 * for parallel stages).
 */
function flattenBuildStages(defaultBuild: Array<string | string[]>): string[] {
  const stages: string[] = [];
  for (const spec of defaultBuild) {
    if (Array.isArray(spec)) {
      stages.push(...spec);
    } else {
      stages.push(spec);
    }
  }
  return stages;
}

/**
 * Check scenario expectations and write results into result.json.
 * Returns the expectations result.
 */
export function checkExpectations(opts: CheckExpectOpts): ExpectationsResult {
  const { resultFile, expectConfig, monitorDbPath, runIds } = opts;

  if (Object.keys(expectConfig).length === 0) {
    return { passed: true, checks: [] };
  }

  const checks: ExpectationCheck[] = [];
  const pipeline = readPipelineEvent(monitorDbPath, runIds);

  // Check mode
  if (expectConfig.mode !== undefined) {
    const actualMode = pipeline?.scope ?? null;
    checks.push({
      check: 'mode',
      passed: actualMode === expectConfig.mode,
      expected: expectConfig.mode,
      actual: actualMode,
    });
  }

  // Check buildStagesContain
  if (expectConfig.buildStagesContain !== undefined) {
    const allStages = pipeline?.defaultBuild ? flattenBuildStages(pipeline.defaultBuild) : [];
    const uniqueStages = [...new Set(allStages)];
    const missing = expectConfig.buildStagesContain.filter(s => !uniqueStages.includes(s));
    checks.push({
      check: 'buildStagesContain',
      passed: missing.length === 0,
      expected: expectConfig.buildStagesContain,
      actual: uniqueStages,
    });
  }

  // Check buildStagesExclude
  if (expectConfig.buildStagesExclude !== undefined) {
    const allStages = pipeline?.defaultBuild ? flattenBuildStages(pipeline.defaultBuild) : [];
    const uniqueStages = [...new Set(allStages)];
    const found = expectConfig.buildStagesExclude.filter(s => uniqueStages.includes(s));
    checks.push({
      check: 'buildStagesExclude',
      passed: found.length === 0,
      expected: expectConfig.buildStagesExclude,
      actual: found.length > 0 ? found : [],
    });
  }

  // Check skip
  if (expectConfig.skip !== undefined) {
    const skipped = hasSkipEvent(monitorDbPath, runIds);
    checks.push({
      check: 'skip',
      passed: skipped === expectConfig.skip,
      expected: expectConfig.skip,
      actual: skipped,
    });
  }

  const allPassed = checks.every(r => r.passed);
  const result: ExpectationsResult = { passed: allPassed, checks };

  try {
    const resultData = JSON.parse(readFileSync(resultFile, 'utf8'));
    resultData.expectations = result;
    writeFileSync(resultFile, JSON.stringify(resultData, null, 2) + '\n');
  } catch (err) {
    throw new Error(`Failed to update result.json: ${err}`);
  }

  return result;
}

// CLI entry point
if (process.argv[1] && (process.argv[1].endsWith('check-expectations.ts') || process.argv[1].endsWith('check-expectations.js'))) {
  const [, , resultFile, expectJson, monitorDbPath, ...runIdArgs] = process.argv;

  if (!resultFile || !expectJson || !monitorDbPath) {
    console.error('Usage: check-expectations.ts <result.json> <expect-json> <monitor-db-path> [run-id...]');
    process.exit(1);
  }

  let expectConfig: ExpectConfig = {};
  try {
    expectConfig = JSON.parse(expectJson);
  } catch {
    // Empty or malformed — no expectations
  }

  const result = checkExpectations({ resultFile, expectConfig, monitorDbPath, runIds: runIdArgs });
  process.exit(result.passed ? 0 : 1);
}
