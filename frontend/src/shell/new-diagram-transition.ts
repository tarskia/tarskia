import type { DocumentHistory } from '../semantic';

export interface DiagramSessionState<TDoc, TSnapshot> {
  snapshot: TSnapshot;
  activeDiagramId?: string;
  history: DocumentHistory<TDoc>;
  noticeLines: string[];
  selectedEntityId?: string;
  selectedEdgeId?: string;
}

export interface NewDiagramTransition<TDoc, TSnapshot> {
  before: DiagramSessionState<TDoc, TSnapshot>;
  after: DiagramSessionState<TDoc, TSnapshot>;
  position: 'before' | 'after';
}

export const canUndoNewDiagramTransition = <TDoc, TSnapshot>(
  transition: NewDiagramTransition<TDoc, TSnapshot> | undefined,
  history: DocumentHistory<TDoc>,
) => Boolean(transition && transition.position === 'after' && history.past.length === 0);

export const canRedoNewDiagramTransition = <TDoc, TSnapshot>(
  transition: NewDiagramTransition<TDoc, TSnapshot> | undefined,
  history: DocumentHistory<TDoc>,
) => Boolean(transition && transition.position === 'before' && history.future.length === 0);

export const undoNewDiagramTransition = <TDoc, TSnapshot>(
  transition: NewDiagramTransition<TDoc, TSnapshot> | undefined,
  history: DocumentHistory<TDoc>,
) => {
  if (!canUndoNewDiagramTransition(transition, history) || !transition) return undefined;
  return {
    session: transition.before,
    transition: {
      ...transition,
      position: 'before' as const,
    },
  };
};

export const redoNewDiagramTransition = <TDoc, TSnapshot>(
  transition: NewDiagramTransition<TDoc, TSnapshot> | undefined,
  history: DocumentHistory<TDoc>,
) => {
  if (!canRedoNewDiagramTransition(transition, history) || !transition) return undefined;
  return {
    session: transition.after,
    transition: {
      ...transition,
      position: 'after' as const,
    },
  };
};
