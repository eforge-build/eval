#!/usr/bin/env tsx
// TypeScript eval runner — replaces run.sh + run-scenario.sh.
// Usage: npx tsx lib/runner.ts [OPTIONS] SCENARIO_ID [SCENARIO_ID...]
//        npx tsx lib/runner.ts --all [OPTIONS]

import { execSync, spawn } from 'child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  cpSync,
  createWriteStream,
} from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, realpathSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { loadScenarios, loadBackends, expandScenarioBackends, deriveGroupId } from './scenarios.js';
import { buildResult, type BuildResultOpts } from './build-result.js';
import { checkExpectations, type ExpectConfig } from './check-expectations.js';
import type { ExpandedScenario, ScenarioResult } from './types.js';

// --- Constants ---

const SCRIPT_DIR = resolve(import.meta.dirname, '..');
const FIXTURES_DIR = join(SCRIPT_DIR, 'fixtures');
const RESULTS_DIR = join(SCRIPT_DIR, 'results');
const SCENARIOS_FILE = join(SCRIPT_DIR, 'scenarios.yaml');
const BACKENDS_DIR = join(SCRIPT_DIR, 'eforge', 'backends');
const BACKEND_ENVS_FILE = join(SCRIPT_DIR, 'backend-envs.yaml');
const MAX_RUNS = 50;

// --- ANSI colors ---

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';

// --- CLI argument parsing ---

interface RunArgs {
  filters: string[];
  backendNames: string[];
  repeatCount: number;
  compareTimestamp: string;
  envFile: string;
  dryRun: boolean;
  all: boolean;
}

function parseArgs(argv: string[]): RunArgs {
  const args: RunArgs = {
    filters: [],
    backendNames: [],
    repeatCount: 1,
    compareTimestamp: '',
    envFile: '',
    dryRun: false,
    all: false,
  };

  const rest = argv.slice(2); // skip node + script path
  let i = 0;
  while (i < rest.length) {
    switch (rest[i]) {
      case '--cleanup':
        cleanup();
        process.exit(0);
      case '--dry-run':
        args.dryRun = true;
        i++;
        break;
      case '--env-file':
        if (i + 1 >= rest.length) { console.error('Error: --env-file requires a FILE argument'); process.exit(1); }
        args.envFile = resolve(rest[i + 1]);
        i += 2;
        break;
      case '--repeat':
        if (i + 1 >= rest.length) { console.error('Error: --repeat requires an N argument'); process.exit(1); }
        args.repeatCount = parseInt(rest[i + 1], 10);
        i += 2;
        break;
      case '--compare':
        if (i + 1 >= rest.length) { console.error('Error: --compare requires a <timestamp> argument'); process.exit(1); }
        args.compareTimestamp = rest[i + 1];
        i += 2;
        break;
      case '--all':
        args.all = true;
        i++;
        break;
      case '--backend':
      case '--backends':
        if (i + 1 >= rest.length) { console.error('Error: --backend requires a comma-separated list'); process.exit(1); }
        args.backendNames = rest[i + 1].split(',').map((v) => v.trim());
        i += 2;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        args.filters.push(rest[i]);
        i++;
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`Usage: run.sh --backend NAME[,NAME] [OPTIONS] SCENARIO_ID [SCENARIO_ID...]
       run.sh --backend NAME[,NAME] --all [OPTIONS]

Runs eval scenarios with the specified backend profile(s).
Scenarios are defined in scenarios.yaml; backend profiles are plain eforge
profile files in eforge/backends/. Env-file associations live in
backend-envs.yaml. When multiple backends are specified, they run in parallel
for each scenario.

Options:
  --backend LIST         Comma-separated backend profile names to run (required, e.g. claude-sdk,pi-codex)
  --all                  Run all scenarios
  --dry-run              Set up workspaces but skip eforge and validation
  --env-file FILE        Source environment variables (e.g. Langfuse credentials)
  --repeat N             Run each scenario N times (default: 1)
  --compare <timestamp>  Compare results against a previous run
  --cleanup              Remove all eval results
  --help                 Show this help

Environment:
  EFORGE_BIN      Path to eforge binary (default: eforge on PATH)`);
}

// --- Pass/fail helper ---

function isScenarioPassed(r: ScenarioResult): boolean {
  const eforgeOk = r.eforgeExitCode === 0;
  const validateOk = Object.values(r.validation || {}).every((v) => v.passed);
  // `skip` is a gating expectation: a skip mismatch (expected real work, got a
  // plan:skip — or vice versa) is a factual mismatch, not a judgment call, so any
  // failed `skip` check fails the scenario. This covers both explicit
  // `expect.skip` entries and implicit `skip: false` checks synthesized by
  // check-expectations.ts when the scenario shows it expected real work.
  //
  // Other expectations (`mode`, `buildStagesContain`, `buildStagesExclude`) remain
  // informational — reported as observations, not pass/fail gates, because mode
  // selection and pipeline shape are judgment calls.
  const skipOk = !(r.expectations?.checks ?? []).some(
    (c) => c.check === 'skip' && c.passed === false,
  );
  return eforgeOk && validateOk && skipOk;
}

// --- Eforge version parsing ---

function parseEforgeVersion(eforgeBin: string): { version: string; commit: string; dirty: boolean } {
  try {
    const output = execSync(`${eforgeBin} --version`, { encoding: 'utf8' }).trim();
    // Expected format: "X.Y.Z (abc1234)", "X.Y.Z-dirty (abc1234)", or just "X.Y.Z"
    const commitMatch = output.match(/\(([a-f0-9]+)\)/);
    return {
      version: output,
      commit: commitMatch?.[1] ?? '',
      dirty: /-dirty\b/.test(output),
    };
  } catch {
    return { version: 'unknown', commit: '', dirty: false };
  }
}

// --- Cleanup & pruning ---

function cleanup(): void {
  console.log('Cleaning up all eval results...');
  if (existsSync(RESULTS_DIR)) {
    rmSync(RESULTS_DIR, { recursive: true });
    console.log(`Removed ${RESULTS_DIR}`);
  } else {
    console.log('Nothing to clean.');
  }
}

function pruneOldRuns(): void {
  if (!existsSync(RESULTS_DIR)) return;
  const entries = readdirSync(RESULTS_DIR, { withFileTypes: true });
  const runs = entries
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(e.name))
    .map((e) => e.name)
    .sort();

  if (runs.length <= MAX_RUNS) return;
  const toRemove = runs.length - MAX_RUNS;
  console.log(`Pruning ${toRemove} old run(s) (keeping last ${MAX_RUNS})...`);
  for (let i = 0; i < toRemove; i++) {
    console.log(`  Removing ${runs[i]}`);
    rmSync(join(RESULTS_DIR, runs[i]), { recursive: true });
  }
}

// --- Env file parsing ---

function loadEnvFile(filePath: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const content = readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Handle: export KEY=VALUE, KEY=VALUE, KEY="VALUE", KEY='VALUE'
    const stripped = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed;
    const eqIdx = stripped.indexOf('=');
    if (eqIdx === -1) continue;
    const key = stripped.slice(0, eqIdx).trim();
    let value = stripped.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

// --- Filtering ---

function filterExpandedScenarios(
  expanded: ExpandedScenario[],
  filters: string[],
  all: boolean,
): ExpandedScenario[] {
  if (all) return expanded;
  return expanded.filter((e) =>
    filters.some((f) => e.id === f || e.scenario.id === f || e.id.startsWith(f + '--')),
  );
}

// --- Grouping for parallel execution ---

interface ScenarioGroup {
  groupId: string;
  scenarios: ExpandedScenario[];
}

function groupByCompareGroup(expanded: ExpandedScenario[]): ScenarioGroup[] {
  const groupMap = new Map<string, ExpandedScenario[]>();
  const groupOrder: string[] = [];

  for (const e of expanded) {
    const groupId = deriveGroupId(e);
    if (!groupMap.has(groupId)) {
      groupMap.set(groupId, []);
      groupOrder.push(groupId);
    }
    groupMap.get(groupId)!.push(e);
  }

  return groupOrder.map((groupId) => ({
    groupId,
    scenarios: groupMap.get(groupId)!,
  }));
}

// --- Monitor ---

async function startMonitor(eforgeBin: string): Promise<string | undefined> {
  try {
    // Run monitor from RESULTS_DIR so its daemon.lock lives at results/.eforge/,
    // isolated from any user-level daemon that may be running in the eval root
    // (e.g., auto-started by the eforge MCP server when /eforge:build is invoked).
    const child = spawn(eforgeBin, ['monitor'], {
      cwd: RESULTS_DIR,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    // Give monitor a moment to write its lock file
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const lockPath = join(RESULTS_DIR, '.eforge', 'daemon.lock');
    if (existsSync(lockPath)) {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (typeof lock.port === 'number') {
        return `http://localhost:${lock.port}`;
      }
    }
  } catch {
    // Monitor failed to start — non-fatal
  }
  return undefined;
}

// --- Backend profile pin ---

// Copies the named backend profile into the workspace and writes the project
// marker so eforge resolves the profile via step 1 of its 5-step precedence
// chain, insulating eval runs from the developer's user-scope eforge settings
// (~/.config/eforge/.active-backend, ~/.config/eforge/config.yaml's
// `backend:` field, or ~/.config/eforge/backends/).
//
// Precedence (highest to lowest):
//   1. eforge/.active-backend (project marker)        ← we write this
//   2. eforge/config.yaml `backend:` field
//   3. ~/.config/eforge/.active-backend (user marker)
//   4. ~/.config/eforge/config.yaml `backend:` field
//   5. none
function pinBackendProfile(workspace: string, backendName: string): void {
  const sourceProfile = join(BACKENDS_DIR, `${backendName}.yaml`);
  if (!existsSync(sourceProfile)) {
    throw new Error(`Backend profile not found: ${sourceProfile}`);
  }
  const eforgeDir = join(workspace, 'eforge');
  const workspaceBackendsDir = join(eforgeDir, 'backends');
  mkdirSync(workspaceBackendsDir, { recursive: true });
  cpSync(sourceProfile, join(workspaceBackendsDir, `${backendName}.yaml`));
  writeFileSync(join(eforgeDir, '.active-backend'), `${backendName}\n`);
}

/** Read a backend profile file as a plain object, for result.json recording. */
function readBackendProfile(backendName: string): Record<string, unknown> {
  const path = join(BACKENDS_DIR, `${backendName}.yaml`);
  const raw = readFileSync(path, 'utf8');
  const parsed = parseYaml(raw);
  return (parsed && typeof parsed === 'object') ? (parsed as Record<string, unknown>) : {};
}

// --- Validation runner ---

interface ValidationResult {
  [name: string]: { exitCode: number; passed: boolean };
}

function runValidations(workspace: string, commands: string[], scenarioDir: string): ValidationResult {
  const results: ValidationResult = {};
  let cmdIndex = 0;

  for (const cmd of commands) {
    if (!cmd) continue;
    cmdIndex++;

    // Derive a short name from the command
    const lastWord = cmd.split(/\s+/).pop()?.replace(/\//g, '-') ?? cmd;
    const name = `${cmdIndex}-${lastWord}`;

    console.log(`    Running: ${cmd}`);
    let exitCode = 0;
    let stdout = '';
    let stderr = '';
    try {
      stdout = execSync(cmd, {
        cwd: workspace,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
        encoding: 'utf8',
      });
    } catch (err: unknown) {
      const execErr = err as { status?: number; stdout?: string; stderr?: string };
      exitCode = execErr.status ?? 1;
      stdout = execErr.stdout ?? '';
      stderr = execErr.stderr ?? '';
    }

    // Write validation output to log file for diagnostics
    const logContent = stdout + (stderr ? '\n--- stderr ---\n' + stderr : '');
    if (logContent.trim()) {
      writeFileSync(join(scenarioDir, `validate-${name}.log`), logContent);
    }

    const passed = exitCode === 0;
    results[name] = { exitCode, passed };

    if (!passed) {
      console.log(`    ${RED}FAILED${RESET}: ${cmd} (exit code: ${exitCode})`);
    } else {
      console.log(`    ${GREEN}PASSED${RESET}: ${cmd}`);
    }
  }

  return results;
}

// --- Spawn eforge with prefixed output ---

function spawnEforge(
  eforgeBin: string,
  prd: string,
  workspace: string,
  logFile: string,
  label: string,
  envOverrides: Record<string, string>,
  parallel: boolean,
): Promise<number> {
  return new Promise((resolve) => {
    const logStream = createWriteStream(logFile);
    const child = spawn(eforgeBin, ['run', prd, '--auto', '--verbose', '--foreground', '--no-monitor'], {
      cwd: workspace,
      env: { ...process.env, ...envOverrides },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const prefix = parallel ? `${DIM}[${label}]${RESET} ` : '';

    const handleData = (data: Buffer) => {
      const text = data.toString();
      logStream.write(text);
      // Print to console with optional prefix
      for (const line of text.split('\n')) {
        if (line) process.stdout.write(`${prefix}${line}\n`);
      }
    };

    child.stdout?.on('data', handleData);
    child.stderr?.on('data', handleData);

    child.on('close', (code) => {
      logStream.end();
      resolve(code ?? 1);
    });

    child.on('error', (err) => {
      logStream.end();
      console.error(`${prefix}Error spawning eforge: ${err.message}`);
      resolve(1);
    });
  });
}

// --- Single scenario runner ---

interface ScenarioRunOpts {
  expanded: ExpandedScenario;
  scenarioDir: string;
  eforgeBin: string;
  eforgeVersion: string;
  eforgeCommit: string;
  eforgeDirty: boolean;
  monitorDbPath: string;
  dryRun: boolean;
  globalEnvVars: Record<string, string>;
  parallel: boolean;
}

interface ScenarioRunResult {
  scenario: string;
  passed: boolean;
  result?: ScenarioResult;
  passRate?: number;
  repeatCount?: number;
}

async function runScenario(opts: ScenarioRunOpts): Promise<ScenarioRunResult> {
  const { expanded, scenarioDir, eforgeBin, eforgeVersion, eforgeCommit, eforgeDirty, monitorDbPath, dryRun, globalEnvVars, parallel } = opts;
  const { scenario, backend } = expanded;
  const label = backend.name;
  const prefix = parallel ? `${DIM}[${label}]${RESET} ` : '';
  const log = (msg: string) => console.log(`${prefix}${msg}`);

  const startTime = Date.now();

  // Step 1: Verify fixture exists
  const fixtureDir = join(FIXTURES_DIR, scenario.fixture);
  if (!existsSync(fixtureDir)) {
    log(`  ${RED}ERROR${RESET}: Fixture not found: ${fixtureDir}`);
    writeErrorResult(scenarioDir, expanded.id, eforgeVersion, eforgeCommit, eforgeDirty, startTime, `Fixture directory not found: ${scenario.fixture}`);
    return { scenario: expanded.id, passed: false };
  }

  // Step 2: Copy fixture to workspace
  // Canonicalize to the realpath form so that it matches how eforge records
  // `cwd` from inside the spawned child (macOS tmpdir is a symlink to /private/var/...).
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), `eforge-eval-${expanded.id}-`)));
  log(`  Copying fixture '${scenario.fixture}' to workspace...`);
  cpSync(fixtureDir, workspace, { recursive: true });
  writeFileSync(join(scenarioDir, 'workspace-path.txt'), workspace);

  // Step 2b: Pin the active backend profile into the workspace so the eval
  // run is not polluted by any user-scope eforge config on the developer's
  // machine. See pinBackendProfile() for the precedence rationale.
  log(`  Pinning backend profile '${backend.name}'...`);
  pinBackendProfile(workspace, backend.name);

  // Step 2c: Init git
  log('  Initializing git repo...');
  execSync('git init --quiet && git add -A && git commit --quiet -m "Initial commit (eval fixture)"', {
    cwd: workspace,
    stdio: 'pipe',
  });
  execSync(`git checkout --quiet -b "eval/${expanded.id}"`, { cwd: workspace, stdio: 'pipe' });

  // Step 3: Build environment for eforge
  const envOverrides: Record<string, string> = { ...globalEnvVars };
  envOverrides['EFORGE_MONITOR_DB'] = monitorDbPath;
  envOverrides['EFORGE_TRACE_TAGS'] = `eval,${expanded.id}`;

  // Source backend env file
  if (backend.envFile) {
    const envFilePath = join(SCRIPT_DIR, backend.envFile);
    if (!existsSync(envFilePath)) {
      log(`  ${RED}ERROR${RESET}: Backend env file not found: ${backend.envFile}`);
      writeErrorResult(scenarioDir, expanded.id, eforgeVersion, eforgeCommit, eforgeDirty, startTime, `Backend env file not found: ${backend.envFile}`);
      cleanupWorkspace(workspace);
      return { scenario: expanded.id, passed: false };
    }
    log(`  Sourcing env file: ${backend.envFile}`);
    Object.assign(envOverrides, loadEnvFile(envFilePath));
  }

  // Step 4: Run eforge
  let eforgeExit = 0;
  const logFile = join(scenarioDir, 'eforge.log');

  if (dryRun) {
    log(`  [dry-run] Skipping eforge run (workspace ready at ${workspace})`);
    writeFileSync(logFile, '[dry-run] eforge skipped\n');
  } else {
    log(`  Running eforge run ${scenario.prd} --auto --verbose --foreground --no-monitor...`);
    eforgeExit = await spawnEforge(eforgeBin, scenario.prd, workspace, logFile, label, envOverrides, parallel);
  }

  if (eforgeExit === 0) {
    log(`  ${GREEN}Eforge completed successfully.${RESET}`);
  } else {
    log(`  ${RED}Eforge FAILED (exit code: ${eforgeExit})${RESET}`);
  }

  // Step 5: Run validation
  let validation: ValidationResult = {};
  if (dryRun) {
    log('  [dry-run] Skipping validation');
  } else if (eforgeExit === 0 && scenario.validate && scenario.validate.length > 0) {
    log('  Running validation...');
    validation = runValidations(workspace, scenario.validate, scenarioDir);
  }

  const endTime = Date.now();
  const duration = Math.round((endTime - startTime) / 1000);

  // Step 6: Build result.json (records the backend profile)
  const result = buildResult({
    outputFile: join(scenarioDir, 'result.json'),
    scenario: expanded.id,
    eforgeVersion,
    eforgeCommit,
    eforgeDirty,
    exitCode: eforgeExit,
    duration,
    validation,
    monitorDbPath,
    workspace,
    backend: {
      name: backend.name,
      profile: readBackendProfile(backend.name),
      envFile: backend.envFile,
    },
  });

  // Step 7: Check expectations
  const expectConfig = scenario.expect ?? {};
  const hasValidateSteps = (scenario.validate?.length ?? 0) > 0;
  // Always run if there are explicit expectations, or if an implicit skip=false
  // check may be synthesized (expect.mode defined or validate steps exist).
  const implicitSkipPossible =
    expectConfig.skip === undefined && (expectConfig.mode !== undefined || hasValidateSteps);
  if (Object.keys(expectConfig).length > 0 || implicitSkipPossible) {
    log('  Checking expectations...');
    const expectResult = checkExpectations({
      resultFile: join(scenarioDir, 'result.json'),
      expectConfig: expectConfig as ExpectConfig,
      monitorDbPath,
      workspace,
      hasValidateSteps,
    });
    if (expectResult.passed) {
      log(`  Expectations: ${GREEN}all matched${RESET}`);
    } else {
      const mismatches = expectResult.checks.filter(c => !c.passed).map(c => c.check);
      log(`  Expectations: ${DIM}mismatched (${mismatches.join(', ')})${RESET}`);
    }
  }

  // Re-read result after expectations were written
  const finalResult = JSON.parse(readFileSync(join(scenarioDir, 'result.json'), 'utf8')) as ScenarioResult;

  const mins = Math.floor(duration / 60);
  const secs = duration % 60;
  log(`  Result: ${scenarioDir}/result.json`);
  log(`  Duration: ${mins}m ${secs}s`);

  // Cleanup workspace
  cleanupWorkspace(workspace);

  return { scenario: expanded.id, passed: isScenarioPassed(finalResult), result: finalResult };
}

function writeErrorResult(scenarioDir: string, id: string, eforgeVersion: string, eforgeCommit: string, eforgeDirty: boolean, startTime: number, error: string): void {
  const duration = Math.round((Date.now() - startTime) / 1000);
  writeFileSync(
    join(scenarioDir, 'result.json'),
    JSON.stringify(
      {
        scenario: id,
        timestamp: new Date().toISOString(),
        eforgeVersion,
        eforgeCommit,
        ...(eforgeDirty && { eforgeDirty: true }),
        eforgeExitCode: 1,
        validation: {},
        durationSeconds: duration,
        error,
      },
      null,
      2,
    ) + '\n',
  );
}

function cleanupWorkspace(workspace: string): void {
  // Compare against the canonical tmpdir since workspace is realpath-resolved.
  if (existsSync(workspace) && (workspace.startsWith(tmpdir()) || workspace.startsWith(realpathSync(tmpdir())))) {
    rmSync(workspace, { recursive: true, force: true });
  }
}

// --- Repeat mode ---

async function runScenarioWithRepeats(
  opts: ScenarioRunOpts,
  repeatCount: number,
): Promise<ScenarioRunResult> {
  if (repeatCount <= 1) {
    return runScenario(opts);
  }

  const { expanded, scenarioDir, eforgeBin, eforgeVersion, eforgeCommit, eforgeDirty, monitorDbPath, dryRun, globalEnvVars, parallel } = opts;
  let runPassed = 0;

  for (let i = 1; i <= repeatCount; i++) {
    const repeatDir = join(scenarioDir, `run-${i}`);
    mkdirSync(repeatDir, { recursive: true });

    console.log(`  ── Run ${i}/${repeatCount} ──`);
    const result = await runScenario({
      ...opts,
      scenarioDir: repeatDir,
    });

    if (result.passed) runPassed++;
    console.log('');
  }

  // Write aggregate result.json
  const runs: Array<{ run: number; passed: boolean }> = [];
  let totalInputTokens = 0,
    totalOutputTokens = 0,
    totalTokens = 0,
    totalCacheRead = 0,
    totalCacheCreation = 0,
    totalCost = 0,
    totalDuration = 0;

  for (let i = 1; i <= repeatCount; i++) {
    const rf = join(scenarioDir, `run-${i}`, 'result.json');
    if (!existsSync(rf)) continue;
    const r = JSON.parse(readFileSync(rf, 'utf8'));
    totalDuration += r.durationSeconds || 0;
    if (r.metrics) {
      if (r.metrics.tokens) {
        totalInputTokens += r.metrics.tokens.input || 0;
        totalOutputTokens += r.metrics.tokens.output || 0;
        totalTokens += r.metrics.tokens.total || 0;
        totalCacheRead += r.metrics.tokens.cacheRead || 0;
        totalCacheCreation += r.metrics.tokens.cacheCreation || 0;
      }
      totalCost += r.metrics.costUsd || 0;
    }
    runs.push({ run: i, passed: isScenarioPassed(r as ScenarioResult) });
  }

  const aggregate = {
    scenario: expanded.id,
    timestamp: new Date().toISOString(),
    eforgeVersion,
    eforgeCommit,
    ...(eforgeDirty && { eforgeDirty: true }),
    eforgeExitCode: runs.every((r) => r.passed) ? 0 : 1,
    validation: {},
    durationSeconds: totalDuration,
    passRate: runs.length > 0 ? runPassed / runs.length : 0,
    repeatCount,
    runs,
    metrics: {
      tokens: { input: totalInputTokens, output: totalOutputTokens, total: totalTokens, cacheRead: totalCacheRead, cacheCreation: totalCacheCreation },
      costUsd: totalCost,
    },
  };

  writeFileSync(join(scenarioDir, 'result.json'), JSON.stringify(aggregate, null, 2) + '\n');

  console.log(`  Pass rate: ${runPassed}/${repeatCount}`);
  return {
    scenario: expanded.id,
    passed: runPassed === repeatCount,
    passRate: runs.length > 0 ? runPassed / runs.length : 0,
    repeatCount,
  };
}

// --- Summary ---

function writeSummary(
  runDir: string,
  timestamp: string,
  eforgeVersion: string,
  total: number,
  passed: number,
): void {
  const scenarios: ScenarioResult[] = [];
  const entries = readdirSync(runDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const rf = join(runDir, e.name, 'result.json');
    if (existsSync(rf)) {
      scenarios.push(JSON.parse(readFileSync(rf, 'utf8')));
    }
  }

  let totalInputTokens = 0,
    totalOutputTokens = 0,
    totalTokens = 0,
    totalCacheRead = 0,
    totalCost = 0,
    totalDuration = 0;
  let eforgeCommit = '';

  for (const r of scenarios) {
    totalDuration += r.durationSeconds || 0;
    if ((r as any).eforgeCommit && !eforgeCommit) eforgeCommit = (r as any).eforgeCommit;
    if (r.metrics) {
      if (r.metrics.tokens) {
        totalInputTokens += r.metrics.tokens.input || 0;
        totalOutputTokens += r.metrics.tokens.output || 0;
        totalTokens += r.metrics.tokens.total || 0;
        totalCacheRead += r.metrics.tokens.cacheRead || 0;
      }
      totalCost += r.metrics.costUsd || 0;
    }
  }

  const summary = {
    timestamp,
    eforgeVersion,
    eforgeCommit,
    totalScenarios: total,
    passed,
    scenarios,
    totals: {
      tokens: { input: totalInputTokens, output: totalOutputTokens, total: totalTokens, cacheRead: totalCacheRead },
      costUsd: totalCost,
      durationSeconds: totalDuration,
    },
  };

  writeFileSync(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
}

// --- Summary table printer ---

function printSummaryTable(summaryFile: string, repeatCount: number): void {
  const s = JSON.parse(readFileSync(summaryFile, 'utf8'));
  const pad = (str: string, len: number) => str.padEnd(len);

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Eforge Eval Results (${s.timestamp})`);
  console.log(`eforge ${s.eforgeVersion}`);
  console.log('');

  const header =
    repeatCount > 1
      ? pad('Scenario', 35) + pad('Pass Rate', 12) + pad('Tokens', 10) + pad('Cache', 10) + pad('Cost', 10) + 'Duration'
      : pad('Scenario', 35) + pad('Eforge', 10) + pad('Validate', 12) + pad('Expect', 10) + pad('Tokens', 10) + pad('Cache', 10) + pad('Cost', 10) + 'Duration';
  console.log(header);
  console.log('-'.repeat(110));

  for (const r of s.scenarios) {
    const tokens = r.metrics?.tokens ? Math.round(r.metrics.tokens.total / 1000) + 'k' : '-';
    const cache =
      r.metrics?.tokens?.input > 0 && r.metrics?.tokens?.cacheRead
        ? Math.round((r.metrics.tokens.cacheRead / r.metrics.tokens.input) * 100) + '%'
        : '-';
    const cost = r.metrics?.costUsd != null ? `$${r.metrics.costUsd.toFixed(2)}` : '-';
    const mins = Math.floor(r.durationSeconds / 60);
    const secs = r.durationSeconds % 60;
    const duration = `${mins}m ${secs}s`;

    if (repeatCount > 1) {
      const pr = r.passRate != null ? `${Math.round(r.passRate * (r.repeatCount || repeatCount))}/${r.repeatCount || repeatCount}` : '-';
      console.log(pad(r.scenario, 35) + pad(pr, 12) + pad(tokens, 10) + pad(cache, 10) + pad(cost, 10) + duration);
    } else {
      const eforge = r.eforgeExitCode === 0 ? 'PASS' : 'FAIL';
      const allValid = r.validation && Object.values(r.validation).every((v: any) => v.passed);
      const validate = r.eforgeExitCode !== 0 ? '-' : allValid ? 'PASS' : 'FAIL';
      const expect = !r.expectations ? '-' : r.expectations.passed ? 'PASS' : 'FAIL';
      console.log(
        pad(r.scenario, 35) + pad(eforge, 10) + pad(validate, 12) + pad(expect, 10) + pad(tokens, 10) + pad(cache, 10) + pad(cost, 10) + duration,
      );
    }
  }

  console.log('');
  console.log(`Passed: ${s.passed}/${s.totalScenarios}`);

  if (s.totals) {
    const t = s.totals;
    const totalTokens = t.tokens ? Math.round(t.tokens.total / 1000) + 'k' : '-';
    const totalCache =
      t.tokens?.input > 0 && t.tokens?.cacheRead
        ? Math.round((t.tokens.cacheRead / t.tokens.input) * 100) + '%'
        : '-';
    const totalCost = t.costUsd != null ? `$${t.costUsd.toFixed(2)}` : '-';
    const totalMins = Math.floor(t.durationSeconds / 60);
    const totalSecs = t.durationSeconds % 60;
    console.log(`Totals: ${totalTokens} tokens, ${totalCache} cached, ${totalCost} cost, ${totalMins}m ${totalSecs}s`);
  }

  // Per-agent breakdown
  const agentAgg: Record<string, { count: number; tokens: number; inputTokens: number; cacheRead: number; costUsd: number; durationMs: number }> = {};
  for (const r of s.scenarios) {
    if (!r.metrics?.agents) continue;
    for (const [role, a] of Object.entries(r.metrics.agents) as Array<[string, any]>) {
      if (!agentAgg[role]) {
        agentAgg[role] = { count: 0, tokens: 0, inputTokens: 0, cacheRead: 0, costUsd: 0, durationMs: 0 };
      }
      const agg = agentAgg[role];
      agg.count += a.count || 1;
      agg.tokens += a.totalTokens || 0;
      agg.inputTokens += a.inputTokens || 0;
      agg.cacheRead += a.cacheRead || 0;
      agg.costUsd += a.costUsd || 0;
      agg.durationMs += a.durationMs || 0;
    }
  }

  const agentRows = Object.entries(agentAgg).sort((a, b) => b[1].tokens - a[1].tokens);
  if (agentRows.length > 0) {
    console.log('');
    console.log('Per-Agent Breakdown:');
    console.log(pad('Agent', 25) + pad('Count', 8) + pad('Tokens', 12) + pad('Cache', 10) + pad('Cost', 10) + 'Duration');
    console.log('-'.repeat(80));
    for (const [agent, d] of agentRows) {
      const tokens = Math.round(d.tokens / 1000) + 'k';
      const cache = d.inputTokens > 0 && d.cacheRead > 0 ? Math.round((d.cacheRead / d.inputTokens) * 100) + '%' : '-';
      const cost = `$${d.costUsd.toFixed(2)}`;
      const mins = Math.floor(d.durationMs / 1000 / 60);
      const secs = Math.floor(d.durationMs / 1000) % 60;
      const duration = `${mins}m ${secs}s`;
      console.log(pad(agent, 25) + pad(String(d.count), 8) + pad(tokens, 12) + pad(cache, 10) + pad(cost, 10) + duration);
    }
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

// --- Baseline comparison printer ---

function printBaselineComparison(currentSummary: string, baselineSummary: string): void {
  const curr = JSON.parse(readFileSync(currentSummary, 'utf8'));
  const base = JSON.parse(readFileSync(baselineSummary, 'utf8'));
  const pad = (str: string, len: number) => str.padEnd(len);

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Comparison: ${base.timestamp} → ${curr.timestamp}`);
  console.log('');
  console.log(pad('Scenario', 35) + pad('Status', 14) + pad('Cost Δ', 16) + 'Token Eff Δ');
  console.log('-'.repeat(85));

  const baseMap: Record<string, any> = {};
  for (const s of base.scenarios) baseMap[s.scenario] = s;

  let totalCostCurr = 0,
    totalCostBase = 0;

  const isPassed = (r: any) =>
    r.passRate != null
      ? r.passRate === 1
      : r.eforgeExitCode === 0 &&
        (!r.validation || Object.values(r.validation).every((v: any) => v.passed));

  for (const r of curr.scenarios) {
    const b = baseMap[r.scenario];
    const currPass = isPassed(r);

    let status = '-';
    if (b) {
      const basePass = isPassed(b);
      if (basePass && !currPass) status = '⬇ REGRESSED';
      else if (!basePass && currPass) status = '⬆ IMPROVED';
      else if (currPass && basePass) status = '= PASS';
      else status = '= FAIL';
    } else {
      status = currPass ? '+ NEW PASS' : '+ NEW FAIL';
    }

    const currCost = r.metrics?.costUsd ?? 0;
    const baseCost = b?.metrics?.costUsd ?? 0;
    totalCostCurr += currCost;
    totalCostBase += baseCost;

    let costDelta = '-';
    if (b && baseCost > 0) {
      const diff = currCost - baseCost;
      const pct = ((diff / baseCost) * 100).toFixed(0);
      const sign = diff >= 0 ? '+' : '';
      costDelta = `${sign}$${diff.toFixed(2)} (${sign}${pct}%)`;
    } else if (!b) {
      costDelta = `$${currCost.toFixed(2)} (new)`;
    }

    let tokenEffDelta = '-';
    if (b) {
      const currTokens = r.metrics?.tokens?.total ?? 0;
      const baseTokens = b.metrics?.tokens?.total ?? 0;
      const currEff = r.durationSeconds > 0 ? currTokens / r.durationSeconds : 0;
      const baseEff = b.durationSeconds > 0 ? baseTokens / b.durationSeconds : 0;
      if (baseEff > 0) {
        const diff = currEff - baseEff;
        const pct = ((diff / baseEff) * 100).toFixed(0);
        const sign = diff >= 0 ? '+' : '';
        tokenEffDelta = `${sign}${Math.round(diff)} t/s (${sign}${pct}%)`;
      }
    }

    console.log(pad(r.scenario, 35) + pad(status, 14) + pad(costDelta, 16) + tokenEffDelta);
  }

  console.log('');
  if (totalCostBase > 0) {
    const totalDiff = totalCostCurr - totalCostBase;
    const totalPct = ((totalDiff / totalCostBase) * 100).toFixed(0);
    const sign = totalDiff >= 0 ? '+' : '';
    console.log(`Total cost: $${totalCostBase.toFixed(2)} → $${totalCostCurr.toFixed(2)} (${sign}${totalPct}%)`);
  }
  console.log(`Pass rate: ${base.passed}/${base.totalScenarios} → ${curr.passed}/${curr.totalScenarios}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

// --- Observations printer ---

function printObservations(analysisFile: string): void {
  if (!existsSync(analysisFile)) return;
  const analysis = JSON.parse(readFileSync(analysisFile, 'utf8'));
  const important = (analysis.observations || []).filter(
    (o: any) => o.severity === 'warning' || o.severity === 'attention',
  );
  if (important.length > 0) {
    console.log('');
    console.log('⚠ Observations:');
    for (const o of important) {
      const icon = o.severity === 'warning' ? '⚠' : '🔍';
      console.log(`  ${icon} [${o.severity.toUpperCase()}] ${o.message}`);
    }
  }
}

// --- Main ---

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // Require at least one scenario ID or --all
  if (!args.all && args.filters.length === 0) {
    console.error('Error: At least one scenario ID is required (or use --all to run everything).');
    console.error("Run './run.sh --help' for usage.");
    process.exit(1);
  }

  // Load scenarios and backends
  const allScenarios = loadScenarios(SCENARIOS_FILE);
  const allBackends = loadBackends(BACKENDS_DIR, BACKEND_ENVS_FILE);

  // Require --backend
  if (args.backendNames.length === 0) {
    console.error('Error: --backend is required. Specify one or more backend profile names.');
    console.error(`Available backends: ${allBackends.map((b) => b.name).join(', ')}`);
    process.exit(1);
  }

  // Validate --backend names
  const invalidBackends = args.backendNames.filter((n) => !allBackends.some((b) => b.name === n));
  if (invalidBackends.length > 0) {
    console.error(`Error: Unknown backend(s): ${invalidBackends.join(', ')}`);
    console.error(`Available backends: ${allBackends.map((b) => b.name).join(', ')}`);
    process.exit(1);
  }

  // Filter backends to requested names
  const selectedBackends = allBackends.filter((b) => args.backendNames.includes(b.name));

  // Validate --compare
  if (args.compareTimestamp) {
    const baselineDir = join(RESULTS_DIR, args.compareTimestamp);
    if (!existsSync(join(baselineDir, 'summary.json'))) {
      console.error(`Error: No summary.json found at ${baselineDir}`);
      process.exit(1);
    }
  }

  // Source global env file
  const globalEnvVars: Record<string, string> = {};
  if (args.envFile) {
    if (!existsSync(args.envFile)) {
      console.error(`Error: env file not found: ${args.envFile}`);
      process.exit(1);
    }
    Object.assign(globalEnvVars, loadEnvFile(args.envFile));
  }

  // Resolve eforge binary
  const eforgeBin = process.env['EFORGE_BIN'] ?? 'eforge';
  if (!args.dryRun) {
    try {
      execSync('command -v "$EFORGE_CMD"', { stdio: 'pipe', env: { ...process.env, EFORGE_CMD: eforgeBin } });
    } catch {
      console.error('Error: eforge not found. Install eforge or set EFORGE_BIN.');
      process.exit(1);
    }
  }

  // Create timestamped results directory
  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, '').slice(0, 19);
  const runDir = join(RESULTS_DIR, timestamp);
  mkdirSync(runDir, { recursive: true });

  pruneOldRuns();

  // Get eforge version and commit
  const { version: eforgeVersion, commit: eforgeCommit, dirty: eforgeDirty } = parseEforgeVersion(eforgeBin);

  // Shared monitor DB
  const monitorDbPath = join(RESULTS_DIR, 'monitor.db');
  process.env['EFORGE_MONITOR_DB'] = monitorDbPath;

  // Start monitor
  let monitorUrl: string | undefined;
  if (!args.dryRun) {
    monitorUrl = await startMonitor(eforgeBin);
  }

  console.log('Eforge Eval Run');
  console.log(`  Version: ${eforgeVersion}`);
  console.log(`  Backends: ${selectedBackends.map((b) => b.name).join(', ')}`);
  console.log(`  Results: ${runDir}`);
  if (monitorUrl) {
    console.log(`  Monitor: ${monitorUrl}`);
  }
  console.log('');

  // Cross-product scenarios with backends and filter
  const allExpanded = expandScenarioBackends(allScenarios, selectedBackends);
  const expanded = filterExpandedScenarios(allExpanded, args.filters, args.all);

  if (expanded.length === 0) {
    if (args.filters.length > 0) {
      console.error(`Error: No scenarios found matching: ${args.filters.join(' ')}`);
    } else {
      console.error(`Error: No scenarios defined in ${SCENARIOS_FILE}`);
    }
    process.exit(1);
  }

  // Group for parallel execution
  const groups = groupByCompareGroup(expanded);

  let total = 0;
  let passed = 0;

  for (const group of groups) {
    const isParallel = group.scenarios.length > 1;

    if (isParallel) {
      console.log(`${BOLD}━━━ Group: ${group.groupId} (${group.scenarios.length} backends, parallel) ━━━${RESET}`);
    }

    // Print scenario headers
    for (const e of group.scenarios) {
      if (!isParallel) {
        console.log(`${BOLD}━━━ Scenario: ${e.id} ━━━${RESET}`);
        console.log(`  ${e.scenario.description ?? ''}`);
        console.log(`  Fixture: ${e.scenario.fixture}`);
        console.log(`  PRD: ${e.scenario.prd}`);
        console.log(`  Backend: ${e.backend.name}`);
        if (args.repeatCount > 1) console.log(`  Repeats: ${args.repeatCount}`);
        console.log('');
      }
    }

    if (isParallel) {
      for (const e of group.scenarios) {
        console.log(`  ${DIM}[${e.backend.name}]${RESET} ${e.scenario.description ?? ''} (${e.scenario.fixture} / ${e.scenario.prd})`);
      }
      console.log('');
    }

    // Run backends in parallel (or single if only one)
    const promises = group.scenarios.map((e) => {
      total++;
      const scenarioDir = join(runDir, e.id);
      mkdirSync(scenarioDir, { recursive: true });

      return runScenarioWithRepeats(
        {
          expanded: e,
          scenarioDir,
          eforgeBin,
          eforgeVersion,
          eforgeCommit,
          eforgeDirty,
          monitorDbPath,
          dryRun: args.dryRun,
          globalEnvVars,
          parallel: isParallel,
        },
        args.repeatCount,
      );
    });

    const results = await Promise.all(promises);

    for (const r of results) {
      if (r.passed) passed++;
    }

    console.log('');
  }

  // Write summary
  const summaryFile = join(runDir, 'summary.json');
  writeSummary(runDir, timestamp, eforgeVersion, total, passed);
  printSummaryTable(summaryFile, args.repeatCount);

  // Run analysis
  console.log('');
  console.log('Running analysis...');
  try {
    execSync(`npx tsx "${join(SCRIPT_DIR, 'lib', 'analyze.ts')}" "${runDir}"`, {
      cwd: SCRIPT_DIR,
      stdio: 'pipe',
    });
    printObservations(join(runDir, 'analysis.json'));
  } catch {
    console.log('  Analysis skipped (no data or error)');
  }

  // Run backend comparison
  console.log('');
  console.log('Running backend comparison...');
  try {
    execSync(`npx tsx "${join(SCRIPT_DIR, 'lib', 'compare.ts')}" "${runDir}"`, {
      cwd: SCRIPT_DIR,
      stdio: 'inherit',
    });
  } catch {
    // comparison may have no groups — that's fine
  }

  // Baseline comparison
  if (args.compareTimestamp) {
    const baselineSummary = join(RESULTS_DIR, args.compareTimestamp, 'summary.json');
    printBaselineComparison(summaryFile, baselineSummary);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
