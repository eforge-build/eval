import {
  getSettingsListTheme,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Box, Container, type SettingItem, SettingsList, Text } from "@mariozechner/pi-tui";
import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const PROJECT_ROOT = findProjectRoot(process.cwd());
const RUN_SCRIPT = join(PROJECT_ROOT, "run.sh");
const RESULTS_DIR = join(PROJECT_ROOT, "results");
const SCENARIOS_FILE = join(PROJECT_ROOT, "scenarios.yaml");
const PROFILES_DIR = join(PROJECT_ROOT, "eforge", "profiles");
const PROFILE_ENVS_FILE = join(PROJECT_ROOT, "profile-envs.yaml");
const EXTENSION_LOG_DIR = join(PROJECT_ROOT, ".pi", "eval-runs");
const STATUS_ID = "eforge-eval";
const MESSAGE_TYPE = "eforge-eval";
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;

type ScenarioMeta = {
  id: string;
  fixture: string;
  prd: string;
  description?: string;
  validate?: string[];
  expect?: Record<string, unknown>;
};

type ProfileDef = {
  name: string;
  envFiles?: string[];
};

type RunSummary = {
  timestamp?: string;
  eforgeVersion?: string;
  passed?: number;
  totalScenarios?: number;
  totals?: {
    costUsd?: number;
    durationSeconds?: number;
    tokens?: { total?: number; input?: number; cacheRead?: number };
  };
  scenarios?: ScenarioResultSummary[];
};

type ScenarioResultSummary = {
  scenario: string;
  eforgeExitCode?: number;
  validation?: Record<string, { passed?: boolean }>;
  expectations?: { passed?: boolean; checks?: Array<{ check: string; passed: boolean; expected?: unknown; actual?: unknown }> };
  durationSeconds?: number;
  metrics?: {
    costUsd?: number;
    tokens?: { total?: number; input?: number; cacheRead?: number };
  };
  quality?: { absolute?: { overall?: { weighted?: number } } };
};

type RunRecord = {
  runId: string;
  args: string[];
  logFile: string;
  pid?: number;
  startedAt: number;
};

type RunStatus = {
  runId: string;
  state: "starting" | "running" | "complete" | "missing";
  completedScenarios: number;
  summary?: RunSummary;
};

type RunOptions = {
  profile?: string;
  scenarios: string[];
  all: boolean;
  repeat?: number;
  compare?: string;
  envFile?: string;
  dryRun: boolean;
  skipQuality: boolean;
};

export default function eforgeEvalExtension(pi: ExtensionAPI) {
  let activeRun: RunRecord | undefined;
  let pollTimer: NodeJS.Timeout | undefined;

  function sendEvalMessage(content: string, details?: Record<string, unknown>) {
    pi.sendMessage({
      customType: MESSAGE_TYPE,
      content,
      display: true,
      details: { timestamp: Date.now(), ...details },
    });
  }

  function updateStatus(ctx: ExtensionContext, status?: RunStatus) {
    if (!ctx.hasUI) return;
    const theme = ctx.ui.theme;
    if (!activeRun && !status) {
      ctx.ui.setStatus(STATUS_ID, undefined);
      return;
    }

    const runId = status?.runId ?? activeRun?.runId ?? "eval";
    if (status?.state === "complete") {
      const passed = status.summary?.passed ?? 0;
      const total = status.summary?.totalScenarios ?? status.completedScenarios;
      ctx.ui.setStatus(STATUS_ID, `${theme.fg("success", "✓ eval")} ${theme.fg("dim", `${runId} ${passed}/${total}`)}`);
      return;
    }
    if (status?.state === "missing") {
      ctx.ui.setStatus(STATUS_ID, `${theme.fg("warning", "? eval")} ${theme.fg("dim", runId)}`);
      return;
    }

    const count = status?.completedScenarios ?? 0;
    const suffix = count > 0 ? ` ${count} result${count === 1 ? "" : "s"}` : " running";
    ctx.ui.setStatus(STATUS_ID, `${theme.fg("accent", "● eval")} ${theme.fg("dim", `${runId}${suffix}`)}`);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
  }

  function startPolling(ctx: ExtensionContext) {
    stopPolling();
    if (!activeRun) return;

    const tick = () => {
      if (!activeRun) return;
      const status = getRunStatus(activeRun.runId);
      updateStatus(ctx, status);
      if (status.state === "complete") {
        const completed = activeRun;
        activeRun = undefined;
        stopPolling();
        ctx.ui.notify(`Eval run ${completed.runId} completed`, "info");
        sendEvalMessage(formatRunStatus(status), { runId: completed.runId, logFile: completed.logFile });
      }
    };

    tick();
    pollTimer = setInterval(tick, 15_000);
    pollTimer.unref?.();
  }

  pi.registerMessageRenderer(MESSAGE_TYPE, (message, _options, theme) => {
    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
    box.addChild(new Text(String(message.content ?? ""), 0, 0));
    return box;
  });

  pi.registerCommand("eval", {
    description: "Open the eforge eval menu",
    handler: async (_args, ctx) => {
      const choice = await ctx.ui.select("Eforge eval", [
        "Run eval",
        "Show active/latest status",
        "View run summary",
        "View scenario result",
        "View profile comparison",
        "List scenarios",
        "List profiles",
      ]);

      switch (choice) {
        case "Run eval":
          await runEvalInteractive(ctx);
          break;
        case "Show active/latest status":
          await showStatus(ctx, undefined);
          break;
        case "View run summary":
          await showRunSummary(ctx, undefined);
          break;
        case "View scenario result":
          await showScenarioResult(ctx, undefined, undefined);
          break;
        case "View profile comparison":
          await showComparison(ctx, undefined);
          break;
        case "List scenarios":
          sendEvalMessage(formatScenarios(loadScenarios()));
          break;
        case "List profiles":
          sendEvalMessage(formatProfiles(loadProfiles()));
          break;
      }
    },
  });

  pi.registerCommand("eval-run", {
    description: "Start an eval run. Usage: /eval-run --profile PROFILE[,PROFILE] [--all|SCENARIO...] [--skip-quality]",
    getArgumentCompletions: (prefix) => completions(prefix),
    handler: async (args, ctx) => {
      if (args.trim()) {
        await runEvalFromArgs(args, ctx);
      } else {
        await runEvalInteractive(ctx);
      }
    },
  });

  pi.registerCommand("eval-status", {
    description: "Show status for the active, latest, or specified eval run",
    getArgumentCompletions: (prefix) => runCompletions(prefix),
    handler: async (args, ctx) => showStatus(ctx, args.trim() || undefined),
  });

  pi.registerCommand("eval-runs", {
    description: "Pick a completed eval run and show its summary",
    getArgumentCompletions: (prefix) => runCompletions(prefix),
    handler: async (args, ctx) => showRunSummary(ctx, args.trim() || undefined),
  });

  pi.registerCommand("eval-result", {
    description: "Show a scenario result.json. Usage: /eval-result [RUN_ID] [SCENARIO_ID]",
    getArgumentCompletions: (prefix) => runCompletions(prefix),
    handler: async (args, ctx) => {
      const parts = splitArgs(args);
      await showScenarioResult(ctx, parts[0], parts[1]);
    },
  });

  pi.registerCommand("eval-compare", {
    description: "Show comparison.json for a run",
    getArgumentCompletions: (prefix) => runCompletions(prefix),
    handler: async (args, ctx) => showComparison(ctx, args.trim() || undefined),
  });

  pi.registerCommand("eval-scenarios", {
    description: "List available eval scenarios",
    getArgumentCompletions: (prefix) => scenarioCompletions(prefix),
    handler: async () => sendEvalMessage(formatScenarios(loadScenarios())),
  });

  pi.registerCommand("eval-profiles", {
    description: "List available eval profiles",
    getArgumentCompletions: (prefix) => profileCompletions(prefix),
    handler: async () => sendEvalMessage(formatProfiles(loadProfiles())),
  });

  pi.on("session_start", async (_event, ctx) => {
    activeRun = restoreActiveRun(ctx) ?? findLatestIncompleteRun();
    if (activeRun) startPolling(ctx);
  });

  pi.on("session_shutdown", async () => {
    stopPolling();
  });

  async function runEvalInteractive(ctx: ExtensionCommandContext) {
    const profiles = loadProfiles();
    if (profiles.length === 0) {
      ctx.ui.notify("No profiles found in eforge/profiles", "error");
      return;
    }

    const defaultProfile = profiles.find((p) => p.name === "claude-sdk-opus")?.name ?? profiles[0]!.name;
    const profile = await pickProfiles(ctx, profiles, defaultProfile);
    if (!profile) return;

    const scenarioSelection = await pickScenarios(ctx, loadScenarios());
    if (!scenarioSelection) return;

    const repeatInput = await ctx.ui.input("Repeat count", "Number of times to run each selected scenario (default: 1)");
    if (repeatInput === undefined) return;
    const repeat = repeatInput.trim() === "" ? 1 : Number(repeatInput.trim());
    if (!Number.isInteger(repeat) || repeat < 1) {
      ctx.ui.notify("Repeat count must be a positive integer", "error");
      return;
    }

    const skipQuality = await ctx.ui.confirm("Quality scoring", "Skip LLM-as-judge quality scoring for this run?");
    const dryRun = await ctx.ui.confirm("Dry run", "Set up workspaces only and skip eforge/validation?");

    let compare: string | undefined;
    let envFile: string | undefined;
    const configureAdvanced = await ctx.ui.confirm("Advanced options", "Configure baseline comparison and extra env file?");
    if (configureAdvanced) {
      compare = await pickOptionalCompareRun(ctx);
      const envFileInput = await ctx.ui.input("Extra env file", "Optional path for --env-file (leave empty for none)");
      if (envFileInput === undefined) return;
      envFile = envFileInput.trim() || undefined;
    }

    const opts: RunOptions = {
      profile: profile.trim(),
      scenarios: scenarioSelection.scenarios,
      all: scenarioSelection.all,
      repeat,
      compare,
      envFile,
      dryRun,
      skipQuality,
    };
    await startRun(opts, ctx);
  }

  async function pickScenarios(
    ctx: ExtensionCommandContext,
    scenarios: ScenarioMeta[],
  ): Promise<{ all: boolean; scenarios: string[] } | undefined> {
    const scope = await ctx.ui.select("Scenario scope", ["All scenarios", "Select scenarios"]);
    if (!scope) return undefined;
    if (scope === "All scenarios") return { all: true, scenarios: [] };

    const selectedScenarios = new Set<string>();
    const result = await ctx.ui.custom<string[]>((tui, theme, _kb, done) => {
      const items: SettingItem[] = scenarios.map((scenario) => ({
        id: scenario.id,
        label: scenario.id,
        currentValue: selectedScenarios.has(scenario.id) ? "selected" : "off",
        values: ["selected", "off"],
      }));

      const container = new Container();
      container.addChild(new Text(theme.fg("accent", theme.bold("Select eval scenarios")), 1, 0));
      container.addChild(new Text(theme.fg("dim", "Toggle one or more scenarios, then close this panel."), 1, 0));

      const settingsList = new SettingsList(
        items,
        Math.min(items.length + 2, 18),
        getSettingsListTheme(),
        (id, newValue) => {
          if (newValue === "selected") selectedScenarios.add(id);
          else selectedScenarios.delete(id);
        },
        () => done(Array.from(selectedScenarios)),
        { enableSearch: true },
      );
      container.addChild(settingsList);

      return {
        render(width: number) {
          return container.render(width);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          settingsList.handleInput?.(data);
          tui.requestRender();
        },
      };
    });

    if (result.length === 0) {
      ctx.ui.notify("Select at least one scenario", "warning");
      return undefined;
    }
    return { all: false, scenarios: result };
  }

  async function pickOptionalCompareRun(ctx: ExtensionCommandContext): Promise<string | undefined> {
    const runs = listRuns().slice(-30).reverse();
    if (runs.length === 0) return undefined;
    const selected = await ctx.ui.select("Baseline comparison", [
      "No baseline comparison",
      ...runs.map((run) => {
        const summary = run.summary;
        const pass = `${summary?.passed ?? 0}/${summary?.totalScenarios ?? 0}`;
        return `${run.runId}  ${pass}  ${formatCurrency(summary?.totals?.costUsd)}`;
      }),
    ]);
    if (!selected || selected === "No baseline comparison") return undefined;
    return selected.split(/\s+/)[0];
  }

  async function pickProfiles(
    ctx: ExtensionCommandContext,
    profiles: ProfileDef[],
    defaultProfile: string,
  ): Promise<string | undefined> {
    const selectedProfiles = new Set<string>([defaultProfile]);

    const result = await ctx.ui.custom<string[]>((tui, theme, _kb, done) => {
      const items: SettingItem[] = profiles.map((profile) => ({
        id: profile.name,
        label: profile.name,
        currentValue: selectedProfiles.has(profile.name) ? "selected" : "off",
        values: ["selected", "off"],
      }));

      const container = new Container();
      container.addChild(new Text(theme.fg("accent", theme.bold("Select eval profiles")), 1, 0));
      container.addChild(
        new Text(theme.fg("dim", "Toggle one or more profiles, then close this panel to continue."), 1, 0),
      );

      const settingsList = new SettingsList(
        items,
        Math.min(items.length + 2, 18),
        getSettingsListTheme(),
        (id, newValue) => {
          if (newValue === "selected") selectedProfiles.add(id);
          else selectedProfiles.delete(id);
        },
        () => done(Array.from(selectedProfiles)),
        { enableSearch: true },
      );
      container.addChild(settingsList);

      return {
        render(width: number) {
          return container.render(width);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          settingsList.handleInput?.(data);
          tui.requestRender();
        },
      };
    });

    if (result.length === 0) {
      ctx.ui.notify("Select at least one profile", "warning");
      return undefined;
    }
    return result.join(",");
  }

  async function runEvalFromArgs(args: string, ctx: ExtensionCommandContext) {
    const opts = parseRunArgs(args);
    if (!opts.profile) {
      ctx.ui.notify("Missing --profile. Run /eval-run with no args for the wizard.", "error");
      return;
    }
    if (!opts.all && opts.scenarios.length === 0) opts.all = true;
    await startRun(opts, ctx);
  }

  async function startRun(opts: RunOptions, ctx: ExtensionCommandContext) {
    const validation = validateRunOptions(opts);
    if (validation.length > 0) {
      ctx.ui.notify(validation.join("\n"), "error");
      return;
    }

    mkdirSync(EXTENSION_LOG_DIR, { recursive: true });
    const startedAt = Date.now();
    const expectedRunId = formatTimestamp(new Date(startedAt));
    const args = buildRunArgs(opts);
    const logFile = join(EXTENSION_LOG_DIR, `${expectedRunId}.log`);
    const fd = openSync(logFile, "a");

    let child;
    try {
      child = spawn(RUN_SCRIPT, args, {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: ["ignore", fd, fd],
      });
    } catch (error) {
      closeSync(fd);
      ctx.ui.notify(`Failed to start eval: ${error instanceof Error ? error.message : String(error)}`, "error");
      return;
    }
    closeSync(fd);
    child.on("error", (error) => {
      ctx.ui.notify(`Eval process error: ${error.message}`, "error");
    });
    child.unref();

    activeRun = { runId: expectedRunId, args, logFile, pid: child.pid, startedAt };
    pi.appendEntry<RunRecord>("eforge-eval-active-run", activeRun);
    ctx.ui.notify(`Started eval run ${expectedRunId}`, "info");
    sendEvalMessage(formatStartedRun(activeRun), { runId: expectedRunId, logFile });

    await sleep(1_500);
    const actualRunId = findNewestRunSince(startedAt - 2_000)?.runId;
    if (activeRun && actualRunId && actualRunId !== activeRun.runId) {
      activeRun = { ...activeRun, runId: actualRunId };
      pi.appendEntry<RunRecord>("eforge-eval-active-run", activeRun);
    }
    startPolling(ctx);
  }

  async function showStatus(ctx: ExtensionCommandContext, runIdArg?: string) {
    const runId = runIdArg ?? activeRun?.runId ?? listRuns({ includeIncomplete: true }).at(-1)?.runId;
    if (!runId) {
      ctx.ui.notify("No eval runs found", "info");
      return;
    }
    const status = getRunStatus(runId);
    updateStatus(ctx, status);
    sendEvalMessage(formatRunStatus(status));
  }

  async function showRunSummary(ctx: ExtensionCommandContext, runIdArg?: string) {
    const runId = runIdArg ?? (await pickRun(ctx, "Pick eval run"));
    if (!runId) return;
    const summary = readSummary(runId);
    if (!summary) {
      sendEvalMessage(`No summary.json found for ${runId}.\n\n${formatRunStatus(getRunStatus(runId))}`);
      return;
    }
    sendEvalMessage(formatSummary(summary, runId), { runId });
  }

  async function showScenarioResult(ctx: ExtensionCommandContext, runIdArg?: string, scenarioArg?: string) {
    const runId = runIdArg ?? (await pickRun(ctx, "Pick eval run"));
    if (!runId) return;
    const scenario = scenarioArg ?? (await pickScenarioResult(ctx, runId));
    if (!scenario) return;

    const resultPath = join(RESULTS_DIR, runId, scenario, "result.json");
    if (!existsSync(resultPath)) {
      ctx.ui.notify(`No result.json found for ${scenario}`, "error");
      return;
    }
    const result = JSON.parse(readFileSync(resultPath, "utf8")) as ScenarioResultSummary & { profile?: { name?: string } };
    sendEvalMessage(formatScenarioResult(result, scenario, runId), { runId, scenario });
  }

  async function showComparison(ctx: ExtensionCommandContext, runIdArg?: string) {
    const runId = runIdArg ?? (await pickRun(ctx, "Pick eval run"));
    if (!runId) return;
    const comparisonPath = join(RESULTS_DIR, runId, "comparison.json");
    if (!existsSync(comparisonPath)) {
      ctx.ui.notify(`No comparison.json found for ${runId}`, "warning");
      return;
    }
    const comparison = JSON.parse(readFileSync(comparisonPath, "utf8")) as Record<string, unknown>;
    sendEvalMessage(formatComparison(comparison, runId), { runId });
  }
}

function findProjectRoot(start: string): string {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, "run.sh")) && existsSync(join(dir, "scenarios.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

function loadScenarios(): ScenarioMeta[] {
  const parsed = parseYaml(readFileSync(SCENARIOS_FILE, "utf8")) as { scenarios?: ScenarioMeta[] };
  return parsed.scenarios ?? [];
}

function loadProfiles(): ProfileDef[] {
  const envMap = loadProfileEnvMap();
  if (!existsSync(PROFILES_DIR)) return [];
  return readdirSync(PROFILES_DIR)
    .filter((file) => extname(file) === ".yaml")
    .map((file) => basename(file, ".yaml"))
    .sort()
    .map((name) => {
      const envEntry = envMap[name];
      const envFiles = envEntry?.envFiles?.length ? envEntry.envFiles : envEntry?.envFile ? [envEntry.envFile] : undefined;
      return { name, ...(envFiles ? { envFiles } : {}) };
    });
}

function loadProfileEnvMap(): Record<string, { envFile?: string; envFiles?: string[] }> {
  if (!existsSync(PROFILE_ENVS_FILE)) return {};
  const parsed = parseYaml(readFileSync(PROFILE_ENVS_FILE, "utf8")) as {
    profiles?: Record<string, { envFile?: string; envFiles?: string[] }>;
  };
  return parsed.profiles ?? {};
}

function parseRunArgs(args: string): RunOptions {
  const tokens = splitArgs(args);
  const opts: RunOptions = { scenarios: [], all: false, dryRun: false, skipQuality: false };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    switch (token) {
      case "--profile":
        opts.profile = tokens[++i];
        break;
      case "--all":
        opts.all = true;
        break;
      case "--repeat":
        opts.repeat = Number(tokens[++i]);
        break;
      case "--compare":
        opts.compare = tokens[++i];
        break;
      case "--env-file":
        opts.envFile = tokens[++i];
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--skip-quality":
        opts.skipQuality = true;
        break;
      default:
        opts.scenarios.push(token);
        break;
    }
  }
  return opts;
}

function buildRunArgs(opts: RunOptions): string[] {
  const args = ["--profile", opts.profile!];
  if (opts.repeat && opts.repeat > 1) args.push("--repeat", String(opts.repeat));
  if (opts.compare) args.push("--compare", opts.compare);
  if (opts.envFile) args.push("--env-file", opts.envFile);
  if (opts.dryRun) args.push("--dry-run");
  if (opts.skipQuality) args.push("--skip-quality");
  if (opts.all || opts.scenarios.length === 0) args.push("--all");
  else args.push(...opts.scenarios);
  return args;
}

function validateRunOptions(opts: RunOptions): string[] {
  const errors: string[] = [];
  const profiles = new Set(loadProfiles().map((p) => p.name));
  const scenarios = new Set(loadScenarios().map((s) => s.id));

  for (const profile of (opts.profile ?? "").split(",").map((p) => p.trim()).filter(Boolean)) {
    if (!profiles.has(profile)) errors.push(`Unknown profile: ${profile}`);
  }
  for (const scenario of opts.scenarios) {
    if (!scenarios.has(scenario)) errors.push(`Unknown scenario: ${scenario}`);
  }
  if (opts.repeat !== undefined && (!Number.isFinite(opts.repeat) || opts.repeat < 1)) {
    errors.push("--repeat must be a positive number");
  }
  return errors;
}

function splitArgs(args: string): string[] {
  return (args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((token) => {
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
      return token.slice(1, -1);
    }
    return token;
  });
}

function listRuns(opts: { includeIncomplete?: boolean } = {}): Array<{ runId: string; summary?: RunSummary; mtimeMs: number }> {
  if (!existsSync(RESULTS_DIR)) return [];
  return readdirSync(RESULTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && TIMESTAMP_PATTERN.test(entry.name))
    .map((entry) => {
      const runDir = join(RESULTS_DIR, entry.name);
      return { runId: entry.name, summary: readSummary(entry.name), mtimeMs: statSync(runDir).mtimeMs };
    })
    .filter((run) => opts.includeIncomplete || Boolean(run.summary))
    .sort((a, b) => a.runId.localeCompare(b.runId));
}

function readSummary(runId: string): RunSummary | undefined {
  const summaryPath = join(RESULTS_DIR, runId, "summary.json");
  if (!existsSync(summaryPath)) return undefined;
  return JSON.parse(readFileSync(summaryPath, "utf8")) as RunSummary;
}

function getRunStatus(runId: string): RunStatus {
  const runDir = join(RESULTS_DIR, runId);
  if (!existsSync(runDir)) return { runId, state: "starting", completedScenarios: 0 };
  const summary = readSummary(runId);
  const completedScenarios = readdirSync(runDir, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && existsSync(join(runDir, entry.name, "result.json")),
  ).length;
  if (summary) return { runId, state: "complete", completedScenarios, summary };
  return { runId, state: "running", completedScenarios };
}

function findNewestRunSince(startedAt: number): { runId: string; mtimeMs: number } | undefined {
  return listRuns({ includeIncomplete: true })
    .filter((run) => run.mtimeMs >= startedAt)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
}

function findLatestIncompleteRun(): RunRecord | undefined {
  const run = listRuns({ includeIncomplete: true }).filter((candidate) => !candidate.summary).at(-1);
  if (!run) return undefined;
  return { runId: run.runId, args: [], logFile: "", startedAt: run.mtimeMs };
}

function restoreActiveRun(ctx: ExtensionContext): RunRecord | undefined {
  const entries = ctx.sessionManager.getBranch();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "custom" && entry.customType === "eforge-eval-active-run") {
      const data = entry.data as RunRecord | undefined;
      if (data?.runId && getRunStatus(data.runId).state !== "complete") return data;
      return undefined;
    }
  }
  return undefined;
}

async function pickRun(ctx: ExtensionCommandContext, title: string): Promise<string | undefined> {
  const runs = listRuns().slice(-30).reverse();
  if (runs.length === 0) {
    ctx.ui.notify("No completed eval runs found", "info");
    return undefined;
  }
  const selected = await ctx.ui.select(
    title,
    runs.map((run) => {
      const summary = run.summary;
      const pass = `${summary?.passed ?? 0}/${summary?.totalScenarios ?? 0}`;
      const cost = formatCurrency(summary?.totals?.costUsd);
      return `${run.runId}  ${pass}  ${cost}`;
    }),
  );
  return selected?.split(/\s+/)[0];
}

async function pickScenarioResult(ctx: ExtensionCommandContext, runId: string): Promise<string | undefined> {
  const runDir = join(RESULTS_DIR, runId);
  if (!existsSync(runDir)) {
    ctx.ui.notify(`Run not found: ${runId}`, "error");
    return undefined;
  }
  const items = readdirSync(runDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(runDir, entry.name, "result.json")))
    .map((entry) => {
      const result = JSON.parse(readFileSync(join(runDir, entry.name, "result.json"), "utf8")) as ScenarioResultSummary;
      return `${entry.name}  ${scenarioStatus(result)}  ${formatCurrency(result.metrics?.costUsd)}`;
    })
    .sort();
  if (items.length === 0) {
    ctx.ui.notify(`No scenario results found for ${runId}`, "warning");
    return undefined;
  }
  const selected = await ctx.ui.select("Pick scenario result", items);
  return selected?.split(/\s+/)[0];
}

function completions(prefix: string) {
  const last = prefix.split(/\s+/).at(-1) ?? prefix;
  return [
    ...["--profile", "--all", "--skip-quality", "--dry-run", "--repeat", "--compare", "--env-file"].map((value) => ({
      value,
      label: value,
    })),
    ...loadProfiles().map((profile) => ({ value: profile.name, label: profile.name, description: "profile" })),
    ...loadScenarios().map((scenario) => ({ value: scenario.id, label: scenario.id, description: scenario.description })),
  ].filter((item) => item.value.startsWith(last));
}

function profileCompletions(prefix: string) {
  return loadProfiles()
    .filter((profile) => profile.name.startsWith(prefix))
    .map((profile) => ({ value: profile.name, label: profile.name, description: profile.envFiles?.join(", ") }));
}

function scenarioCompletions(prefix: string) {
  return loadScenarios()
    .filter((scenario) => scenario.id.startsWith(prefix))
    .map((scenario) => ({ value: scenario.id, label: scenario.id, description: scenario.description }));
}

function runCompletions(prefix: string) {
  return listRuns({ includeIncomplete: true })
    .filter((run) => run.runId.startsWith(prefix))
    .slice(-30)
    .reverse()
    .map((run) => ({ value: run.runId, label: run.runId, description: run.summary ? "complete" : "running" }));
}

function formatStartedRun(run: RunRecord): string {
  return [
    `Started eforge eval run ${run.runId}`,
    "",
    `Command: ./run.sh ${run.args.map(shellQuote).join(" ")}`,
    run.pid ? `PID: ${run.pid}` : undefined,
    `Log: ${relative(run.logFile)}`,
    `Monitor: ${getMonitorUrl() ?? "starting..."}`,
    "",
    `Use /eval-status ${run.runId} to refresh status.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatRunStatus(status: RunStatus): string {
  if (status.state === "complete" && status.summary) {
    return formatSummary(status.summary, status.runId);
  }
  return [
    `Eval run ${status.runId}`,
    "",
    `State: ${status.state}`,
    `Completed scenario result files: ${status.completedScenarios}`,
    `Monitor: ${getMonitorUrl() ?? "not available yet"}`,
  ].join("\n");
}

function formatSummary(summary: RunSummary, fallbackRunId: string): string {
  const timestamp = summary.timestamp ?? fallbackRunId;
  const scenarios = summary.scenarios ?? [];
  const lines = [
    `Eforge Eval Results (${timestamp})`,
    summary.eforgeVersion ? `eforge ${summary.eforgeVersion}` : undefined,
    "",
    `Passed: ${summary.passed ?? 0}/${summary.totalScenarios ?? scenarios.length}`,
    `Totals: ${formatTokens(summary.totals?.tokens?.total)} tokens, ${formatCache(summary.totals?.tokens)}, ${formatCurrency(summary.totals?.costUsd)}, ${formatDuration(summary.totals?.durationSeconds)}`,
    "",
    "Scenarios:",
    ...scenarios.map((scenario) => {
      const quality = scenario.quality?.absolute?.overall?.weighted;
      const qualityText = quality !== undefined ? ` q=${quality.toFixed(2)}` : "";
      return `  ${scenarioStatus(scenario).padEnd(4)} ${scenario.scenario}  ${formatCurrency(scenario.metrics?.costUsd).padEnd(7)} ${formatDuration(scenario.durationSeconds)}${qualityText}`;
    }),
    "",
    `Details: results/${fallbackRunId}/`,
  ];
  return lines.filter((line) => line !== undefined).join("\n");
}

function formatScenarioResult(result: ScenarioResultSummary & { profile?: { name?: string } }, scenarioName: string, runId: string): string {
  const validation = result.validation ? Object.entries(result.validation) : [];
  const expectationChecks = result.expectations?.checks ?? [];
  return [
    `Scenario result: ${scenarioName}`,
    `Run: ${runId}`,
    result.profile?.name ? `Profile: ${result.profile.name}` : undefined,
    "",
    `Status: ${scenarioStatus(result)}`,
    `Eforge exit: ${result.eforgeExitCode ?? "?"}`,
    `Duration: ${formatDuration(result.durationSeconds)}`,
    `Cost: ${formatCurrency(result.metrics?.costUsd)}`,
    `Tokens: ${formatTokens(result.metrics?.tokens?.total)} (${formatCache(result.metrics?.tokens)})`,
    result.quality?.absolute?.overall?.weighted !== undefined
      ? `Quality: ${result.quality.absolute.overall.weighted.toFixed(2)}`
      : undefined,
    "",
    validation.length > 0 ? "Validation:" : undefined,
    ...validation.map(([name, value]) => `  ${value.passed ? "PASS" : "FAIL"} ${name}`),
    expectationChecks.length > 0 ? "" : undefined,
    expectationChecks.length > 0 ? "Expectations:" : undefined,
    ...expectationChecks.map((check) => `  ${check.passed ? "PASS" : "FAIL"} ${check.check}: expected ${stringifyShort(check.expected)}, actual ${stringifyShort(check.actual)}`),
    "",
    `File: results/${runId}/${scenarioName}/result.json`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

function formatComparison(comparison: Record<string, unknown>, runId: string): string {
  const groups = Array.isArray(comparison["groups"]) ? (comparison["groups"] as Array<Record<string, unknown>>) : [];
  const lines = [`Profile comparison: ${runId}`, ""];
  if (groups.length === 0) {
    lines.push("No comparison groups found.");
  } else {
    for (const group of groups.slice(0, 20)) {
      const groupId = String(group["groupId"] ?? group["scenario"] ?? "group");
      lines.push(groupId);
      const dimensions = group["dimensions"] as Record<string, unknown> | undefined;
      if (dimensions) {
        for (const [name, value] of Object.entries(dimensions)) {
          lines.push(`  ${name}: ${formatDimension(value)}`);
        }
      }
      lines.push("");
    }
  }
  lines.push(`File: results/${runId}/comparison.json`);
  return lines.join("\n");
}

function formatDimension(value: unknown): string {
  if (!value || typeof value !== "object") return stringifyShort(value);
  const obj = value as Record<string, unknown>;
  const winner = obj["winner"] ?? obj["bestProfile"] ?? obj["best"] ?? obj["summary"];
  return winner ? stringifyShort(winner) : stringifyShort(obj).slice(0, 120);
}

function getMonitorUrl(): string | undefined {
  for (const lockPath of [join(RESULTS_DIR, ".eforge", "daemon.lock"), join(PROJECT_ROOT, ".eforge", "daemon.lock")]) {
    if (!existsSync(lockPath)) continue;
    try {
      const lock = JSON.parse(readFileSync(lockPath, "utf8")) as { port?: unknown };
      if (typeof lock.port === "number") return `http://localhost:${lock.port}`;
    } catch {
      // Ignore malformed/stale lock files.
    }
  }
  return undefined;
}

function formatScenarios(scenarios: ScenarioMeta[]): string {
  return [
    `Eval scenarios (${scenarios.length})`,
    "",
    ...scenarios.map((s) => `  ${s.id}\n    fixture: ${s.fixture}\n    prd: ${s.prd}\n    ${s.description ?? ""}`),
  ].join("\n");
}

function formatProfiles(profiles: ProfileDef[]): string {
  return [
    `Eval profiles (${profiles.length})`,
    "",
    ...profiles.map((p) => `  ${p.name}${p.envFiles?.length ? `\n    env: ${p.envFiles.join(", ")}` : ""}`),
  ].join("\n");
}

function scenarioStatus(result: ScenarioResultSummary): string {
  const eforgeOk = result.eforgeExitCode === 0;
  const validateOk = Object.values(result.validation ?? {}).every((value) => value.passed);
  const skipOk = !(result.expectations?.checks ?? []).some((check) => check.check === "skip" && check.passed === false);
  return eforgeOk && validateOk && skipOk ? "PASS" : "FAIL";
}

function formatTokens(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function formatCurrency(value?: number): string {
  return value === undefined || !Number.isFinite(value) ? "-" : `$${value.toFixed(2)}`;
}

function formatDuration(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "-";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

function formatCache(tokens?: { input?: number; cacheRead?: number }): string {
  if (!tokens?.input || !tokens.cacheRead) return "- cached";
  return `${Math.round((tokens.cacheRead / tokens.input) * 100)}% cached`;
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "").slice(0, 19);
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=,-]+$/.test(value) ? value : JSON.stringify(value);
}

function relative(path: string): string {
  return path.startsWith(PROJECT_ROOT + "/") ? path.slice(PROJECT_ROOT.length + 1) : path;
}

function stringifyShort(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
