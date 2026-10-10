import { describe, expect, it } from 'vitest';
import { addTokenUsageTotals, emptyTokenUsageTotals, tokenUsageFromSdkUsage } from './token-usage';

describe('token usage totals', () => {
  it('counts input and output once, exposing their cached/reasoning subsets', () => {
    expect(
      tokenUsageFromSdkUsage({
        input_tokens: 100,
        cached_input_tokens: 40,
        cache_write_input_tokens: 10,
        output_tokens: 30,
        reasoning_output_tokens: 20,
      }),
    ).toEqual({
      inputTokens: 100,
      cachedInputTokens: 40,
      nonCachedInputTokens: 60,
      outputTokens: 30,
      reasoningOutputTokens: 20,
      approxTotalTokens: 130,
    });
  });
  it('aggregates new and legacy totals without trusting an old double-counted total', () => {
    expect(
      addTokenUsageTotals(
        { inputTokens: 100, cachedInputTokens: 40, outputTokens: 30, approxTotalTokens: 170 },
        { inputTokens: 50, cachedInputTokens: 10, outputTokens: 10, reasoningOutputTokens: 8 },
      ),
    ).toEqual({
      inputTokens: 150,
      cachedInputTokens: 50,
      nonCachedInputTokens: 100,
      outputTokens: 40,
      reasoningOutputTokens: 8,
      approxTotalTokens: 190,
    });
    expect(tokenUsageFromSdkUsage(null)).toEqual(emptyTokenUsageTotals());
  });
});
