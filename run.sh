#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES_DIR="$SCRIPT_DIR/fixtures"
RESULTS_DIR="$SCRIPT_DIR/results"
SCENARIOS_FILE="$SCRIPT_DIR/scenarios.yaml"
MAX_RUNS=50  # Keep only the most recent N runs; older ones are pruned automatically

# Source the scenario runner
source "$SCRIPT_DIR/lib/run-scenario.sh"

# Parse scenarios.yaml into tab-separated fields using node
# Fields: id, fixture, prd, validate (||| delimited), description, expect (JSON), configOverlay (JSON)
parse_scenarios() {
  npx tsx -e "
    import { readFileSync } from 'fs';
    import { parse } from 'yaml';
    const data = parse(readFileSync('$SCENARIOS_FILE', 'utf8'));
    for (const s of data.scenarios) {
      const validate = (s.validate || []).join('|||');
      const expect = JSON.stringify(s.expect || {});
      const configOverlay = JSON.stringify(s.configOverlay || {});
      console.log([s.id, s.fixture, s.prd, validate, s.description, expect, configOverlay].join('\t'));
    }
  "
}

# Cleanup all eval results
cleanup() {
  echo "Cleaning up all eval results..."
  if [[ -d "$RESULTS_DIR" ]]; then
    rm -rf "$RESULTS_DIR"
    echo "Removed $RESULTS_DIR"
  else
    echo "Nothing to clean."
  fi
}

# Prune old runs, keeping only the most recent MAX_RUNS
prune_old_runs() {
  [[ -d "$RESULTS_DIR" ]] || return 0
  local runs=()
  # Timestamped dirs sort lexicographically (oldest first)
  while IFS= read -r dir; do
    runs+=("$dir")
  done < <(ls -1d "$RESULTS_DIR"/????-??-??T* 2>/dev/null | sort)
  local count=${#runs[@]}
  if (( count <= MAX_RUNS )); then
    return 0
  fi
  local to_remove=$(( count - MAX_RUNS ))
  echo "Pruning $to_remove old run(s) (keeping last $MAX_RUNS)..."
  for (( i=0; i<to_remove; i++ )); do
    echo "  Removing ${runs[$i]}"
    rm -rf "${runs[$i]}"
  done
}

# Print summary table
print_summary() {
  local summary_file="$1"
  local repeat_count="$2"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  node -e "
    const s = JSON.parse(require('fs').readFileSync('$summary_file', 'utf8'));
    const repeat = $repeat_count;
    const pad = (str, len) => str.padEnd(len);
    console.log('Eforge Eval Results (' + s.timestamp + ')');
    console.log('eforge ' + s.eforgeVersion);
    console.log('');
    const cols = repeat > 1
      ? pad('Scenario', 35) + pad('Pass Rate', 12) + pad('Tokens', 10) + pad('Cache', 10) + pad('Cost', 10) + 'Duration'
      : pad('Scenario', 35) + pad('Eforge', 10) + pad('Validate', 12) + pad('Expect', 10) + pad('Tokens', 10) + pad('Cache', 10) + pad('Cost', 10) + 'Duration';
    console.log(cols);
    console.log('-'.repeat(110));
    for (const r of s.scenarios) {
      if (repeat > 1) {
        const pr = r.passRate != null ? Math.round(r.passRate * repeat) + '/' + repeat : '-';
        const tokens = r.metrics && r.metrics.tokens ? Math.round(r.metrics.tokens.total / 1000) + 'k' : '-';
        const cache = r.metrics && r.metrics.tokens && r.metrics.tokens.input > 0 && r.metrics.tokens.cacheRead
          ? Math.round(r.metrics.tokens.cacheRead / r.metrics.tokens.input * 100) + '%'
          : '-';
        const cost = r.metrics && r.metrics.costUsd != null ? '\$' + r.metrics.costUsd.toFixed(2) : '-';
        const mins = Math.floor(r.durationSeconds / 60);
        const secs = r.durationSeconds % 60;
        const duration = mins + 'm ' + secs + 's';
        console.log(pad(r.scenario, 35) + pad(pr, 12) + pad(tokens, 10) + pad(cache, 10) + pad(cost, 10) + duration);
      } else {
        const eforge = r.eforgeExitCode === 0 ? 'PASS' : 'FAIL';
        const allValid = r.validation && Object.values(r.validation).every(v => v.passed);
        const validate = r.eforgeExitCode !== 0 ? '-' : (allValid ? 'PASS' : 'FAIL');
        const expect = !r.expectations ? '-' : (r.expectations.passed ? 'PASS' : 'FAIL');
        const tokens = r.metrics && r.metrics.tokens ? Math.round(r.metrics.tokens.total / 1000) + 'k' : '-';
        const cache = r.metrics && r.metrics.tokens && r.metrics.tokens.input > 0 && r.metrics.tokens.cacheRead
          ? Math.round(r.metrics.tokens.cacheRead / r.metrics.tokens.input * 100) + '%'
          : '-';
        const cost = r.metrics && r.metrics.costUsd != null ? '\$' + r.metrics.costUsd.toFixed(2) : '-';
        const mins = Math.floor(r.durationSeconds / 60);
        const secs = r.durationSeconds % 60;
        const duration = mins + 'm ' + secs + 's';
        console.log(pad(r.scenario, 35) + pad(eforge, 10) + pad(validate, 12) + pad(expect, 10) + pad(tokens, 10) + pad(cache, 10) + pad(cost, 10) + duration);
      }
    }
    console.log('');
    console.log('Passed: ' + s.passed + '/' + s.totalScenarios);
    if (s.totals) {
      const t = s.totals;
      const totalTokens = t.tokens ? Math.round(t.tokens.total / 1000) + 'k' : '-';
      const totalCache = t.tokens && t.tokens.input > 0 && t.tokens.cacheRead
        ? Math.round(t.tokens.cacheRead / t.tokens.input * 100) + '%'
        : '-';
      const totalCost = t.costUsd != null ? '\$' + t.costUsd.toFixed(2) : '-';
      const totalMins = Math.floor(t.durationSeconds / 60);
      const totalSecs = t.durationSeconds % 60;
      console.log('Totals: ' + totalTokens + ' tokens, ' + totalCache + ' cached, ' + totalCost + ' cost, ' + totalMins + 'm ' + totalSecs + 's');
    }
    // Per-agent breakdown table
    const agentAgg = {};
    for (const r of s.scenarios) {
      if (!r.metrics || !r.metrics.agents) continue;
      for (const [role, a] of Object.entries(r.metrics.agents)) {
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
        const cache = d.inputTokens > 0 && d.cacheRead > 0 ? Math.round(d.cacheRead / d.inputTokens * 100) + '%' : '-';
        const cost = '\$' + d.costUsd.toFixed(2);
        const mins = Math.floor(d.durationMs / 1000 / 60);
        const secs = Math.floor(d.durationMs / 1000) % 60;
        const duration = mins + 'm ' + secs + 's';
        console.log(pad(agent, 25) + pad(String(d.count), 8) + pad(tokens, 12) + pad(cache, 10) + pad(cost, 10) + duration);
      }
    }
  "
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# Print comparison table between current and baseline runs
print_comparison() {
  local current_summary="$1"
  local baseline_summary="$2"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  node -e "
    const fs = require('fs');
    const curr = JSON.parse(fs.readFileSync('$current_summary', 'utf8'));
    const base = JSON.parse(fs.readFileSync('$baseline_summary', 'utf8'));
    const pad = (str, len) => str.padEnd(len);

    console.log('Comparison: ' + base.timestamp + ' → ' + curr.timestamp);
    console.log('');
    console.log(pad('Scenario', 35) + pad('Status', 14) + pad('Cost Δ', 16) + 'Token Eff Δ');
    console.log('-'.repeat(85));

    // Index baseline scenarios by name
    const baseMap = {};
    for (const s of base.scenarios) baseMap[s.scenario] = s;

    let totalCostCurr = 0, totalCostBase = 0;

    for (const r of curr.scenarios) {
      const b = baseMap[r.scenario];

      // Determine pass/fail for current
      const currPass = r.passRate != null
        ? r.passRate === 1
        : (r.eforgeExitCode === 0
            && (!r.validation || Object.values(r.validation).every(v => v.passed))
            && (!r.expectations || r.expectations.passed));

      let status = '-';
      if (b) {
        const basePass = b.passRate != null
          ? b.passRate === 1
          : (b.eforgeExitCode === 0
              && (!b.validation || Object.values(b.validation).every(v => v.passed))
              && (!b.expectations || b.expectations.passed));
        if (basePass && !currPass) status = '⬇ REGRESSED';
        else if (!basePass && currPass) status = '⬆ IMPROVED';
        else if (currPass && basePass) status = '= PASS';
        else status = '= FAIL';
      } else {
        status = currPass ? '+ NEW PASS' : '+ NEW FAIL';
      }

      // Cost delta
      const currCost = r.metrics && r.metrics.costUsd != null ? r.metrics.costUsd : 0;
      const baseCost = b && b.metrics && b.metrics.costUsd != null ? b.metrics.costUsd : 0;
      totalCostCurr += currCost;
      totalCostBase += baseCost;
      let costDelta = '-';
      if (b && baseCost > 0) {
        const diff = currCost - baseCost;
        const pct = ((diff / baseCost) * 100).toFixed(0);
        const sign = diff >= 0 ? '+' : '';
        costDelta = sign + '\$' + diff.toFixed(2) + ' (' + sign + pct + '%)';
      } else if (!b) {
        costDelta = '\$' + currCost.toFixed(2) + ' (new)';
      }

      // Token efficiency delta (tokens per second)
      let tokenEffDelta = '-';
      if (b) {
        const currTokens = r.metrics && r.metrics.tokens ? r.metrics.tokens.total : 0;
        const baseTokens = b.metrics && b.metrics.tokens ? b.metrics.tokens.total : 0;
        const currEff = r.durationSeconds > 0 ? currTokens / r.durationSeconds : 0;
        const baseEff = b.durationSeconds > 0 ? baseTokens / b.durationSeconds : 0;
        if (baseEff > 0) {
          const diff = currEff - baseEff;
          const pct = ((diff / baseEff) * 100).toFixed(0);
          const sign = diff >= 0 ? '+' : '';
          tokenEffDelta = sign + Math.round(diff) + ' t/s (' + sign + pct + '%)';
        }
      }

      console.log(pad(r.scenario, 35) + pad(status, 14) + pad(costDelta, 16) + tokenEffDelta);
    }

    // Total cost delta
    console.log('');
    if (totalCostBase > 0) {
      const totalDiff = totalCostCurr - totalCostBase;
      const totalPct = ((totalDiff / totalCostBase) * 100).toFixed(0);
      const sign = totalDiff >= 0 ? '+' : '';
      console.log('Total cost: \$' + totalCostBase.toFixed(2) + ' → \$' + totalCostCurr.toFixed(2) + ' (' + sign + totalPct + '%)');
    }
    console.log('Pass rate: ' + base.passed + '/' + base.totalScenarios + ' → ' + curr.passed + '/' + curr.totalScenarios);
  "
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# Print warning/attention observations from analysis.json
print_observations() {
  local analysis_file="$1"
  if [[ ! -f "$analysis_file" ]]; then
    return 0
  fi
  node -e "
    const fs = require('fs');
    const analysis = JSON.parse(fs.readFileSync('$analysis_file', 'utf8'));
    const important = (analysis.observations || []).filter(o => o.severity === 'warning' || o.severity === 'attention');
    if (important.length === 0) return;
    console.log('');
    console.log('⚠ Observations:');
    for (const o of important) {
      const icon = o.severity === 'warning' ? '⚠' : '🔍';
      console.log('  ' + icon + ' [' + o.severity.toUpperCase() + '] ' + o.message);
    }
  "
}

# Main
main() {
  local filters=()
  local repeat_count=1
  local compare_timestamp=""
  ENV_FILE=""      # exported for run-scenario.sh
  DRY_RUN=false    # exported for run-scenario.sh

  # Handle arguments
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --cleanup)    cleanup; exit 0 ;;
      --dry-run)    DRY_RUN=true; shift ;;
      --env-file)
        if [[ $# -lt 2 ]]; then echo "Error: --env-file requires a FILE argument"; exit 1; fi
        ENV_FILE="$(realpath "$2")"; shift 2 ;;
      --repeat)
        if [[ $# -lt 2 ]]; then echo "Error: --repeat requires an N argument"; exit 1; fi
        repeat_count="$2"; shift 2 ;;
      --compare)
        if [[ $# -lt 2 ]]; then echo "Error: --compare requires a <timestamp> argument"; exit 1; fi
        compare_timestamp="$2"; shift 2 ;;
      --help|-h)
        echo "Usage: run.sh [OPTIONS] [SCENARIO_ID...]"
        echo ""
        echo "Options:"
        echo "  --dry-run              Set up workspaces but skip eforge and validation"
        echo "  --env-file FILE        Source environment variables (e.g. Langfuse credentials)"
        echo "  --repeat N             Run each scenario N times (default: 1)"
        echo "  --compare <timestamp>  Compare results against a previous run"
        echo "  --cleanup              Remove all eval results"
        echo "  --help                 Show this help"
        echo ""
        echo "Environment:"
        echo "  EFORGE_BIN      Path to eforge binary (default: eforge on PATH)"
        exit 0
        ;;
      *)            filters+=("$1"); shift ;;
    esac
  done

  # Validate --compare timestamp
  if [[ -n "$compare_timestamp" ]]; then
    local baseline_dir="$RESULTS_DIR/$compare_timestamp"
    if [[ ! -f "$baseline_dir/summary.json" ]]; then
      echo "Error: No summary.json found at $baseline_dir"
      exit 1
    fi
  fi

  # Source env file if provided (e.g. Langfuse credentials)
  # Same as: LANGFUSE_PUBLIC_KEY=... eforge run ...
  if [[ -n "$ENV_FILE" ]]; then
    if [[ ! -f "$ENV_FILE" ]]; then
      echo "Error: env file not found: $ENV_FILE"
      exit 1
    fi
    set -a && source "$ENV_FILE" && set +a
  fi

  # Resolve eforge binary - use EFORGE_BIN env var, or eforge on PATH
  local eforge_bin="${EFORGE_BIN:-eforge}"
  if [[ "$DRY_RUN" == "false" ]]; then
    if ! command -v "$eforge_bin" &>/dev/null; then
      echo "Error: eforge not found. Install eforge or set EFORGE_BIN."
      exit 1
    fi
  fi

  # Create timestamped results directory
  local timestamp
  timestamp="$(date -u +%Y-%m-%dT%H-%M-%S)"
  local run_dir="$RESULTS_DIR/$timestamp"
  mkdir -p "$run_dir"

  # Prune old runs before starting
  prune_old_runs

  # Get eforge version info
  local eforge_version
  eforge_version="$("$eforge_bin" --version 2>/dev/null || echo 'unknown')"

  # Shared monitor DB for metrics aggregation across all scenarios.
  # Foreground eforge runs record events here via --no-monitor.
  export EFORGE_MONITOR_DB="$RESULTS_DIR/monitor.db"

  # Start monitor server from the eval repo root for a stable port.
  # EFORGE_MONITOR_DB directs it to the shared results DB.
  # Individual eforge runs still use --no-monitor (write directly to DB);
  # this server provides the web UI for observing runs.
  local monitor_url=""
  if [[ "$DRY_RUN" == "false" ]]; then
    (cd "$SCRIPT_DIR" && exec "$eforge_bin" monitor) &>/dev/null &
    disown
    sleep 1
    if [[ -f "$SCRIPT_DIR/.eforge/daemon.lock" ]]; then
      monitor_url="http://localhost:$(node -e "console.log(JSON.parse(require('fs').readFileSync('$SCRIPT_DIR/.eforge/daemon.lock','utf8')).port)")"
    fi
  fi

  echo "Eforge Eval Run"
  echo "  Version: $eforge_version"
  echo "  Results: $run_dir"
  if [[ -n "$monitor_url" ]]; then
    echo "  Monitor: $monitor_url"
  fi
  echo ""

  # Parse scenarios and run
  local results=()
  local passed=0
  local total=0

  while IFS=$'\t' read -r id fixture prd validate description expect_json config_overlay_json; do
    # Export config overlay for run-scenario.sh
    export SCENARIO_CONFIG_OVERLAY="${config_overlay_json}"
    # Filter if specified
    if [[ ${#filters[@]} -gt 0 ]]; then
      local match=false
      for f in "${filters[@]}"; do
        if [[ "$id" == "$f" ]]; then
          match=true
          break
        fi
      done
      if [[ "$match" == "false" ]]; then
        continue
      fi
    fi

    total=$((total + 1))
    echo "━━━ Scenario: $id ━━━"
    echo "  $description"
    echo "  Fixture: $fixture"
    echo "  PRD: $prd"
    if (( repeat_count > 1 )); then
      echo "  Repeats: $repeat_count"
    fi
    echo ""

    local scenario_dir="$run_dir/$id"
    mkdir -p "$scenario_dir"

    if (( repeat_count > 1 )); then
      # Run scenario multiple times with sub-directory storage
      local run_passed=0
      for (( run_i=1; run_i<=repeat_count; run_i++ )); do
        local repeat_dir="$scenario_dir/run-$run_i"
        mkdir -p "$repeat_dir"

        echo "  ── Run $run_i/$repeat_count ──"
        local result_file="$repeat_dir/result.json"
        if run_scenario "$id" "$fixture" "$prd" "$validate" "$repeat_dir" "$eforge_bin" "$eforge_version" "" "$expect_json"; then
          local run_all_passed
          run_all_passed=$(node -e "
            const r = JSON.parse(require('fs').readFileSync('$result_file', 'utf8'));
            const eforgeOk = r.eforgeExitCode === 0;
            const validateOk = Object.values(r.validation || {}).every(v => v.passed);
            const expectOk = !r.expectations || r.expectations.passed;
            console.log(eforgeOk && validateOk && expectOk ? 'yes' : 'no');
          ")
          if [[ "$run_all_passed" == "yes" ]]; then
            run_passed=$((run_passed + 1))
          fi
        fi
        echo ""
      done

      # Write aggregate result.json at scenario level
      node -e "
        const fs = require('fs');
        const path = require('path');
        const scenarioDir = '$scenario_dir';
        const repeatCount = $repeat_count;
        const runPassed = $run_passed;

        // Collect all individual results
        const runs = [];
        for (let i = 1; i <= repeatCount; i++) {
          const rf = path.join(scenarioDir, 'run-' + i, 'result.json');
          if (fs.existsSync(rf)) runs.push(JSON.parse(fs.readFileSync(rf, 'utf8')));
        }

        // Aggregate metrics (average across runs)
        let totalInputTokens = 0, totalOutputTokens = 0, totalTokens = 0, totalCacheRead = 0, totalCacheCreation = 0;
        let totalCostUsd = 0, totalDuration = 0;
        for (const r of runs) {
          totalDuration += r.durationSeconds || 0;
          if (r.metrics) {
            if (r.metrics.tokens) {
              totalInputTokens += r.metrics.tokens.input || 0;
              totalOutputTokens += r.metrics.tokens.output || 0;
              totalTokens += r.metrics.tokens.total || 0;
              totalCacheRead += r.metrics.tokens.cacheRead || 0;
              totalCacheCreation += r.metrics.tokens.cacheCreation || 0;
            }
            totalCostUsd += r.metrics.costUsd || 0;
          }
        }

        const aggregate = {
          scenario: runs[0] ? runs[0].scenario : '$id',
          timestamp: runs[0] ? runs[0].timestamp : new Date().toISOString(),
          eforgeVersion: '$eforge_version',
          eforgeCommit: runs[0] ? runs[0].eforgeCommit || '' : '',
          eforgeExitCode: runs.every(r => r.eforgeExitCode === 0) ? 0 : 1,
          validation: runs[0] ? runs[0].validation : {},
          durationSeconds: totalDuration,
          passRate: runs.length > 0 ? runPassed / runs.length : 0,
          repeatCount: repeatCount,
          runs: runs.map((r, i) => ({ run: i + 1, passed: r.eforgeExitCode === 0 && Object.values(r.validation || {}).every(v => v.passed) && (!r.expectations || r.expectations.passed) })),
          metrics: {
            tokens: { input: totalInputTokens, output: totalOutputTokens, total: totalTokens, cacheRead: totalCacheRead, cacheCreation: totalCacheCreation },
            costUsd: totalCostUsd
          }
        };
        fs.writeFileSync(path.join(scenarioDir, 'result.json'), JSON.stringify(aggregate, null, 2));
      "

      echo "  Pass rate: $run_passed/$repeat_count"

      # Count as passed only if all runs passed
      if [[ $run_passed -eq $repeat_count ]]; then
        passed=$((passed + 1))
      fi
    else
      # Single run (repeat=1) — original behavior
      local result_file="$scenario_dir/result.json"
      if run_scenario "$id" "$fixture" "$prd" "$validate" "$scenario_dir" "$eforge_bin" "$eforge_version" "" "$expect_json"; then
        # Check if all validations passed
        local all_passed
        all_passed=$(node -e "
          const r = JSON.parse(require('fs').readFileSync('$result_file', 'utf8'));
          const eforgeOk = r.eforgeExitCode === 0;
          const validateOk = Object.values(r.validation || {}).every(v => v.passed);
          const expectOk = !r.expectations || r.expectations.passed;
          console.log(eforgeOk && validateOk && expectOk ? 'yes' : 'no');
        ")
        if [[ "$all_passed" == "yes" ]]; then
          passed=$((passed + 1))
        fi
      fi
    fi

    echo ""
  done < <(parse_scenarios)

  if [[ $total -eq 0 ]]; then
    if [[ ${#filters[@]} -gt 0 ]]; then
      echo "Error: No scenarios found matching: ${filters[*]}"
      exit 1
    else
      echo "Error: No scenarios defined in $SCENARIOS_FILE"
      exit 1
    fi
  fi

  # Write summary
  local summary_file="$run_dir/summary.json"
  node -e "
    const fs = require('fs');
    const path = require('path');
    const repeatCount = $repeat_count;
    const scenarios = [];
    const dirs = fs.readdirSync('$run_dir', { withFileTypes: true });
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const rf = path.join('$run_dir', d.name, 'result.json');
      if (fs.existsSync(rf)) scenarios.push(JSON.parse(fs.readFileSync(rf, 'utf8')));
    }
    // Aggregate totals across all scenarios
    let totalInputTokens = 0, totalOutputTokens = 0, totalTokens = 0, totalCacheRead = 0, totalCostUsd = 0, totalDurationSeconds = 0;
    let eforgeCommit = '';
    for (const r of scenarios) {
      totalDurationSeconds += r.durationSeconds || 0;
      if (r.eforgeCommit && !eforgeCommit) eforgeCommit = r.eforgeCommit;
      if (r.metrics) {
        if (r.metrics.tokens) {
          totalInputTokens += r.metrics.tokens.input || 0;
          totalOutputTokens += r.metrics.tokens.output || 0;
          totalTokens += r.metrics.tokens.total || 0;
          totalCacheRead += r.metrics.tokens.cacheRead || 0;
        }
        totalCostUsd += r.metrics.costUsd || 0;
      }
      // Add passRate to scenario entry in summary when repeat > 1
      if (repeatCount > 1 && r.passRate != null) {
        r.passRate = r.passRate;
      }
    }
    const summary = {
      timestamp: '$timestamp',
      eforgeVersion: '$eforge_version',
      eforgeCommit: eforgeCommit,
      totalScenarios: $total,
      passed: $passed,
      scenarios,
      totals: {
        tokens: { input: totalInputTokens, output: totalOutputTokens, total: totalTokens, cacheRead: totalCacheRead },
        costUsd: totalCostUsd,
        durationSeconds: totalDurationSeconds
      }
    };
    fs.writeFileSync('$summary_file', JSON.stringify(summary, null, 2));
  "

  print_summary "$summary_file" "$repeat_count"

  # Run analysis after summary
  echo ""
  echo "Running analysis..."
  if npx tsx "$SCRIPT_DIR/lib/analyze.ts" "$run_dir" 2>/dev/null; then
    print_observations "$run_dir/analysis.json"
  else
    echo "  Analysis skipped (no data or error)"
  fi

  # Print comparison if --compare was specified
  if [[ -n "$compare_timestamp" ]]; then
    local baseline_summary="$RESULTS_DIR/$compare_timestamp/summary.json"
    print_comparison "$summary_file" "$baseline_summary"
  fi
}

main "$@"
