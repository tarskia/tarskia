import type { Usage } from '@openai/codex-sdk';

export interface TokenUsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  nonCachedInputTokens: number;
  reasoningOutputTokens: number;
  outputTokens: number;
  approxTotalTokens: number;
}

export function emptyTokenUsageTotals(): TokenUsageTotals {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    nonCachedInputTokens: 0,
    reasoningOutputTokens: 0,
    outputTokens: 0,
    approxTotalTokens: 0,
  };
}

export function tokenUsageFromSdkUsage(usage?: Usage | null): TokenUsageTotals {
  const inputTokens = usage?.input_tokens ?? 0;
  const cachedInputTokens = usage?.cached_input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;

  return {
    inputTokens,
    cachedInputTokens,
    nonCachedInputTokens: Math.max(0, inputTokens - cachedInputTokens),
    outputTokens,
    reasoningOutputTokens: usage?.reasoning_output_tokens ?? 0,
    // Cached input and reasoning output are subsets, not additional tokens.
    approxTotalTokens: inputTokens + outputTokens,
  };
}

export function addTokenUsageTotals(
  ...totals: Array<Partial<TokenUsageTotals> | null | undefined>
): TokenUsageTotals {
  const accumulated = emptyTokenUsageTotals();

  for (const total of totals) {
    if (!total) continue;
    accumulated.inputTokens += total.inputTokens ?? 0;
    accumulated.cachedInputTokens += total.cachedInputTokens ?? 0;
    accumulated.outputTokens += total.outputTokens ?? 0;
    accumulated.reasoningOutputTokens += total.reasoningOutputTokens ?? 0;
  }

  accumulated.nonCachedInputTokens = Math.max(
    0,
    accumulated.inputTokens - accumulated.cachedInputTokens,
  );
  accumulated.approxTotalTokens = accumulated.inputTokens + accumulated.outputTokens;

  return accumulated;
}
