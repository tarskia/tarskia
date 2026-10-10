import { describe, expect, it, vi } from 'vitest';
import { runRepairableStage } from './run-repairable-stage';

describe('repair stage policy', () => {
  it('resumes at the saved attempt, retries only selected errors, and preserves hook order', async () => {
    const events: string[] = [];
    const parseError = new SyntaxError('candidate');
    const result = await runRepairableStage({
      firstAttempt: 2,
      maxAttempts: 3,
      beforeAttempt: (n) => {
        events.push(`checkpoint:${n}`);
      },
      attempt: (n) => {
        events.push(`turn:${n}`);
        if (n === 2) throw parseError;
        return 'accepted';
      },
      retryError: (error) => error instanceof SyntaxError,
      afterRetryableError: (error, n) => {
        expect(error).toBe(parseError);
        events.push(`failure:${n}`);
      },
    });
    expect(result).toBe('accepted');
    expect(events).toEqual(['checkpoint:2', 'turn:2', 'failure:2', 'checkpoint:3', 'turn:3']);
  });

  it.each([
    new SyntaxError('parse'),
    new Error('budget exhausted'),
  ])('propagates %s without a retry side effect on the final attempt', async (error) => {
    const afterRetryableError = vi.fn();
    await expect(
      runRepairableStage({
        maxAttempts: 1,
        attempt: () => {
          throw error;
        },
        retryError: () => true,
        afterRetryableError,
      }),
    ).rejects.toBe(error);
    expect(afterRetryableError).not.toHaveBeenCalled();
  });

  it('does not retry an unselected runtime error', async () => {
    const error = new Error('runtime');
    const attempt = vi.fn(() => {
      throw error;
    });
    await expect(
      runRepairableStage({
        maxAttempts: 3,
        attempt,
        retryError: (candidate) => candidate instanceof SyntaxError,
      }),
    ).rejects.toBe(error);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it.each([
    'valid',
    'checkpoint',
    'advisory',
  ] as const)('accepts %s without spending another repair', async (reason) => {
    const repair = vi.fn();
    const accept = vi.fn((acceptedReason) => acceptedReason);
    const result = await runRepairableStage({
      maxRepairs: 2,
      repairCount: () => 2,
      acceptAdvisoriesAtLimit: true,
      evaluate: () => ({
        valid: reason === 'valid',
        checkpointAccepted: reason === 'checkpoint',
        advisoryOnly: reason === 'advisory',
        accept,
        repair,
      }),
    });
    expect(result).toBe(reason);
    expect(repair).not.toHaveBeenCalled();
  });

  it('repairs advisories before the limit and throws for hard errors at the limit', async () => {
    let repairs = 1;
    const events: string[] = [];
    const failure = new Error('fatal');
    await expect(
      runRepairableStage({
        maxRepairs: 2,
        repairCount: () => repairs,
        acceptAdvisoriesAtLimit: true,
        evaluate: () => ({
          valid: false,
          advisoryOnly: repairs === 1,
          accept: () => 'unreachable',
          repair: () => {
            events.push('repair');
            repairs += 1;
          },
          exhausted: () => {
            throw failure;
          },
        }),
      }),
    ).rejects.toBe(failure);
    expect(events).toEqual(['repair']);
    expect(repairs).toBe(2);
  });

  it('restores last-good state at the limit, then checkpoints again before accepting fallback', async () => {
    let fallback = false;
    const events: string[] = [];
    const result = await runRepairableStage({
      maxRepairs: 2,
      repairCount: () => 2,
      evaluate: () => {
        events.push('checkpoint');
        return {
          valid: false,
          fallbackRequired: fallback,
          fallbackAvailable: true,
          restoreFallback: () => {
            events.push('restore');
            fallback = true;
          },
          accept: (reason) => {
            events.push(reason);
            return 'last good';
          },
        };
      },
    });
    expect(result).toBe('last good');
    expect(events).toEqual(['checkpoint', 'restore', 'checkpoint', 'fallback']);
  });

  it('does not evaluate again or consume counters when repair is interrupted', async () => {
    const failure = new Error('turn allowance exhausted');
    const evaluate = vi.fn(() => ({
      valid: false,
      accept: () => undefined,
      repair: () => {
        throw failure;
      },
    }));
    await expect(
      runRepairableStage({ maxRepairs: 3, repairCount: () => 1, evaluate }),
    ).rejects.toBe(failure);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
});
