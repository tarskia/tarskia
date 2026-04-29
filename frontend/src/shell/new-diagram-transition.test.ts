import { describe, expect, it } from 'vitest';

import { createHistory } from '../model/history';
import {
  canRedoNewDiagramTransition,
  canUndoNewDiagramTransition,
  type NewDiagramTransition,
  redoNewDiagramTransition,
  undoNewDiagramTransition,
} from './new-diagram-transition';

describe('new diagram transition helpers', () => {
  const transition: NewDiagramTransition<string, string> = {
    before: {
      snapshot: 'before-snapshot',
      activeDiagramId: 'diagram-1',
      history: createHistory('before-doc'),
      noticeLines: ['Before'],
      selectedEntityId: 'entity-1',
    },
    after: {
      snapshot: 'after-snapshot',
      activeDiagramId: 'diagram-2',
      history: createHistory('after-doc'),
      noticeLines: ['Started Untitled diagram.'],
    },
    position: 'after',
  };

  it('allows undo when the new-diagram history is at its root', () => {
    expect(canUndoNewDiagramTransition(transition, transition.after.history)).toBe(true);

    const result = undoNewDiagramTransition(transition, transition.after.history);
    expect(result?.session).toEqual(transition.before);
    expect(result?.transition.position).toBe('before');
  });

  it('blocks undo while the new-diagram history still has past entries', () => {
    const afterWithPast = {
      ...transition.after,
      history: {
        ...transition.after.history,
        past: ['blank-doc'],
      },
    };

    expect(canUndoNewDiagramTransition(transition, afterWithPast.history)).toBe(false);
    expect(undoNewDiagramTransition(transition, afterWithPast.history)).toBeUndefined();
  });

  it('allows redo after restoring the previous session', () => {
    const beforeTransition: NewDiagramTransition<string, string> = {
      ...transition,
      position: 'before',
    };

    expect(canRedoNewDiagramTransition(beforeTransition, beforeTransition.before.history)).toBe(
      true,
    );

    const result = redoNewDiagramTransition(beforeTransition, beforeTransition.before.history);
    expect(result?.session).toEqual(beforeTransition.after);
    expect(result?.transition.position).toBe('after');
  });
});
