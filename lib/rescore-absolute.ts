#!/usr/bin/env tsx
// Re-runs absolute quality scoring for scenarios in a results dir
// that are missing quality.absolute (e.g. when judge calls failed mid-run).
// Reuses snapshots in <scenarioDir>/quality/{prd.md,diff.patch}; no eforge re-run.
//
// Usage: npx tsx lib/rescore-absolute.ts <results-dir>

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { loadJudgeConfig, scoreAbsolute, mergeQualityIntoResult } from './score-quality.js';

interface ResultJson {
  validation?: Record<string, { passed: boolean }>;
  quality?: { absolute?: unknown };
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: npx tsx lib/rescore-absolute.ts <results-dir>');
    process.exit(1);
  }

  const root = resolve(dir);
  if (!existsSync(root)) {
    console.error(`Results dir not found: ${root}`);
    process.exit(1);
  }

  const entries = readdirSync(root, { withFileTypes: true });
  const judgeConfig = loadJudgeConfig();

  let scored = 0;
  let skipped = 0;
  let failed = 0;

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const scenarioDir = join(root, e.name);
    const resultPath = join(scenarioDir, 'result.json');
    if (!existsSync(resultPath)) continue;

    let result: ResultJson;
    try {
      result = JSON.parse(readFileSync(resultPath, 'utf8')) as ResultJson;
    } catch {
      continue;
    }

    if (result.quality?.absolute) {
      console.log(`SKIP ${e.name} (already scored)`);
      skipped++;
      continue;
    }

    const prdPath = join(scenarioDir, 'quality/prd.md');
    const diffPath = join(scenarioDir, 'quality/diff.patch');
    if (!existsSync(prdPath) || !existsSync(diffPath)) {
      console.log(`SKIP ${e.name} (no snapshots)`);
      skipped++;
      continue;
    }

    const prd = readFileSync(prdPath, 'utf8');
    const diff = readFileSync(diffPath, 'utf8');
    const validation = Object.fromEntries(
      Object.entries(result.validation ?? {}).map(([k, v]) => [k, { passed: v.passed }]),
    );

    console.log(`SCORE ${e.name}`);
    try {
      const absolute = await scoreAbsolute({ prd, diffPatch: diff, validation, judgeConfig });
      mergeQualityIntoResult(resultPath, { absolute });
      const d = absolute.dimensions;
      console.log(
        `  → prd=${d.prdAdherence.score} code=${d.codeQuality.score} test=${d.testQuality.score} disc=${d.changeDiscipline.score} → ${absolute.overall.weighted.toFixed(2)}`,
      );
      scored++;
    } catch (err) {
      console.error(`  ✗ ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(`\nDone: scored=${scored}, skipped=${skipped}, failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
