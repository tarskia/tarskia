import { describe, expect, it, vi } from 'vitest';
import type { CodexThreadLike } from './diagram-agent';
import { createReadOnlyThread } from './read-only-thread';

describe('createReadOnlyThread', () => {
  const thread = { id: 'thread' } as CodexThreadLike;
  const expected = {
    workingDirectory: '/workspace',
    skipGitRepoCheck: true,
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
    networkAccessEnabled: false,
    webSearchMode: 'disabled',
    model: undefined,
    modelReasoningEffort: 'medium',
  };

  it('pins the complete default SDK options', () => {
    const client = { startThread: vi.fn(() => thread) };
    expect(createReadOnlyThread(client, { workingDirectory: '/workspace' })).toBe(thread);
    expect(client.startThread).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it('preserves explicit model and effort when resuming', () => {
    const client = { startThread: vi.fn(() => thread), resumeThread: vi.fn(() => thread) };
    expect(
      createReadOnlyThread(
        client,
        {
          workingDirectory: '/workspace',
          model: 'selected-model',
          modelReasoningEffort: 'high',
        },
        'saved-thread',
      ),
    ).toBe(thread);
    expect(client.resumeThread).toHaveBeenCalledExactlyOnceWith('saved-thread', {
      ...expected,
      model: 'selected-model',
      modelReasoningEffort: 'high',
    });
    expect(client.startThread).not.toHaveBeenCalled();
  });

  it('starts a fresh thread when the client cannot resume', () => {
    const client = { startThread: vi.fn(() => thread) };
    createReadOnlyThread(client, { workingDirectory: '/workspace' }, 'saved-thread');
    expect(client.startThread).toHaveBeenCalledExactlyOnceWith(expected);
  });
});
