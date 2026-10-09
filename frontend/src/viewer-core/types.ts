import type { SemanticDocument } from '@tarskia/diagram-semantics';

export type CommitDoc = (
  updater: SemanticDocument | ((prev: SemanticDocument) => SemanticDocument),
) => void;
