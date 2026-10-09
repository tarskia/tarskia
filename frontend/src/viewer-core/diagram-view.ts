import type { EnsureDiagramView, EnsureDiagramViewLayout } from './types';

export const ensureDiagramView: EnsureDiagramView = (view) => ({
  kind: 'semantic-diagram-view',
  version: 2,
  scopeRootId: view?.scopeRootId,
  nodesById: view?.nodesById,
  layout: view?.layout,
});

export const ensureDiagramViewLayout: EnsureDiagramViewLayout = (view) => ({
  viewport: view?.layout?.viewport,
});
