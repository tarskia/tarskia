import { describe, expect, it } from 'vitest';

import { resolveTransitionLiteMode } from './useDiagramEngine';

describe('resolveTransitionLiteMode', () => {
  it('enables transition-lite mode only while a structural overlay is mounted', () => {
    expect(resolveTransitionLiteMode(true)).toBe(true);
    expect(resolveTransitionLiteMode(false)).toBe(false);
  });
});
