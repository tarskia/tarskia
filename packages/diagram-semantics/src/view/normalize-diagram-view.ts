import type { DiagramView, DiagramViewNodeState, DocumentLayout } from '../model/types';

export interface NormalizedDiagramViewState {
  view: DiagramView;
  layout: DocumentLayout;
  expanded: Record<string, boolean>;
  highlightedIds: Set<string>;
}

/** Retain supported boolean values, including explicit false flags in saved documents. */
export const sanitizeDiagramViewNodesById = (
  nodesById: DiagramView['nodesById'],
): DiagramView['nodesById'] => {
  if (!nodesById) return undefined;
  const entries = Object.entries(nodesById)
    .map(([id, state]): [string, DiagramViewNodeState] => [
      id,
      {
        ...(typeof state?.expanded === 'boolean' ? { expanded: state.expanded } : {}),
        ...(typeof state?.highlighted === 'boolean' ? { highlighted: state.highlighted } : {}),
      },
    ])
    .filter(([, state]) => Object.keys(state).length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

export const normalizeDiagramViewNodesById = (
  nodesById: DiagramView['nodesById'],
): DiagramView['nodesById'] => {
  const entries = Object.entries(sanitizeDiagramViewNodesById(nodesById) ?? {})
    .filter(([, state]) => Boolean(state.expanded || state.highlighted))
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
    highlightedIds: getNodeIdsByFlag(normalizedView.nodesById, 'highlighted'),
  };
};
