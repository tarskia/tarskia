import type {
  DiagramCamera,
  DiagramView,
  DiagramViewNodeState,
  LegacyDiagramView,
  ViewportState,
} from '../model/types';

export interface NormalizedDiagramViewState {
  view: DiagramView;
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

/** v2 saved no canvas dimensions; migration assumes a 1440 x 900 visible canvas. */
export const migrateLegacyViewport = (viewport?: ViewportState): DiagramCamera | undefined => {
  if (!viewport) return undefined;
  if (![viewport.x, viewport.y, viewport.zoom].every(Number.isFinite) || viewport.zoom <= 0)
    throw new Error('Invalid legacy camera viewport');
  return {
    rect: {
      x: -viewport.x / viewport.zoom,
      y: -viewport.y / viewport.zoom,
      width: 1440 / viewport.zoom,
      height: 900 / viewport.zoom,
    },
  };
};

export const normalizeDiagramCamera = (camera?: DiagramCamera): DiagramCamera | undefined => {
  if (!camera) return undefined;
  const rect = camera.rect;
  if (
    !rect ||
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    (camera.anchorId !== undefined && typeof camera.anchorId !== 'string')
  )
    throw new Error('Invalid diagram camera framing');
  return {
    ...(camera.anchorId !== undefined ? { anchorId: camera.anchorId } : {}),
    rect: { ...rect },
  };
};

/** Upgrade storage without discarding explicit false node flags. */
export const migrateDiagramView = (view: DiagramView | LegacyDiagramView): DiagramView => {
  if (view.version !== 2 && view.version !== 3)
    throw new Error(`Unsupported diagram view version: ${(view as { version: number }).version}`);
  const camera =
    view.version === 2
      ? migrateLegacyViewport(view.layout?.viewport)
      : normalizeDiagramCamera(view.camera);
  return {
    kind: 'semantic-diagram-view',
    version: 3,
    ...(view.scopeRootId !== undefined ? { scopeRootId: view.scopeRootId } : {}),
    ...(view.nodesById !== undefined
      ? { nodesById: sanitizeDiagramViewNodesById(view.nodesById) }
      : {}),
    ...(camera ? { camera } : {}),
  };
};

export const normalizeDiagramView = (view?: DiagramView | LegacyDiagramView): DiagramView => ({
  ...(view
    ? migrateDiagramView(view)
    : { kind: 'semantic-diagram-view' as const, version: 3 as const }),
  nodesById: normalizeDiagramViewNodesById(view?.nodesById),
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
    expanded: getDiagramViewExpandedMap(normalizedView),
    highlightedIds: getNodeIdsByFlag(normalizedView.nodesById, 'highlighted'),
  };
};
