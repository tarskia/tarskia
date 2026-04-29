import { describe, expect, it } from 'vitest';
import {
  commitHistory,
  createHistory,
  DEFAULT_HISTORY_LIMIT,
  type DocumentHistory,
  redoHistory,
  undoHistory,
} from './history';

interface TestDoc {
  id: number;
  view?: {
    expanded?: Record<string, boolean>;
  };
}

describe('history', () => {
  it('supports undo and redo across document snapshots', () => {
    const initial: TestDoc = { id: 1, view: { expanded: { db: true } } };
    const next: TestDoc = { id: 2, view: { expanded: { db: true, schema: true } } };
    const third: TestDoc = { id: 3, view: { expanded: {} } };

    let history = createHistory(initial);
    history = commitHistory(history, next);
    history = commitHistory(history, third);

    expect(history.present).toEqual(third);
    history = undoHistory(history);
    expect(history.present).toEqual(next);
    history = undoHistory(history);
    expect(history.present).toEqual(initial);
    history = redoHistory(history);
    expect(history.present).toEqual(next);
    history = redoHistory(history);
    expect(history.present).toEqual(third);
  });

  it('clears redo when a new undoable commit is made', () => {
    const initial: TestDoc = { id: 1 };
    const second: TestDoc = { id: 2 };
    const third: TestDoc = { id: 3 };

    let history = createHistory(initial);
    history = commitHistory(history, second);
    history = commitHistory(history, third);
    history = undoHistory(history);
    expect(history.future.length).toBe(1);

    history = commitHistory(history, { id: 4 });
    expect(history.future).toHaveLength(0);
    expect(history.present.id).toBe(4);
  });

  it('keeps redo chain for non-undoable commits', () => {
    const initial: TestDoc = { id: 1 };
    const second: TestDoc = { id: 2 };
    const third: TestDoc = { id: 3 };

    let history = createHistory(initial);
    history = commitHistory(history, second);
    history = commitHistory(history, third);
    history = undoHistory(history);

    const redoBefore = history.future[0];
    history = commitHistory(
      history,
      { id: 2, view: { expanded: { db: true } } },
      { undoable: false },
    );
    expect(history.future[0]).toBe(redoBefore);
    expect(history.past).toHaveLength(1);
  });

  it('enforces bounded history size', () => {
    const limit = 3;
    let history: DocumentHistory<TestDoc> = createHistory({ id: 0 });
    for (let i = 1; i <= 10; i += 1) {
      history = commitHistory(history, { id: i }, { limit });
    }

    expect(history.past).toHaveLength(limit);
    expect(history.past.map((doc) => doc.id)).toEqual([7, 8, 9]);

    let redoCapped = createHistory({ id: 0 });
    for (let i = 1; i <= DEFAULT_HISTORY_LIMIT + 3; i += 1) {
      redoCapped = commitHistory(redoCapped, { id: i });
    }
    for (let i = 0; i < DEFAULT_HISTORY_LIMIT + 1; i += 1) {
      redoCapped = undoHistory(redoCapped);
    }
    expect(redoCapped.future.length).toBeLessThanOrEqual(DEFAULT_HISTORY_LIMIT);
  });
});
