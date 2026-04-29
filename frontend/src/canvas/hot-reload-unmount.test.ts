import { describe, expect, it, vi } from 'vitest';

import { scheduleHotReloadSafeUnmount } from './hot-reload-unmount';

describe('scheduleHotReloadSafeUnmount', () => {
  it('suppresses cleanup when a replacement effect is installed before the microtask runs', () => {
    const onUnmount = vi.fn();
    let currentEffectGeneration = 1;
    let queuedMicrotask: (() => void) | undefined;

    scheduleHotReloadSafeUnmount({
      onUnmount,
      effectGeneration: 1,
      getCurrentEffectGeneration: () => currentEffectGeneration,
      queueMicrotaskImpl: (callback) => {
        queuedMicrotask = callback;
      },
    });

    currentEffectGeneration = 2;
    queuedMicrotask?.();

    expect(onUnmount).not.toHaveBeenCalled();
  });

  it('runs cleanup when the effect generation is still current', () => {
    const onUnmount = vi.fn();
    let queuedMicrotask: (() => void) | undefined;

    scheduleHotReloadSafeUnmount({
      onUnmount,
      effectGeneration: 3,
      getCurrentEffectGeneration: () => 3,
      queueMicrotaskImpl: (callback) => {
        queuedMicrotask = callback;
      },
    });

    queuedMicrotask?.();

    expect(onUnmount).toHaveBeenCalledTimes(1);
  });
});
