#!/usr/bin/env tsx
// Build a cross-run history index from results directories.
// Usage: npx tsx lib/history.ts <results-dir>
//
// Scans timestamped subdirectories for summary.json files and writes
// results/history.json with a runs array ordered by timestamp.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';

export interface HistoryEntry {
  timestamp: string;
  eforgeVersion: string;
  eforgeCommit: string;
  passed: number;
  total: number;
  costUsd: number;
}

export interface History {
  runs: HistoryEntry[];
}

/**
 * Build a History object by scanning a results directory for timestamped
 * run subdirectories containing summary.json files.
 */
export function buildHistory(resultsDir: string): History {
  const runs: HistoryEntry[] = [];

  if (!existsSync(resultsDir)) {
    return { runs };
  }

  const entries = readdirSync(resultsDir, { withFileTypes: true });

  // Timestamped directories match pattern like 2024-01-15T12-30-00
  const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!timestampPattern.test(entry.name)) continue;

    const summaryPath = join(resultsDir, entry.name, 'summary.json');
    if (!existsSync(summaryPath)) continue;

    try {
      const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));

      // Extract eforgeCommit from the first scenario that has one
      let eforgeCommit = '';
      if (Array.isArray(summary.scenarios)) {
        for (const s of summary.scenarios) {
          if (s.eforgeCommit) {
            eforgeCommit = s.eforgeCommit;
            break;
          }
        }
      }

      // Compute total cost from scenario metrics
      let costUsd = 0;
      if (summary.totals && summary.totals.costUsd != null) {
        costUsd = summary.totals.costUsd;
      }

      runs.push({
        timestamp: summary.timestamp ?? entry.name,
        eforgeVersion: summary.eforgeVersion ?? 'unknown',
        eforgeCommit,
        passed: summary.passed ?? 0,
        total: summary.totalScenarios ?? 0,
        costUsd,
      });
    } catch {
      // Skip malformed summary files
    }
  }

  // Sort by timestamp ascending (oldest first)
  runs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return { runs };
}

// CLI entry point
if (process.argv[1] && (process.argv[1].endsWith('history.ts') || process.argv[1].endsWith('history.js'))) {
  const resultsDir = process.argv[2];

  if (!resultsDir) {
    console.error('Usage: npx tsx lib/history.ts <results-dir>');
    process.exit(1);
  }

  const history = buildHistory(resultsDir);
  const outputPath = join(resultsDir, 'history.json');
  writeFileSync(outputPath, JSON.stringify(history, null, 2) + '\n');
  console.log(`Wrote ${outputPath} (${history.runs.length} runs)`);
}
