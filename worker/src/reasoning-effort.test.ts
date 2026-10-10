import { describe, expect, it } from 'vitest';
import { resolveReasoningEffort } from './reasoning-effort';

describe('reasoning effort validation', () => {
  it('defaults to medium when omitted', () => {
    expect(resolveReasoningEffort()).toBe('medium');
  });

  it.each([
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
    'ultra',
    'persistent',
  ] as const)('accepts %s', (effort) => {
    expect(resolveReasoningEffort(` ${effort} `)).toBe(effort);
  });

  it.each(['', 'HIGH', 'none', 'typo'])('rejects unsupported value %j', (value) => {
    expect(() => resolveReasoningEffort(value)).toThrow(
      'Expected one of: minimal, low, medium, high, xhigh, max, ultra, persistent',
    );
  });
});
