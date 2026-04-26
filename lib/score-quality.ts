/**
 * LLM-as-judge quality scoring module.
 * Provides absolute scoring (4-dimension rubric) and pairwise comparison
 * for eval scenario diffs, using @anthropic-ai/claude-agent-sdk.
 *
 * Auth: calls go through the SDK which uses Claude Code's host auth
 * (subscription if logged in) and falls back to ANTHROPIC_API_KEY.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { readFileSync, writeFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { AbsoluteScore, PairwiseScore } from './types.js';

// Re-export types for use by callers
export type { AbsoluteScore, PairwiseScore };

// --- Internal usage tracking ---

export interface JudgeUsage {
  inputTokens: number;
  outputTokens: number;
}

// Extended PairwiseScore type with usage metadata for callers that need it
export type PairwiseScoreWithUsage = PairwiseScore & { _usage: JudgeUsage };

// --- Config ---

export interface JudgeConfig {
  model: string;
  maxOutputTokens: number;
  weights: {
    prdAdherence: number;
    codeQuality: number;
    testQuality: number;
    changeDiscipline: number;
  };
  maxDiffBytes: number;
}

const SCRIPT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function loadJudgeConfig(configPath?: string): JudgeConfig {
  const path = configPath ?? join(SCRIPT_DIR, 'judge.yaml');
  const raw = readFileSync(path, 'utf8');
  const parsed = parseYaml(raw) as JudgeConfig;

  // Validate required fields
  if (!parsed.model || typeof parsed.model !== 'string') {
    throw new Error('judge.yaml: missing or invalid `model` field');
  }
  if (typeof parsed.maxOutputTokens !== 'number') {
    throw new Error('judge.yaml: missing or invalid `maxOutputTokens` field');
  }
  if (typeof parsed.maxDiffBytes !== 'number') {
    throw new Error('judge.yaml: missing or invalid `maxDiffBytes` field');
  }
  if (!parsed.weights || typeof parsed.weights !== 'object') {
    throw new Error('judge.yaml: missing `weights` section');
  }

  const { prdAdherence, codeQuality, testQuality, changeDiscipline } = parsed.weights;
  const sum = prdAdherence + codeQuality + testQuality + changeDiscipline;
  if (Math.abs(sum - 1.0) > 0.001) {
    throw new Error(`judge.yaml: weights must sum to 1.0, got ${sum.toFixed(4)}`);
  }

  return parsed;
}

// --- Diff truncation ---

export function truncateDiff(diff: string, maxBytes: number): { text: string; truncated: boolean; originalBytes: number } {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(diff);
  const originalBytes = bytes.length;

  if (originalBytes <= maxBytes) {
    return { text: diff, truncated: false, originalBytes };
  }

  // Truncate at byte boundary
  const truncatedBytes = bytes.slice(0, maxBytes);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const truncatedText = decoder.decode(truncatedBytes);
  const text = truncatedText + `\n\n... [TRUNCATED — diff exceeded ${maxBytes} bytes] ...\n`;

  return { text, truncated: true, originalBytes };
}

// --- Prompt loading and substitution ---

function loadPromptTemplate(name: string): string {
  const promptPath = join(SCRIPT_DIR, 'prompts', name);
  return readFileSync(promptPath, 'utf8');
}

function substitutePrompt(template: string, vars: Record<string, string>): string {
  // Single-pass replace prevents recursive substitution (e.g., a PRD that
  // contains `{{DIFF}}` literally would otherwise pick up the diff content
  // when DIFF is substituted later).
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match;
  });
}

function formatValidationSummary(validation: Record<string, { passed: boolean }>): string {
  const entries = Object.entries(validation);
  if (entries.length === 0) return 'No validation commands were run.';
  const lines = entries.map(([name, v]) => `- ${name}: ${v.passed ? 'PASSED' : 'FAILED'}`);
  return lines.join('\n');
}

// --- Zod schemas for response validation ---

const ScoreValueSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

const DimensionScoreSchema = z.object({
  score: ScoreValueSchema,
  justification: z.string().min(1),
});

const AbsoluteScoreResponseSchema = z.object({
  prdAdherence: DimensionScoreSchema,
  codeQuality: DimensionScoreSchema,
  testQuality: DimensionScoreSchema,
  changeDiscipline: DimensionScoreSchema,
});

const WinnerSchema = z.union([
  z.literal('a'),
  z.literal('b'),
  z.literal('tie'),
]);

const DimensionResultSchema = z.object({
  winner: WinnerSchema,
  justification: z.string().min(1),
});

const PairwiseScoreResponseSchema = z.object({
  prdAdherence: DimensionResultSchema,
  codeQuality: DimensionResultSchema,
  testQuality: DimensionResultSchema,
  changeDiscipline: DimensionResultSchema,
});

// --- Auth error detection ---

function isAuthError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('authentication') ||
    lower.includes('unauthorized') ||
    lower.includes('api key') ||
    lower.includes('apikey') ||
    lower.includes('api_key') ||
    lower.includes('anthropic_api_key') ||
    lower.includes('credential') ||
    lower.includes('login') ||
    lower.includes('auth failed') ||
    lower.includes('not logged in')
  );
}

// --- Core SDK call ---

interface JudgeCallResult {
  text: string;
  usage: JudgeUsage;
}

async function callJudge(prompt: string, judgeConfig: JudgeConfig): Promise<JudgeCallResult> {
  let resultText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const messages = query({
      prompt,
      options: {
        model: judgeConfig.model,
        maxTurns: 1,
        tools: [],
        allowedTools: [],
        permissionMode: 'bypassPermissions',
        // Required by the SDK whenever permissionMode is 'bypassPermissions'.
        // Safe here because we also set tools: [] / allowedTools: [], so the
        // judge has no tool/file access regardless.
        allowDangerouslySkipPermissions: true,
      },
    });

    for await (const msg of messages) {
      // Narrow via type field
      const anyMsg = msg as Record<string, unknown>;
      if (anyMsg['type'] === 'result') {
        const subtype = anyMsg['subtype'] as string | undefined;
        if (subtype === 'success') {
          resultText = (anyMsg['result'] as string | undefined) ?? '';
          const usage = anyMsg['usage'] as Record<string, number> | undefined;
          if (usage) {
            inputTokens = (usage['input_tokens'] as number | undefined) ?? 0;
            outputTokens = (usage['output_tokens'] as number | undefined) ?? 0;
          }
        } else {
          const errors = (anyMsg['errors'] as string[] | undefined) ?? [];
          throw new Error(`Judge SDK call failed (${subtype ?? 'unknown'}): ${errors.join('; ')}`);
        }
      }
    }
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    if (isAuthError(rawMsg)) {
      throw new Error(
        `Quality scoring failed: authentication error. ` +
        `Ensure you are logged into Claude Code or set ANTHROPIC_API_KEY. ` +
        `(${rawMsg})`,
      );
    }
    throw err;
  }

  if (!resultText) {
    throw new Error('Judge SDK call returned no text result');
  }

  return { text: resultText, usage: { inputTokens, outputTokens } };
}

// --- JSON extraction from LLM response ---

function extractJson(text: string): string {
  // Try to extract JSON from the response (model may wrap in markdown fences despite instructions)
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  // Try to find a bare JSON object
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    return objMatch[0];
  }
  return text.trim();
}

// --- Public API ---

export async function scoreAbsolute(opts: {
  prd: string;
  diffPatch: string;
  validation: Record<string, { passed: boolean }>;
  judgeConfig: JudgeConfig;
}): Promise<AbsoluteScore> {
  const { prd, diffPatch, validation, judgeConfig } = opts;

  const { text: diffText, truncated, originalBytes } = truncateDiff(diffPatch, judgeConfig.maxDiffBytes);

  const template = loadPromptTemplate('judge-absolute.md');
  const prompt = substitutePrompt(template, {
    PRD: prd,
    VALIDATION_SUMMARY: formatValidationSummary(validation),
    DIFF: diffText,
  });

  const { text: responseText, usage } = await callJudge(prompt, judgeConfig);

  // Log token usage (fulfills "quality scoring: 1 call, N input + M output tokens")
  const inputStr = usage.inputTokens.toLocaleString();
  const outputStr = usage.outputTokens.toLocaleString();
  console.log(`  quality scoring: 1 call, ${inputStr} input + ${outputStr} output tokens`);

  // Parse and validate response
  const jsonStr = extractJson(responseText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`Judge returned invalid JSON: ${(err as Error).message}\nResponse: ${responseText.slice(0, 500)}`);
  }

  const validated = AbsoluteScoreResponseSchema.parse(parsed);

  // Compute weighted overall score
  const { prdAdherence: wa, codeQuality: wc, testQuality: wt, changeDiscipline: wd } = judgeConfig.weights;
  const weighted =
    validated.prdAdherence.score * wa +
    validated.codeQuality.score * wc +
    validated.testQuality.score * wt +
    validated.changeDiscipline.score * wd;

  const absolute: AbsoluteScore = {
    judge: {
      model: judgeConfig.model,
      version: '1',
    },
    dimensions: {
      prdAdherence: validated.prdAdherence,
      codeQuality: validated.codeQuality,
      testQuality: validated.testQuality,
      changeDiscipline: validated.changeDiscipline,
    },
    overall: {
      weighted: Math.round(weighted * 100) / 100,
      weights: {
        prdAdherence: wa,
        codeQuality: wc,
        testQuality: wt,
        changeDiscipline: wd,
      },
    },
    inputs: {
      diffBytes: originalBytes,
      diffTruncated: truncated,
    },
  };

  return absolute;
}

export async function scorePairwise(opts: {
  prd: string;
  diffA: string;
  diffB: string;
  profileA: string;
  profileB: string;
  judgeConfig: JudgeConfig;
}): Promise<PairwiseScoreWithUsage> {
  const { prd, diffA, diffB, profileA, profileB, judgeConfig } = opts;

  // Randomize A/B assignment to reduce order-effect bias
  const flip = Math.random() < 0.5;
  const [promptProfileA, promptDiffA, promptProfileB, promptDiffB] = flip
    ? [profileB, diffB, profileA, diffA]
    : [profileA, diffA, profileB, diffB];

  // Truncate each diff if needed (maxDiffBytes applies per-diff)
  const halfMax = Math.floor(judgeConfig.maxDiffBytes / 2);
  const { text: truncDiffA } = truncateDiff(promptDiffA, halfMax);
  const { text: truncDiffB } = truncateDiff(promptDiffB, halfMax);

  const template = loadPromptTemplate('judge-pairwise.md');
  const prompt = substitutePrompt(template, {
    PRD: prd,
    PROFILE_A: promptProfileA,
    DIFF_A: truncDiffA,
    PROFILE_B: promptProfileB,
    DIFF_B: truncDiffB,
  });

  const { text: responseText, usage } = await callJudge(prompt, judgeConfig);

  // Parse and validate response
  const jsonStr = extractJson(responseText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`Judge returned invalid JSON: ${(err as Error).message}\nResponse: ${responseText.slice(0, 500)}`);
  }

  const validated = PairwiseScoreResponseSchema.parse(parsed);

  // Denormalize winners back to original profileA/profileB identifiers.
  // If we flipped, then LLM's 'a' refers to promptProfileA=profileB and 'b' refers to promptProfileB=profileA.
  function denormalize(rawWinner: 'a' | 'b' | 'tie'): 'a' | 'b' | 'tie' {
    if (!flip || rawWinner === 'tie') return rawWinner;
    // Swap: 'a' in the flipped prompt = profileB = 'b' in original; 'b' = profileA = 'a'
    return rawWinner === 'a' ? 'b' : 'a';
  }

  const result: PairwiseScoreWithUsage = {
    perDimension: {
      prdAdherence: {
        winner: denormalize(validated.prdAdherence.winner),
        justification: validated.prdAdherence.justification,
      },
      codeQuality: {
        winner: denormalize(validated.codeQuality.winner),
        justification: validated.codeQuality.justification,
      },
      testQuality: {
        winner: denormalize(validated.testQuality.winner),
        justification: validated.testQuality.justification,
      },
      changeDiscipline: {
        winner: denormalize(validated.changeDiscipline.winner),
        justification: validated.changeDiscipline.justification,
      },
    },
    _usage: usage,
  };

  return result;
}

export function mergeQualityIntoResult(resultJsonPath: string, patch: { absolute?: AbsoluteScore }): void {
  const data = JSON.parse(readFileSync(resultJsonPath, 'utf8')) as Record<string, unknown>;
  const quality = (data['quality'] as Record<string, unknown> | undefined) ?? {};
  if (patch.absolute !== undefined) {
    quality['absolute'] = patch.absolute;
  }
  data['quality'] = quality;
  writeFileSync(resultJsonPath, JSON.stringify(data, null, 2) + '\n');
}
