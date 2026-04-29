import type { DiagramView, DiagramViewNodeState, DocumentLayout } from '../model/types';

export interface NormalizedDiagramViewState {
  view: DiagramView;
  layout: DocumentLayout;
  expanded: Record<string, boolean>;
  hiddenIds: Set<string>;
  highlightedIds: Set<string>;
}

export const normalizeDiagramViewNodesById = (
  nodesById: DiagramView['nodesById'],
): DiagramView['nodesById'] => {
  if (!nodesById) {
    return undefined;
  }
  const entries = Object.entries(nodesById)
    .filter(([, state]) => Boolean(state?.expanded || state?.hidden || state?.highlighted))
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

export const normalizeDocumentLayout = (layout?: DocumentLayout): DocumentLayout => ({
  viewport: layout?.viewport,
});

export const normalizeDiagramView = (view?: DiagramView): DiagramView => ({
  kind: 'semantic-diagram-view',
  version: 2,
  scopeRootId: view?.scopeRootId,
  nodesById: normalizeDiagramViewNodesById(view?.nodesById),
  layout: normalizeDocumentLayout(view?.layout),
});

const getNodeIdsByFlag = (
  nodesById: DiagramView['nodesById'],
  flag: keyof DiagramViewNodeState,
): Set<string> =>
  new Set(
    Object.entries(nodesById ?? {})
      .filter(([, state]) => state?.[flag] === true)
      .map(([nodeId]) => nodeId),
  );

export const getDiagramViewExpandedMap = (
  view: DiagramView | undefined,
): Record<string, boolean> => {
  const entries = Object.entries(view?.nodesById ?? {}).filter(([, state]) => state?.expanded);
  if (entries.length === 0) {
    return {};
  }
  return Object.fromEntries(entries.map(([id]) => [id, true]));
};

export const normalizeDiagramViewState = (view?: DiagramView): NormalizedDiagramViewState => {
  const normalizedView = normalizeDiagramView(view);
  return {
    view: normalizedView,
    layout: normalizeDocumentLayout(normalizedView.layout),
    expanded: getDiagramViewExpandedMap(normalizedView),
    hiddenIds: getNodeIdsByFlag(normalizedView.nodesById, 'hidden'),
    highlightedIds: getNodeIdsByFlag(normalizedView.nodesById, 'highlighted'),
  };
};
