import type { SemanticDocument } from '../semantic';

export type CommitDoc = (
  updater: SemanticDocument | ((prev: SemanticDocument) => SemanticDocument),
  options?: { undoable?: boolean },
) => void;

export type EnsureDiagramView = (
  view: SemanticDocument['view'],
) => NonNullable<SemanticDocument['view']>;

export type EnsureDiagramViewLayout = (
  view: SemanticDocument['view'],
) => NonNullable<NonNullable<SemanticDocument['view']>['layout']>;
