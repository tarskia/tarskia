import type { DiagramView } from '@tarskia/diagram-semantics';

export type CommitView = (
  updater:
    | DiagramView
    | undefined
    | ((previous: DiagramView | undefined) => DiagramView | undefined),
) => void;
