// Shared type definitions for the eval harness.
// Consolidated from build-result.ts and analyze.ts to avoid duplication.

// --- Result types (from build-result.ts) ---

export interface PhaseTimestamps {
  start?: string;
  end?: string;
}

export interface AgentAggregate {
  count: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheRead: number;
  cacheCreation: number;
  costUsd: number;
  durationMs: number;
  turns: number;
}

export interface ModelAggregate {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
}

export interface ReviewIssueDetail {
  severity: string;
  category: string;
  file: string;
  description: string;
}

export interface EvaluationVerdict {
  file: string;
  action: string;
  reason: string;
}

export interface ReviewMetrics {
  issueCount: number;
  bySeverity: Record<string, number>;
  accepted: number;
  rejected: number;
}

export interface ScenarioMetrics {
  profile?: string;
  tokens: { input: number; output: number; total: number; cacheRead: number; cacheCreation: number };
  costUsd: number;
  phases: Record<string, { durationMs: number }>;
  agents: Record<string, AgentAggregate>;
  review: ReviewMetrics;
  reviewIssues: Array<ReviewIssueDetail>;
  evaluationVerdicts: Array<EvaluationVerdict>;
  toolUsage: Record<string, Record<string, number>>;
  models: Record<string, ModelAggregate>;
}

export interface ExpectationCheck {
  check: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
}

export interface ScenarioResult {
  scenario: string;
  timestamp: string;
  eforgeVersion: string;
  eforgeCommit: string;
  eforgeExitCode: number;
  validation: Record<string, { passed: boolean }>;
  durationSeconds: number;
  metrics?: ScenarioMetrics;
  expectations?: {
    passed: boolean;
    checks: ExpectationCheck[];
  };
}

// --- Analysis output types (from analyze.ts) ---

export type Severity = 'info' | 'warning' | 'attention';

export interface Observation {
  detector: string;
  signal: string;
  severity: Severity;
  value: number | string;
  context: Record<string, unknown>;
  message: string;
}

export interface Trend {
  metric: string;
  current: number;
  previous: number;
  delta: number;
  message: string;
}

export interface AnalysisReport {
  runTimestamp: string;
  scenarioCount: number;
  observations: Observation[];
  trends: Trend[];
}

// --- Scenario YAML types ---

export interface ScenarioMeta {
  id: string;
  fixture: string;
  prd: string;
  validate?: string[];
  description?: string;
  expect?: {
    mode?: string;
    buildStagesContain?: string[];
    buildStagesExclude?: string[];
    skip?: boolean;
  };
  envFile?: string;
  variantLabel?: string;
  compareGroup?: string;
  configOverlay?: {
    backend?: string;
    agents?: {
      models?: {
        max?: {
          provider?: string;
          id?: string;
        };
      };
    };
    [key: string]: unknown;
  };
}
