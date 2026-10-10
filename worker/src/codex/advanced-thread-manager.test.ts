import { describe, expect, it, vi } from 'vitest';
import { AdvancedThreadManager } from './advanced-thread-manager';

function quietLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function okTurn(finalResponse = 'ok') {
  return {
    finalResponse,
    items: [],
    usage: null,
  };
}

describe('AdvancedThreadManager', () => {
  it('starts one fresh thread and adds a handoff prefix once per scope', async () => {
    const thread = {
      id: 'thread-shared',
      run: vi.fn().mockResolvedValue(okTurn()),
    };
    const client = {
      startThread: vi.fn(() => thread),
      resumeThread: vi.fn(),
    };
    const manager = new AdvancedThreadManager({
      client,
      workspaceRoot: '/tmp/job',
      logger: quietLogger(),
      canResumePersistedThread: false,
    });

    await manager.runPrompt({
      prompt: 'plan',
      operation: 'area planning',
      scope: 'pre-refinement',
      handoffArtifactPath: '/tmp/job/out/analysis/pre-refinement.handoff.md',
    });
    await manager.runPrompt({
      prompt: 'repair',
      operation: 'area planning repair',
      scope: 'pre-refinement',
      handoffArtifactPath: '/tmp/job/out/analysis/pre-refinement.handoff.md',
    });
    await manager.runPrompt({
      prompt: 'node',
      operation: 'node refinement',
      scope: 'node-refinement',
      handoffArtifactPath: '/tmp/job/out/analysis/node-refinement.handoff.md',
    });
    await manager.runPrompt({
      prompt: 'graph',
      operation: 'graph collation',
      scope: 'graph-collation',
      handoffArtifactPath: '/tmp/job/out/analysis/graph-collation.handoff.md',
    });

    expect(client.startThread).toHaveBeenCalledTimes(1);
    expect(client.resumeThread).not.toHaveBeenCalled();
    expect(thread.run).toHaveBeenCalledTimes(4);
    expect(thread.run.mock.calls[0]?.[0]).toContain(
      'Handoff artifact: out/analysis/pre-refinement.handoff.md',
    );
    expect(thread.run.mock.calls[1]?.[0]).not.toContain('Handoff artifact:');
    expect(thread.run.mock.calls[2]?.[0]).toContain(
      'Handoff artifact: out/analysis/node-refinement.handoff.md',
    );
    expect(thread.run.mock.calls[3]?.[0]).toContain(
      'Handoff artifact: out/analysis/graph-collation.handoff.md',
    );
    expect(manager.isScopePrimed('pre-refinement')).toBe(true);
    expect(manager.isScopePrimed('node-refinement')).toBe(true);
    expect(manager.isScopePrimed('graph-collation')).toBe(true);
    expect(manager.getThreadId()).toBe('thread-shared');
  });

  it('resumes a persisted thread when allowed', async () => {
    const thread = {
      id: 'thread-resumed',
      run: vi.fn().mockResolvedValue(okTurn()),
    };
    const client = {
      startThread: vi.fn(),
      resumeThread: vi.fn(() => thread),
    };
    const manager = new AdvancedThreadManager({
      client,
      workspaceRoot: '/tmp/job',
      logger: quietLogger(),
      persistedThreadId: 'thread-resumed',
      modelReasoningEffort: 'max',
      canResumePersistedThread: true,
    });

    const result = await manager.runPrompt({
      prompt: 'plan',
      operation: 'area planning',
      scope: 'pre-refinement',
      handoffArtifactPath: '/tmp/job/out/analysis/pre-refinement.handoff.md',
    });

    expect(client.resumeThread).toHaveBeenCalledWith(
      'thread-resumed',
      expect.objectContaining({ modelReasoningEffort: 'max' }),
    );
    expect(client.startThread).not.toHaveBeenCalled();
    expect(result.threadId).toBe('thread-resumed');
  });

  it('retries once with a fresh thread when a resumed thread loses its rollout mid-turn', async () => {
    const brokenThread = {
      id: 'thread-stale',
      run: vi
        .fn()
        .mockRejectedValue(
          new Error('thread/resume failed: no rollout found for thread id thread-stale'),
        ),
    };
    const freshThread = {
      id: 'thread-fresh',
      run: vi.fn().mockResolvedValue(okTurn()),
    };
    const client = {
      startThread: vi.fn(() => freshThread),
      resumeThread: vi.fn(() => brokenThread),
    };
    const manager = new AdvancedThreadManager({
      client,
      workspaceRoot: '/tmp/job',
      logger: quietLogger(),
      persistedThreadId: 'thread-stale',
      canResumePersistedThread: true,
    });

    const result = await manager.runPrompt({
      prompt: 'graph',
      operation: 'graph collation',
      scope: 'graph-collation',
      handoffArtifactPath: '/tmp/job/out/analysis/graph-collation.handoff.md',
    });

    expect(client.resumeThread).toHaveBeenCalledTimes(1);
    expect(client.startThread).toHaveBeenCalledTimes(1);
    expect(result.threadId).toBe('thread-fresh');
    expect(brokenThread.run).toHaveBeenCalledTimes(1);
    expect(freshThread.run).toHaveBeenCalledTimes(1);
  });
});

it('retries a timed-out advanced turn exactly once on a fresh handoff-primed thread', async () => {
  vi.useFakeTimers();
  try {
    const hang = vi.fn(
      (_prompt: string, options?: { signal?: AbortSignal }) =>
        new Promise<never>((_, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
            once: true,
          });
        }),
    );
    const first = { id: 'old', run: hang };
    const second = { id: 'fresh', run: hang };
    const client = { startThread: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second) };
    const manager = new AdvancedThreadManager({
      client,
      workspaceRoot: '/tmp/job',
      logger: quietLogger(),
      canResumePersistedThread: false,
      turnTimeoutMs: 25,
    });
    const pending = manager.runPrompt({
      prompt: 'refine',
      operation: 'node',
      scope: 'node-refinement',
      handoffArtifactPath: '/tmp/job/out/handoff.md',
    });
    const assertion = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(client.startThread).toHaveBeenCalledTimes(2);
    expect(hang).toHaveBeenCalledTimes(2);
    expect(hang.mock.calls[1]?.[0]).toContain('Handoff artifact: out/handoff.md');
    expect(manager.getThreadId()).toBe('fresh');
  } finally {
    vi.useRealTimers();
  }
});
