import type { TransitionOverlayFrame } from './overlay';

export interface OverlayFrameStore {
  getSnapshot: () => TransitionOverlayFrame | null;
  subscribe: (listener: () => void) => () => void;
}

export const createOverlayFrameStore = () => {
  let frame: TransitionOverlayFrame | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => frame,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish: (next: TransitionOverlayFrame | null) => {
      if (frame === next) return;
      frame = next;
      for (const listener of listeners) listener();
    },
  };
};
