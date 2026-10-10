import type { ThreadEvent, Usage } from '@openai/codex-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCodexPrompt } from './run-codex-prompt';
import { UsageAccounting, withUsageAccounting } from './usage-accounting';

const usage = (input: number, output: number): Usage => ({
  input_tokens: input,
  cached_input_tokens: input / 2,
  cache_write_input_tokens: input / 10,
  output_tokens: output,
  reasoning_output_tokens: output / 2,
});
const thread = (id: string, values: Usage[]) => ({
  id,
  run: vi
    .fn()
    .mockImplementation(async () => ({ finalResponse: 'ok', items: [], usage: values.shift() })),
});

describe('verified cumulative SDK accounting', () => {
  afterEach(() => vi.useRealTimers());
  it('records full totals for independent threads even when all counters grow', async () => {
    const accounting = new UsageAccounting();
    await withUsageAccounting(accounting, async () => {
      await runCodexPrompt(thread('a', [usage(100, 20)]), 'prompt', { operation: 'a' });
      await runCodexPrompt(thread('b', [usage(200, 40)]), 'prompt', { operation: 'b' });
    });
    expect(accounting.snapshot().totals.approxTotalTokens).toBe(360);
  });
  it('resumes from persisted baselines by thread id, not JS object identity', async () => {
    const first = new UsageAccounting();
    await withUsageAccounting(first, () =>
      runCodexPrompt(thread('resumed', [usage(100, 20)]), 'one', { operation: 'one' }),
    );
    const resumed = new UsageAccounting(JSON.parse(JSON.stringify(first.snapshot())));
    const result = await withUsageAccounting(resumed, () =>
      runCodexPrompt(thread('resumed', [usage(160, 40)]), 'two', { operation: 'two' }),
    );
    expect(result.usage).toEqual(usage(60, 20));
    expect(resumed.snapshot().totals).toMatchObject({
      inputTokens: 160,
      cachedInputTokens: 80,
      nonCachedInputTokens: 80,
      outputTokens: 40,
      reasoningOutputTokens: 20,
      approxTotalTokens: 200,
    });
  });
  it('does not guess per-turn semantics or lower baselines on decreasing reports', async () => {
    const accounting = new UsageAccounting();
    await accounting.record('a', usage(100, 20));
    expect(await accounting.record('a', usage(50, 10))).toEqual(usage(0, 0));
    expect(await accounting.record('a', usage(120, 30))).toEqual(usage(20, 10));
    expect(accounting.snapshot().totals.approxTotalTokens).toBe(150);
  });
  it('captures a new stream thread id and preserves completed response items', async () => {
    const accounting = new UsageAccounting();
    const item = { id: 'message', type: 'agent_message' as const, text: 'final answer' };
    const streaming = {
      id: null,
      run: vi.fn(),
      runStreamed: async () => ({
        events: (async function* (): AsyncGenerator<ThreadEvent> {
          yield { type: 'thread.started', thread_id: 'new-thread' };
          yield { type: 'item.completed', item };
          yield { type: 'turn.completed', usage: usage(100, 20) };
        })(),
      }),
    };
    const result = await withUsageAccounting(accounting, () =>
      runCodexPrompt(streaming, 'prompt', { operation: 'new stream' }),
    );
    expect(result).toEqual({ finalResponse: 'final answer', items: [item], usage: usage(100, 20) });
    expect(accounting.snapshot().lastUsageByThread['new-thread']).toEqual(usage(100, 20));
  });
  it('persists a reported turn before a later stream error', async () => {
    const persisted: unknown[] = [];
    const accounting = new UsageAccounting(undefined, async (state) => {
      persisted.push(structuredClone(state));
    });
    const streaming = {
      id: 'failed-stream',
      run: vi.fn(),
      runStreamed: async () => ({
        events: (async function* (): AsyncGenerator<ThreadEvent> {
          yield { type: 'turn.completed', usage: usage(100, 20) };
          expect(persisted).toHaveLength(1);
          throw new Error('transport interrupted after usage');
        })(),
      }),
    };
    await expect(
      withUsageAccounting(accounting, () =>
        runCodexPrompt(streaming, 'prompt', { operation: 'stream', retries: 0 }),
      ),
    ).rejects.toThrow('transport interrupted');
    expect(accounting.snapshot().totals.approxTotalTokens).toBe(120);
    expect(streaming.run).not.toHaveBeenCalled();
  });
  it('does not invent usage on the SDK failure event, and later cumulative usage recovers it', async () => {
    const accounting = new UsageAccounting();
    await accounting.record('failed', usage(100, 20));
    const streaming = {
      id: 'failed',
      run: vi.fn(),
      runStreamed: async () => ({
        events: (async function* (): AsyncGenerator<ThreadEvent> {
          yield { type: 'turn.failed', error: { message: 'failed' } };
        })(),
      }),
    };
    await expect(
      withUsageAccounting(accounting, () =>
        runCodexPrompt(streaming, 'prompt', { operation: 'failure' }),
      ),
    ).rejects.toThrow('failed');
    expect(accounting.snapshot().reportedTurns).toBe(1);
    await accounting.record('failed', usage(180, 40));
    expect(accounting.snapshot().totals.approxTotalTokens).toBe(220);
  });
  it('keeps usage emitted before timeout and charges only the retry delta', async () => {
    vi.useFakeTimers();
    const accounting = new UsageAccounting();
    let attempt = 0;
    const streaming = {
      id: 'timeout',
      run: vi.fn(),
      runStreamed: async (_: string, options?: { signal?: AbortSignal }) => ({
        events: (async function* (): AsyncGenerator<ThreadEvent> {
          attempt++;
          yield { type: 'turn.completed', usage: usage(attempt * 100, attempt * 20) };
          if (attempt === 1)
            await new Promise((_resolve, reject) =>
              options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
                once: true,
              }),
            );
        })(),
      }),
    };
    const pending = withUsageAccounting(accounting, () =>
      runCodexPrompt(streaming, 'prompt', { operation: 'timeout', timeoutMs: 20, retries: 1 }),
    );
    await vi.advanceTimersByTimeAsync(20);
    await expect(pending).resolves.toMatchObject({ usage: usage(100, 20) });
    expect(accounting.snapshot().totals.approxTotalTokens).toBe(240);
  });
  it('serializes persistence before accepting subsequent reports', async () => {
    const writes: number[] = [];
    const accounting = new UsageAccounting(undefined, async (state) => {
      await Promise.resolve();
      writes.push(state.totals.approxTotalTokens);
    });
    await Promise.all([
      accounting.record('a', usage(100, 20)),
      accounting.record('b', usage(200, 40)),
    ]);
    expect(writes).toEqual([120, 360]);
  });
  it('does not make another model turn after durable accounting fails', async () => {
    const accounting = new UsageAccounting(undefined, async () => {
      throw new Error('disk full');
    });
    const model = thread('disk-failure', [usage(100, 20), usage(200, 40)]);
    await withUsageAccounting(accounting, async () => {
      await expect(runCodexPrompt(model, 'one', { operation: 'one' })).rejects.toThrow('disk full');
      await expect(runCodexPrompt(model, 'two', { operation: 'two' })).rejects.toThrow('disk full');
    });
    expect(model.run).toHaveBeenCalledTimes(1);
  });
});
