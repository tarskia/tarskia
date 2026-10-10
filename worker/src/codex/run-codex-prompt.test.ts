import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveTurnTimeoutMs, runCodexPrompt } from './run-codex-prompt';

describe('runCodexPrompt', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts a stalled Codex turn after the configured timeout', async () => {
    vi.useFakeTimers();
    const timeoutAttempts: Array<{ attempt: number; maxAttempts: number }> = [];

    const thread = {
      id: 'thread-timeout',
      run: vi.fn((_prompt: string, turnOptions?: { signal?: AbortSignal }) => {
        return new Promise<{
          finalResponse: string;
          items: [];
          usage: null;
        }>((_resolve, reject) => {
          turnOptions?.signal?.addEventListener(
            'abort',
            () => {
              reject(turnOptions.signal?.reason ?? new Error('aborted'));
            },
            { once: true },
          );
        });
      }),
    };

    const pending = runCodexPrompt(thread, 'prompt', {
      operation: 'responsibility source repair',
      timeoutMs: 25,
      onTimeoutAttempt: ({ attempt, maxAttempts }) => {
        timeoutAttempts.push({ attempt, maxAttempts });
      },
    });
    const assertion = expect(pending).rejects.toThrow(
      'Codex turn timed out after 25ms during responsibility source repair (attempt 2/2); exhausted 1 retry',
    );

    await vi.advanceTimersByTimeAsync(75);

    await assertion;
    expect(thread.run).toHaveBeenCalledTimes(2);
    expect(timeoutAttempts).toEqual([
      { attempt: 1, maxAttempts: 2 },
      { attempt: 2, maxAttempts: 2 },
    ]);
    expect(thread.run).toHaveBeenCalledWith(
      'prompt',
      expect.objectContaining({ signal: expect.any(Object) }),
    );
  });

  it('returns successfully if a retried turn eventually completes', async () => {
    vi.useFakeTimers();

    let callCount = 0;
    const thread = {
      id: 'thread-retry-success',
      run: vi.fn((_prompt: string, turnOptions?: { signal?: AbortSignal }) => {
        callCount += 1;
        if (callCount === 2) {
          return Promise.resolve({
            finalResponse: 'ok',
            items: [],
            usage: null,
          });
        }
        return new Promise<{
          finalResponse: string;
          items: [];
          usage: null;
        }>((_resolve, reject) => {
          turnOptions?.signal?.addEventListener(
            'abort',
            () => {
              reject(turnOptions.signal?.reason ?? new Error('aborted'));
            },
            { once: true },
          );
        });
      }),
    };

    const pending = runCodexPrompt(thread, 'prompt', {
      operation: 'root source repair',
      timeoutMs: 25,
    });

    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).resolves.toEqual({
      finalResponse: 'ok',
      items: [],
      usage: null,
    });
    expect(thread.run).toHaveBeenCalledTimes(2);
  });

  it('converts verified cumulative thread usage into per-turn deltas', async () => {
    const thread = {
      id: 'thread-cumulative-usage',
      run: vi
        .fn()
        .mockResolvedValueOnce({
          finalResponse: 'first',
          items: [],
          usage: {
            input_tokens: 120,
            cached_input_tokens: 30,
            cache_write_input_tokens: 20,
            reasoning_output_tokens: 10,
            output_tokens: 40,
          },
        })
        .mockResolvedValueOnce({
          finalResponse: 'second',
          items: [],
          usage: {
            input_tokens: 180,
            cached_input_tokens: 45,
            cache_write_input_tokens: 30,
            reasoning_output_tokens: 18,
            output_tokens: 65,
          },
        }),
    };

    await expect(
      runCodexPrompt(thread, 'first prompt', {
        operation: 'first',
      }),
    ).resolves.toEqual({
      finalResponse: 'first',
      items: [],
      usage: {
        input_tokens: 120,
        cached_input_tokens: 30,
        cache_write_input_tokens: 20,
        reasoning_output_tokens: 10,
        output_tokens: 40,
      },
    });

    await expect(
      runCodexPrompt(thread, 'second prompt', {
        operation: 'second',
      }),
    ).resolves.toEqual({
      finalResponse: 'second',
      items: [],
      usage: {
        input_tokens: 60,
        cached_input_tokens: 15,
        cache_write_input_tokens: 10,
        reasoning_output_tokens: 8,
        output_tokens: 25,
      },
    });
  });
});

it('propagates root cancellation to the SDK without retrying', async () => {
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const run = vi.fn(
    (_prompt: string, options?: { signal?: AbortSignal }) =>
      new Promise<never>((_resolve, reject) => {
        started();
        options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
          once: true,
        });
      }),
  );
  const timeout = vi.fn();
  const pending = runCodexPrompt({ id: 'cancelled', run }, 'prompt', {
    operation: 'test',
    signal: controller.signal,
    retries: 4,
    onTimeoutAttempt: timeout,
  });
  const assertion = expect(pending).rejects.toThrow('root cancelled');
  await ready;
  controller.abort(new Error('root cancelled'));
  await assertion;
  expect(run).toHaveBeenCalledTimes(1);
  expect(timeout).not.toHaveBeenCalled();
});

it('scales turn timeouts by effort and accepts explicit overrides including disabled', () => {
  for (const effort of ['minimal', 'low', 'medium'] as const)
    expect(resolveTurnTimeoutMs(effort)).toBe(300000);
  for (const effort of ['high', 'xhigh'] as const)
    expect(resolveTurnTimeoutMs(effort)).toBe(900000);
  for (const effort of ['max', 'ultra', 'persistent'] as const)
    expect(resolveTurnTimeoutMs(effort)).toBe(1800000);
  expect(resolveTurnTimeoutMs('max', 2)).toBe(120000);
  expect(resolveTurnTimeoutMs('max', 0)).toBe(0);
});

it('disables its timer for zero and caps even legacy retry requests at one', async () => {
  vi.useFakeTimers();
  try {
    const timer = vi.spyOn(globalThis, 'setTimeout');
    await runCodexPrompt(
      {
        id: 'zero',
        run: vi.fn().mockResolvedValue({ finalResponse: 'ok', items: [], usage: null }),
      },
      'ok',
      { operation: 'zero', timeoutMs: 0 },
    );
    expect(timer).not.toHaveBeenCalled();
    timer.mockRestore();
    const run = vi.fn(
      (_prompt: string, options?: { signal?: AbortSignal }) =>
        new Promise<never>((_, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
            once: true,
          });
        }),
    );
    const pending = runCodexPrompt({ id: 'legacy', run }, 'hang', {
      operation: 'legacy',
      timeoutMs: 10,
      retries: 99,
    });
    const assertion = expect(pending).rejects.toThrow('exhausted 1 retry');
    await vi.advanceTimersByTimeAsync(20);
    await assertion;
    expect(run).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
