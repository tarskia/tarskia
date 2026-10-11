import { createContext, useContext } from 'react';

export type CanvasDiffState = 'added' | 'removed' | 'changed' | 'unchanged';
export const CanvasDiffContext = createContext<
  | {
      entities: ReadonlyMap<string, CanvasDiffState>;
      relations: ReadonlyMap<string, CanvasDiffState>;
    }
  | undefined
>(undefined);
export const diffSymbol = (state?: CanvasDiffState) =>
  state === 'added' ? '+' : state === 'removed' ? '−' : state === 'changed' ? '~' : '';

export const useCanvasDiff = () => useContext(CanvasDiffContext);
