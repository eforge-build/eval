#!/usr/bin/env tsx
// Build a structured result.json from eval scenario output.
// Usage: npx tsx build-result.ts <output> <scenario> <version> <commit> <exitCode> <duration> <logFile> <validationJson> <workspace> [monitorDbPath]

process.removeAllListeners('warning');
import { writeFileSync, existsSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import { type AgentAggregate, type ModelAggregate, type PhaseTimestamps, type ReviewIssueDetail, type EvaluationVerdict, type ScenarioMetrics, type ScenarioResult } from './types.js';

export interface BuildResultOpts {
  outputFile: string;
  scenario: string;
  eforgeVersion: string;
  eforgeCommit: string;
  eforgeDirty?: boolean;
  exitCode: number;
  duration: number;
  logFile?: string;
  validation: Record<string, { exitCode: number; passed: boolean }>;
  monitorDbPath?: string;
  workspace: string;
  profile?: { name: string; config: Record<string, unknown>; envFiles?: string[] };
}

/**
 * Resolve eforge run_ids associated with a given workspace by querying the
 * shared monitor DB. eforge spawns separate sessions per command (enqueue,
 * compile, build) that share the same cwd, so we collect every run for the
 * workspace rather than filtering by a single session_id. Returns the earliest
 * session_id for display purposes. Returns an empty runIds array if the DB
 * does not exist, has no events, or has no rows matching the workspace.
 */
export function resolveRunIds(
  dbPath: string,
  workspace: string,
): { sessionId?: string; runIds: string[] } {
  if (!existsSync(dbPath)) return { runIds: [] };

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return { runIds: [] };
  }

  try {
    const tableCheck = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='runs'`,
    ).get() as unknown as { name: string } | undefined;
    if (!tableCheck) return { runIds: [] };

    const rows = db.prepare(
      `SELECT id, session_id FROM runs WHERE cwd = ? ORDER BY started_at`,
    ).all(workspace) as unknown as Array<{ id: string; session_id: string | null }>;

    if (rows.length === 0) return { runIds: [] };

    const sessionId = rows.find(r => r.session_id)?.session_id ?? undefined;
    return { sessionId, runIds: rows.map(r => r.id) };
  } catch {
    return { runIds: [] };
  } finally {
    db.close();
  }
}

function extractMetrics(dbPath: string, runIds: string[]): ScenarioMetrics | undefined {
  if (runIds.length === 0) return undefined;
  if (!existsSync(dbPath)) return undefined;

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return undefined;
  }

  const placeholders = runIds.map(() => '?').join(', ');
  const runFilter = `AND run_id IN (${placeholders})`;

  try {
    // Verify the events table exists (DB may be empty if WAL wasn't copied)
    const tableCheck = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='events'`
    ).get() as unknown as { name: string } | undefined;
    if (!tableCheck) return undefined;
    // Extract profile from plan:profile event
    let profile: string | undefined;
    const profileStmt = db.prepare(
      `SELECT data FROM events WHERE type = 'plan:profile' ${runFilter} LIMIT 1`
    );
    const profileRows = profileStmt.all(...runIds) as unknown as Array<{ data: string }>;
    if (profileRows.length > 0) {
      try {
        const parsed = JSON.parse(profileRows[0].data);
        profile = parsed.profileName;
      } catch { /* ignore */ }
    }

    // Extract agent results
    const agentResultStmt = db.prepare(
      `SELECT agent, data FROM events WHERE type = 'agent:result' ${runFilter}`
    );
    const agentResultRows = agentResultStmt.all(...runIds) as unknown as Array<{ agent: string; data: string }>;

    let totalInput = 0;
    let totalOutput = 0;
    let totalTotal = 0;
    let totalCacheRead = 0;
    let totalCacheCreation = 0;
    let totalCost = 0;
    const agents: Record<string, AgentAggregate> = {};
    const models: Record<string, ModelAggregate> = {};

    for (const row of agentResultRows) {
      let result: any;
      try {
        const parsed = JSON.parse(row.data);
        result = parsed.result;
        if (!result) continue;
      } catch {
        continue;
      }

      const role = row.agent as string;

      // Accumulate totals
      totalInput += result.usage.input;
      totalOutput += result.usage.output;
      totalTotal += result.usage.total;
      totalCacheRead += result.usage.cacheRead ?? 0;
      totalCacheCreation += result.usage.cacheCreation ?? 0;
      totalCost += result.totalCostUsd;

      // Per-agent aggregates
      if (!agents[role]) {
        agents[role] = { count: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheRead: 0, cacheCreation: 0, costUsd: 0, durationMs: 0, turns: 0 };
      }
      agents[role].count += 1;
      agents[role].inputTokens += result.usage.input;
      agents[role].outputTokens += result.usage.output;
      agents[role].totalTokens += result.usage.total;
      agents[role].cacheRead += result.usage.cacheRead ?? 0;
      agents[role].cacheCreation += result.usage.cacheCreation ?? 0;
      agents[role].costUsd += result.totalCostUsd;
      agents[role].durationMs += result.durationMs;
      agents[role].turns += result.numTurns;

      // Per-model aggregates
      if (result.modelUsage) {
        for (const [model, usage] of Object.entries(result.modelUsage) as Array<[string, any]>) {
          if (!models[model]) {
            models[model] = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUsd: 0 };
          }
          models[model].inputTokens += usage.inputTokens;
          models[model].outputTokens += usage.outputTokens;
          models[model].cacheReadInputTokens += usage.cacheReadInputTokens ?? 0;
          models[model].cacheCreationInputTokens += usage.cacheCreationInputTokens ?? 0;
          models[model].costUsd += usage.costUSD;
        }
      }
    }

    // Extract phase durations from phase:start/phase:end
    const phaseStmt = db.prepare(
      `SELECT type, data, timestamp FROM events WHERE type IN ('phase:start', 'phase:end') ${runFilter} ORDER BY id`
    );
    const phaseRows = phaseStmt.all(...runIds) as unknown as Array<{ type: string; data: string; timestamp: string }>;

    const phaseTimestamps: Record<string, PhaseTimestamps> = {};
    const runIdToCommand: Record<string, string> = {};
    for (const row of phaseRows) {
      try {
        const parsed = JSON.parse(row.data);
        if (row.type === 'phase:start') {
          const command = parsed.command as string | undefined;
          const runId = parsed.runId as string | undefined;
          if (command) {
            phaseTimestamps[command] = { ...phaseTimestamps[command], start: row.timestamp };
            if (runId) runIdToCommand[runId] = command;
          }
        } else if (row.type === 'phase:end') {
          const runId = parsed.runId as string | undefined;
          const command = runId ? runIdToCommand[runId] : undefined;
          if (command && phaseTimestamps[command]) {
            phaseTimestamps[command] = { ...phaseTimestamps[command], end: row.timestamp };
          }
        }
      } catch { /* ignore */ }
    }

    const phases: Record<string, { durationMs: number }> = {};
    for (const [command, ts] of Object.entries(phaseTimestamps)) {
      if (ts.start && ts.end) {
        const durationMs = new Date(ts.end).getTime() - new Date(ts.start).getTime();
        phases[command] = { durationMs };
      }
    }

    // Extract review issues from build:review:complete events
    let issueCount = 0;
    const bySeverity: Record<string, number> = {};
    const reviewIssues: Array<ReviewIssueDetail> = [];
    const reviewCompleteStmt = db.prepare(
      `SELECT data FROM events WHERE type = 'build:review:complete' ${runFilter}`
    );
    const reviewCompleteRows = reviewCompleteStmt.all(...runIds) as unknown as Array<{ data: string }>;

    for (const row of reviewCompleteRows) {
      try {
        const parsed = JSON.parse(row.data);
        const issues = parsed.issues;
        if (Array.isArray(issues)) {
          issueCount += issues.length;
          for (const issue of issues) {
            bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + 1;
            reviewIssues.push({
              severity: issue.severity ?? '',
              category: issue.category ?? '',
              file: issue.file ?? '',
              description: issue.description ?? '',
            });
          }
        }
      } catch { /* ignore */ }
    }

    // Extract accepted/rejected from build:evaluate:complete events
    let accepted = 0;
    let rejected = 0;
    const evaluationVerdicts: Array<EvaluationVerdict> = [];
    const evaluateCompleteStmt = db.prepare(
      `SELECT data FROM events WHERE type = 'build:evaluate:complete' ${runFilter}`
    );
    const evaluateCompleteRows = evaluateCompleteStmt.all(...runIds) as unknown as Array<{ data: string }>;

    for (const row of evaluateCompleteRows) {
      try {
        const parsed = JSON.parse(row.data);
        accepted += parsed.accepted ?? 0;
        rejected += parsed.rejected ?? 0;
        // Extract per-verdict details when available
        const verdicts = parsed.verdicts as Array<{ file: string; action: string; reason: string }> | undefined;
        if (Array.isArray(verdicts)) {
          for (const verdict of verdicts) {
            if (verdict && typeof verdict.file === 'string' && typeof verdict.action === 'string' && typeof verdict.reason === 'string') {
              evaluationVerdicts.push({
                file: verdict.file,
                action: verdict.action,
                reason: verdict.reason,
              });
            }
          }
        }
      } catch { /* ignore */ }
    }

    // Extract tool usage from agent:tool_use events
    const toolUsage: Record<string, Record<string, number>> = {};
    const toolUseStmt = db.prepare(
      `SELECT agent, data FROM events WHERE type = 'agent:tool_use' ${runFilter}`
    );
    const toolUseRows = toolUseStmt.all(...runIds) as unknown as Array<{ agent: string; data: string }>;

    for (const row of toolUseRows) {
      try {
        const parsed = JSON.parse(row.data);
        const role = row.agent ?? 'unknown';
        const toolName = parsed.tool as string | undefined;
        if (toolName) {
          if (!toolUsage[role]) {
            toolUsage[role] = {};
          }
          toolUsage[role][toolName] = (toolUsage[role][toolName] ?? 0) + 1;
        }
      } catch { /* ignore */ }
    }

    return {
      ...(profile && { profile }),
      tokens: { input: totalInput, output: totalOutput, total: totalTotal, cacheRead: totalCacheRead, cacheCreation: totalCacheCreation },
      costUsd: totalCost,
      phases,
      agents,
      review: { issueCount, bySeverity, accepted, rejected },
      reviewIssues,
      evaluationVerdicts,
      toolUsage,
      models,
    };
  } finally {
    db.close();
  }
}

/**
 * Build a structured result from eval scenario output and write to outputFile.
 * Returns the result object.
 */
export function buildResult(opts: BuildResultOpts): ScenarioResult {
  const { outputFile, scenario, eforgeVersion, eforgeCommit, eforgeDirty, exitCode, duration, logFile, validation, monitorDbPath, workspace, profile } = opts;
  void logFile;

  // Resolve run IDs from the monitor DB by workspace (cwd-based lookup).
  let sessionId: string | undefined;
  let runIds: string[] = [];
  if (monitorDbPath) {
    const resolved = resolveRunIds(monitorDbPath, workspace);
    sessionId = resolved.sessionId;
    runIds = resolved.runIds;
  }
  const langfuseTraceId = sessionId;

  const result: Record<string, unknown> = {
    scenario,
    ...(profile && { profile }),
    timestamp: new Date().toISOString(),
    eforgeVersion,
    eforgeCommit,
    ...(eforgeDirty && { eforgeDirty: true }),
    eforgeExitCode: exitCode,
    validation,
    durationSeconds: duration,
    ...(langfuseTraceId && { langfuseTraceId }),
    ...(sessionId && { eforgeSessionId: sessionId }),
  };

  // Extract metrics from monitor DB if available
  if (monitorDbPath) {
    const metrics = extractMetrics(monitorDbPath, runIds);
    if (metrics) {
      result.metrics = metrics;
    }
  }

  writeFileSync(outputFile, JSON.stringify(result, null, 2) + '\n');
  return result as unknown as ScenarioResult;
}

// CLI entry point
if (process.argv[1] && (process.argv[1].endsWith('build-result.ts') || process.argv[1].endsWith('build-result.js'))) {
  const [, , outputFile, scenario, eforgeVersion, eforgeCommit, exitCodeStr, durationStr, logFile, validationJson, workspace, monitorDbPath] =
    process.argv;

  if (!workspace) {
    console.error('Usage: build-result.ts <output> <scenario> <version> <commit> <exitCode> <duration> <logFile> <validationJson> <workspace> [monitorDbPath]');
    process.exit(1);
  }

  let validation: Record<string, { exitCode: number; passed: boolean }> = {};
  try {
    validation = JSON.parse(validationJson);
  } catch {
    // Empty or malformed validation
  }

  buildResult({
    outputFile,
    scenario,
    eforgeVersion,
    eforgeCommit,
    exitCode: parseInt(exitCodeStr, 10),
    duration: parseInt(durationStr, 10),
    logFile,
    validation,
    workspace,
    monitorDbPath,
  });
}
