export const DEFAULT_HISTORY_LIMIT = 150;

export interface DocumentHistory<T> {
  past: T[];
  present: T;
  future: T[];
}

export function createHistory<T>(present: T): DocumentHistory<T> {
  return {
    past: [],
    present,
    future: [],
  };
}

export function commitHistory<T>(
  history: DocumentHistory<T>,
  updater: T | ((prev: T) => T),
  options?: { undoable?: boolean; limit?: number },
): DocumentHistory<T> {
  const nextPresent =
    typeof updater === 'function' ? (updater as (prev: T) => T)(history.present) : updater;
  if (nextPresent === history.present) return history;

  const undoable = options?.undoable ?? true;
  if (!undoable) {
    return {
      ...history,
      present: nextPresent,
    };
  }

  const limit = options?.limit ?? DEFAULT_HISTORY_LIMIT;
  const nextPast = [...history.past, history.present];
  if (nextPast.length > limit) {
    nextPast.splice(0, nextPast.length - limit);
  }

  return {
    past: nextPast,
    present: nextPresent,
    future: [],
  };
}

export function undoHistory<T>(
  history: DocumentHistory<T>,
  options?: { limit?: number },
): DocumentHistory<T> {
  if (history.past.length === 0) return history;
  const nextPresent = history.past[history.past.length - 1];
  if (nextPresent === undefined) return history;

  const limit = options?.limit ?? DEFAULT_HISTORY_LIMIT;
  const nextPast = history.past.slice(0, -1);
  const nextFuture = [history.present, ...history.future];
  if (nextFuture.length > limit) {
    nextFuture.splice(limit);
  }

  return {
    past: nextPast,
    present: nextPresent,
    future: nextFuture,
  };
}

export function redoHistory<T>(
  history: DocumentHistory<T>,
  options?: { limit?: number },
): DocumentHistory<T> {
  if (history.future.length === 0) return history;
  const [nextPresent, ...restFuture] = history.future;
  if (nextPresent === undefined) return history;

  const limit = options?.limit ?? DEFAULT_HISTORY_LIMIT;
  const nextPast = [...history.past, history.present];
  if (nextPast.length > limit) {
    nextPast.splice(0, nextPast.length - limit);
  }

  return {
    past: nextPast,
    present: nextPresent,
    future: restFuture,
  };
}
