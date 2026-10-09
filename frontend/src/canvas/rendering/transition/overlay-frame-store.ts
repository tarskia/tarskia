import type { AnimationFrame } from './overlay';

export interface OverlayFrameStore {
  getSnapshot: () => AnimationFrame | null;
  subscribe: (listener: () => void) => () => void;
}

export const createOverlayFrameStore = () => {
  let frame: AnimationFrame | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => frame,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish: (next: AnimationFrame | null) => {
      if (frame === next) return;
      frame = next;
      for (const listener of listeners) listener();
    },
  };
};
