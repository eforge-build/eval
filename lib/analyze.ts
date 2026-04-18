#!/usr/bin/env tsx
// Pattern detection across scenario results within a single eval run.
// Usage: npx tsx lib/analyze.ts <run-dir>
//
// Reads all result.json files from subdirectories of the run directory,
// runs four pattern detectors, and writes analysis.json alongside summary.json.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { buildHistory, type History } from './history.js';
import { type ScenarioResult, type Observation, type Trend, type AnalysisReport } from './types.js';

// --- Detectors ---

/**
 * Review Calibration Detector
 *
 * Flags:
 * - High reject ratio (> 0.5) across all scenarios
 * - Severity concentration (> 80% of issues share one severity)
 * - Scenarios with zero review issues
 */
function detectReviewCalibration(results: ScenarioResult[]): Observation[] {
  const observations: Observation[] = [];

  // Aggregate review stats across all scenarios
  let totalAccepted = 0;
  let totalRejected = 0;
  let totalIssueCount = 0;
  const allSeverityCounts: Record<string, number> = {};

  for (const r of results) {
    if (!r.metrics) continue;
    totalAccepted += r.metrics.review.accepted;
    totalRejected += r.metrics.review.rejected;
    totalIssueCount += r.metrics.review.issueCount;
    for (const [sev, count] of Object.entries(r.metrics.review.bySeverity)) {
      allSeverityCounts[sev] = (allSeverityCounts[sev] ?? 0) + count;
    }
  }

  // High reject ratio
  const totalEvaluated = totalAccepted + totalRejected;
  if (totalEvaluated > 0) {
    const rejectRatio = totalRejected / totalEvaluated;
    if (rejectRatio > 0.5) {
      observations.push({
        detector: 'review-calibration',
        signal: 'high-reject-ratio',
        severity: 'warning',
        value: rejectRatio,
        context: { accepted: totalAccepted, rejected: totalRejected },
        message: `Reject ratio ${(rejectRatio * 100).toFixed(0)}% exceeds 50% threshold (${totalRejected}/${totalEvaluated} evaluations rejected)`,
      });
    }
  }

  // Severity concentration
  if (totalIssueCount > 0) {
    const severityEntries = Object.entries(allSeverityCounts);
    for (const [sev, count] of severityEntries) {
      const ratio = count / totalIssueCount;
      if (ratio > 0.8) {
        observations.push({
          detector: 'review-calibration',
          signal: 'severity-concentration',
          severity: 'warning',
          value: ratio,
          context: { severity: sev, count, totalIssueCount },
          message: `${(ratio * 100).toFixed(0)}% of review issues are severity "${sev}" — review criteria may lack granularity`,
        });
      }
    }
  }

  // Scenarios with zero review issues
  for (const r of results) {
    if (!r.metrics) continue;
    // Only flag if eforge ran successfully (exit 0) and there are no review issues
    if (r.eforgeExitCode === 0 && r.metrics.review.issueCount === 0) {
      observations.push({
        detector: 'review-calibration',
        signal: 'zero-review-issues',
        severity: 'info',
        value: 0,
        context: { scenario: r.scenario },
        message: `Scenario "${r.scenario}" produced zero review issues — review stage may have been skipped or criteria too lenient`,
      });
    }
  }

  return observations;
}

/**
 * Cost Efficiency Detector
 *
 * Flags:
 * - Any single agent consuming > 40% of total cost
 * - Agents with cache hit rate below 20%
 */
function detectCostEfficiency(results: ScenarioResult[]): Observation[] {
  const observations: Observation[] = [];

  // Aggregate per-agent costs across all scenarios
  const agentAgg: Record<string, { costUsd: number; inputTokens: number; cacheRead: number }> = {};
  let totalCost = 0;

  for (const r of results) {
    if (!r.metrics) continue;
    totalCost += r.metrics.costUsd;
    for (const [agent, agg] of Object.entries(r.metrics.agents)) {
      if (!agentAgg[agent]) {
        agentAgg[agent] = { costUsd: 0, inputTokens: 0, cacheRead: 0 };
      }
      agentAgg[agent].costUsd += agg.costUsd;
      agentAgg[agent].inputTokens += agg.inputTokens;
      agentAgg[agent].cacheRead += agg.cacheRead;
    }
  }

  if (totalCost > 0) {
    for (const [agent, agg] of Object.entries(agentAgg)) {
      const costRatio = agg.costUsd / totalCost;
      if (costRatio > 0.4) {
        observations.push({
          detector: 'cost-efficiency',
          signal: 'agent-cost-dominance',
          severity: 'warning',
          value: costRatio,
          context: { agent, agentCost: agg.costUsd, totalCost },
          message: `Agent "${agent}" consumes ${(costRatio * 100).toFixed(0)}% of total cost ($${agg.costUsd.toFixed(2)} / $${totalCost.toFixed(2)})`,
        });
      }
    }
  }

  // Cache hit rate check
  for (const [agent, agg] of Object.entries(agentAgg)) {
    if (agg.inputTokens > 0) {
      const cacheHitRate = agg.cacheRead / agg.inputTokens;
      if (cacheHitRate < 0.2) {
        observations.push({
          detector: 'cost-efficiency',
          signal: 'low-cache-hit-rate',
          severity: 'info',
          value: cacheHitRate,
          context: { agent, inputTokens: agg.inputTokens, cacheRead: agg.cacheRead },
          message: `Agent "${agent}" cache hit rate is ${(cacheHitRate * 100).toFixed(0)}% (below 20% threshold) — prompt caching may be underutilized`,
        });
      }
    }
  }

  return observations;
}

/**
 * Profile Selection Detector
 *
 * Flags expectation mismatches where the mode check failed.
 */
function detectProfileSelection(results: ScenarioResult[]): Observation[] {
  const observations: Observation[] = [];

  for (const r of results) {
    if (!r.expectations?.checks) continue;
    for (const check of r.expectations.checks) {
      if (!check.passed) {
        let message: string;
        switch (check.check) {
          case 'mode':
            message = `Scenario "${r.scenario}": selected mode "${check.actual}" (expected "${check.expected}")`;
            break;
          case 'buildStagesContain':
            message = `Scenario "${r.scenario}": missing expected build stages ${JSON.stringify(check.expected)} (present: ${JSON.stringify(check.actual)})`;
            break;
          case 'buildStagesExclude':
            message = `Scenario "${r.scenario}": build includes excluded stages ${JSON.stringify(check.actual)}`;
            break;
          case 'skip':
            message = `Scenario "${r.scenario}": expected skip=${JSON.stringify(check.expected)}, actual skip=${JSON.stringify(check.actual)}`;
            break;
          default:
            message = `Scenario "${r.scenario}" expectation "${check.check}": expected ${JSON.stringify(check.expected)}, actual ${JSON.stringify(check.actual)}`;
        }
        observations.push({
          detector: 'profile-selection',
          signal: 'expectation-mismatch',
          severity: 'attention',
          value: `${check.expected}`,
          context: { scenario: r.scenario, check: check.check, expected: check.expected, actual: check.actual },
          message,
        });
      }
    }
  }

  return observations;
}

/**
 * Temporal Regression Detector
 *
 * Compares current run pass rate and cost against the previous run from history.
 */
function detectTemporalRegression(results: ScenarioResult[], history: History): Observation[] {
  const observations: Observation[] = [];

  if (history.runs.length === 0) return observations;

  // The most recent entry in history is the "previous" run
  // (because the current run may not be in history yet)
  const previousRun = history.runs[history.runs.length - 1];

  // Current run stats
  const currentTotal = results.length;
  const currentPassed = results.filter(r => {
    const eforgeOk = r.eforgeExitCode === 0;
    const validateOk = Object.values(r.validation || {}).every(v => v.passed);
    return eforgeOk && validateOk;
  }).length;
  const currentPassRate = currentTotal > 0 ? currentPassed / currentTotal : 0;
  const previousPassRate = previousRun.total > 0 ? previousRun.passed / previousRun.total : 0;

  const passRateDelta = currentPassRate - previousPassRate;

  const trends: { metric: string; current: number; previous: number; delta: number; message: string }[] = [];

  trends.push({
    metric: 'passRate',
    current: currentPassRate,
    previous: previousPassRate,
    delta: passRateDelta,
    message: `Pass rate ${passRateDelta >= 0 ? 'improved' : 'regressed'}: ${(currentPassRate * 100).toFixed(0)}% vs ${(previousPassRate * 100).toFixed(0)}% previous`,
  });

  if (passRateDelta < 0) {
    observations.push({
      detector: 'temporal-regression',
      signal: 'pass-rate-regression',
      severity: 'attention',
      value: passRateDelta,
      context: { currentPassed, currentTotal, previousPassed: previousRun.passed, previousTotal: previousRun.total },
      message: `Pass rate regressed from ${(previousPassRate * 100).toFixed(0)}% to ${(currentPassRate * 100).toFixed(0)}%`,
    });
  }

  // Cost comparison
  let currentCost = 0;
  for (const r of results) {
    if (r.metrics) currentCost += r.metrics.costUsd;
  }

  if (previousRun.costUsd > 0) {
    const costDelta = currentCost - previousRun.costUsd;
    const costChangeRatio = costDelta / previousRun.costUsd;

    trends.push({
      metric: 'costUsd',
      current: currentCost,
      previous: previousRun.costUsd,
      delta: costDelta,
      message: `Cost ${costDelta >= 0 ? 'increased' : 'decreased'}: $${currentCost.toFixed(2)} vs $${previousRun.costUsd.toFixed(2)} previous (${costChangeRatio >= 0 ? '+' : ''}${(costChangeRatio * 100).toFixed(0)}%)`,
    });

    // Flag significant cost increase (> 20%)
    if (costChangeRatio > 0.2) {
      observations.push({
        detector: 'temporal-regression',
        signal: 'cost-increase',
        severity: 'warning',
        value: costChangeRatio,
        context: { currentCost, previousCost: previousRun.costUsd },
        message: `Cost increased ${(costChangeRatio * 100).toFixed(0)}%: $${currentCost.toFixed(2)} vs $${previousRun.costUsd.toFixed(2)} previous`,
      });
    }
  }

  // Store trends as observations with info severity for the report
  // (actual Trend objects are returned separately via the trends array in the report)
  return observations;
}

// --- Main ---

function loadResults(runDir: string): ScenarioResult[] {
  const results: ScenarioResult[] = [];

  if (!existsSync(runDir)) return results;

  const entries = readdirSync(runDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const resultPath = join(runDir, entry.name, 'result.json');
    if (!existsSync(resultPath)) continue;
    try {
      const data = JSON.parse(readFileSync(resultPath, 'utf8')) as ScenarioResult;
      results.push(data);
    } catch {
      // Skip malformed result files
    }
  }

  return results;
}

function buildTrends(results: ScenarioResult[], history: History): Trend[] {
  const trends: Trend[] = [];

  if (history.runs.length === 0) return trends;

  const previousRun = history.runs[history.runs.length - 1];

  // Pass rate trend
  const currentTotal = results.length;
  const currentPassed = results.filter(r => {
    const eforgeOk = r.eforgeExitCode === 0;
    const validateOk = Object.values(r.validation || {}).every(v => v.passed);
    return eforgeOk && validateOk;
  }).length;
  const currentPassRate = currentTotal > 0 ? currentPassed / currentTotal : 0;
  const previousPassRate = previousRun.total > 0 ? previousRun.passed / previousRun.total : 0;

  trends.push({
    metric: 'passRate',
    current: currentPassRate,
    previous: previousPassRate,
    delta: currentPassRate - previousPassRate,
    message: `Pass rate: ${(currentPassRate * 100).toFixed(0)}% vs ${(previousPassRate * 100).toFixed(0)}% previous`,
  });

  // Cost trend
  let currentCost = 0;
  for (const r of results) {
    if (r.metrics) currentCost += r.metrics.costUsd;
  }

  if (previousRun.costUsd > 0) {
    trends.push({
      metric: 'costUsd',
      current: currentCost,
      previous: previousRun.costUsd,
      delta: currentCost - previousRun.costUsd,
      message: `Cost: $${currentCost.toFixed(2)} vs $${previousRun.costUsd.toFixed(2)} previous`,
    });
  }

  return trends;
}

function analyze(runDir: string): void {
  const results = loadResults(runDir);

  if (results.length === 0) {
    console.error(`No result.json files found in subdirectories of ${runDir}`);
    process.exit(1);
  }

  // Build history from the parent results directory
  const resultsDir = dirname(runDir);
  const history = buildHistory(resultsDir);

  // Exclude the current run from history to avoid self-comparison
  const currentTimestamp = basename(runDir.replace(/\/+$/, ''));
  history.runs = history.runs.filter(r => r.timestamp !== currentTimestamp);

  // Run all detectors
  const observations: Observation[] = [
    ...detectReviewCalibration(results),
    ...detectCostEfficiency(results),
    ...detectProfileSelection(results),
    ...detectTemporalRegression(results, history),
  ];

  // Build trends
  const trends = buildTrends(results, history);

  // Determine run timestamp from the directory name or first result
  const runTimestamp = results[0]?.timestamp ?? new Date().toISOString();

  const report: AnalysisReport = {
    runTimestamp,
    scenarioCount: results.length,
    observations,
    trends,
  };

  const outputPath = join(runDir, 'analysis.json');
  writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`Wrote ${outputPath} (${observations.length} observations, ${trends.length} trends)`);
}

// CLI entry point
if (process.argv[1] && (process.argv[1].endsWith('analyze.ts') || process.argv[1].endsWith('analyze.js'))) {
  const runDir = process.argv[2];

  if (!runDir) {
    console.error('Usage: npx tsx lib/analyze.ts <run-dir>');
    process.exit(1);
  }

  analyze(runDir);
}
