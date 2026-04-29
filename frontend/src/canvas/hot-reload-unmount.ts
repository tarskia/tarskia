type QueueMicrotaskLike = (callback: () => void) => void;

const fallbackQueueMicrotask: QueueMicrotaskLike = (callback) => {
  void Promise.resolve().then(callback);
};

const resolveQueueMicrotask = (queueMicrotaskImpl?: QueueMicrotaskLike): QueueMicrotaskLike => {
  if (queueMicrotaskImpl) {
    return queueMicrotaskImpl;
  }
  if (typeof globalThis.queueMicrotask === 'function') {
    return globalThis.queueMicrotask.bind(globalThis);
  }
  return fallbackQueueMicrotask;
};

export const scheduleHotReloadSafeUnmount = (params: {
  onUnmount?: () => void;
  effectGeneration: number;
  getCurrentEffectGeneration: () => number;
  queueMicrotaskImpl?: QueueMicrotaskLike;
}) => {
  const { onUnmount, effectGeneration, getCurrentEffectGeneration, queueMicrotaskImpl } = params;
  resolveQueueMicrotask(queueMicrotaskImpl)(() => {
    if (getCurrentEffectGeneration() !== effectGeneration) {
      return;
    }
    onUnmount?.();
  });
};
