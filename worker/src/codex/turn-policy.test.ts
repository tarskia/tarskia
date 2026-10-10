import { afterEach, expect, it, vi } from 'vitest';
import { runCodexPrompt } from './run-codex-prompt';
import {
  currentTurnPolicy,
  TurnBudgetExhaustedError,
  TurnPolicy,
  withTurnPolicy,
} from './turn-policy';

const completed = { finalResponse: 'ok', items: [], usage: null };
const fakeThread = (id: string) => ({ id, run: vi.fn().mockResolvedValue(completed) });
afterEach(() => vi.useRealTimers());

it('shares one allowance across schema, diagram, and repair SDK calls', async () => {
  const policy = new TurnPolicy(2);
  const schema = fakeThread('schema');
  const diagram = fakeThread('diagram');
  await withTurnPolicy(policy, async () => {
    await runCodexPrompt(schema, 'generate schema', { operation: 'schema' });
    await runCodexPrompt(diagram, 'draft diagram', { operation: 'diagram' });
    await expect(runCodexPrompt(diagram, 'repair', { operation: 'repair' })).rejects.toMatchObject({
      turns: 2,
      message: 'Stopped after 2 turns (--max-turns). Run the same command again to continue.',
    });
  });
  expect(schema.run).toHaveBeenCalledTimes(1);
  expect(diagram.run).toHaveBeenCalledTimes(1);
  expect(policy.turns).toBe(2);
  expect(currentTurnPolicy()).toBeUndefined();
});

it.each([1, 2])('counts timeout retries against the same %i-turn allowance', async (limit) => {
  vi.useFakeTimers();
  const policy = new TurnPolicy(limit);
  const stalled = {
    id: 'stalled',
    run: vi.fn(
      (_prompt: string, options?: { signal?: AbortSignal }) =>
        new Promise<typeof completed>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
            once: true,
          });
        }),
    ),
  };
  const retry = fakeThread('retry');
  const pending = withTurnPolicy(policy, () =>
    runCodexPrompt(stalled, 'prompt', {
      operation: 'schema repair',
      timeoutMs: 10,
      freshThread: () => retry,
    }),
  );
  const assertion =
    limit === 1
      ? expect(pending).rejects.toBeInstanceOf(TurnBudgetExhaustedError)
      : expect(pending).resolves.toEqual(completed);
  await vi.advanceTimersByTimeAsync(10);
  await assertion;
  expect(stalled.run).toHaveBeenCalledTimes(1);
  expect(retry.run).toHaveBeenCalledTimes(limit - 1);
  expect(policy.turns).toBe(limit);
  await withTurnPolicy(policy, async () => {
    await expect(runCodexPrompt(retry, 'next', { operation: 'next' })).rejects.toBeInstanceOf(
      TurnBudgetExhaustedError,
    );
  });
  expect(retry.run).toHaveBeenCalledTimes(limit - 1);
});

it('gives each new invocation a fresh allowance', async () => {
  const thread = fakeThread('same-persisted-thread');
  for (let invocation = 0; invocation < 2; invocation += 1) {
    const policy = new TurnPolicy(1);
    await withTurnPolicy(policy, async () => {
      await runCodexPrompt(thread, 'continue', { operation: 'resume' });
      await expect(runCodexPrompt(thread, 'next', { operation: 'next' })).rejects.toBeInstanceOf(
        TurnBudgetExhaustedError,
      );
    });
    expect(policy.turns).toBe(1);
  }
  expect(thread.run).toHaveBeenCalledTimes(2);
});

it('isolates concurrent invocation contexts across asynchronous suspension', async () => {
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  const first = new TurnPolicy(1);
  const second = new TurnPolicy(2);
  const thread = fakeThread('shared-fake');
  const run = (policy: TurnPolicy, gate: Promise<void>) =>
    withTurnPolicy(policy, async () => {
      expect(currentTurnPolicy()).toBe(policy);
      await gate;
      expect(currentTurnPolicy()).toBe(policy);
      for (let i = 0; i < policy.maxTurns!; i += 1)
        await runCodexPrompt(thread, 'prompt', { operation: 'stage' });
      await expect(runCodexPrompt(thread, 'extra', { operation: 'stage' })).rejects.toBeInstanceOf(
        TurnBudgetExhaustedError,
      );
    });
  const firstRun = run(first, firstGate);
  const secondRun = run(second, secondGate);
  expect(currentTurnPolicy()).toBeUndefined();
  releaseSecond();
  await secondRun;
  expect(first.turns).toBe(0);
  releaseFirst();
  await firstRun;
  expect([first.turns, second.turns]).toEqual([1, 2]);
  expect(thread.run).toHaveBeenCalledTimes(3);
});

it('has no implicit 150-turn ceiling', async () => {
  const policy = new TurnPolicy();
  const thread = fakeThread('unlimited');
  await withTurnPolicy(policy, async () => {
    for (let turn = 0; turn < 161; turn += 1)
      await runCodexPrompt(thread, 'refine', { operation: 'refinement' });
  });
  expect(thread.run).toHaveBeenCalledTimes(161);
  expect(policy.turns).toBe(161);
});

it('charges streamed turns once and blocks the SDK before a second stream', async () => {
  const policy = new TurnPolicy(1);
  const thread = {
    ...fakeThread('streamed'),
    runStreamed: vi.fn().mockImplementation(async () => ({
      events: (async function* () {
        yield { type: 'item.completed', item: { id: 'reply', type: 'agent_message', text: 'ok' } };
      })(),
    })),
  };
  await withTurnPolicy(policy, async () => {
    await runCodexPrompt(thread, 'stream', { operation: 'draft' });
    await expect(runCodexPrompt(thread, 'stream', { operation: 'repair' })).rejects.toBeInstanceOf(
      TurnBudgetExhaustedError,
    );
  });
  expect(thread.runStreamed).toHaveBeenCalledTimes(1);
  expect(thread.run).not.toHaveBeenCalled();
  expect(policy.turns).toBe(1);
});
