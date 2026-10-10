import type { SemanticIndex } from '@tarskia/diagram-semantics';
import { type CompiledDiagramViewState, ImmutableMap } from '@tarskia/diagram-semantics';
import { buildAbsolutePositions, buildSceneZIndex, type CanvasScene } from '../scene/scene';
import { buildEdgeVisuals } from '../visual/edge-visuals';
import { buildNodeVisualMap } from '../visual/node-visuals';
import { createLayoutGeometry } from './layout-geometry';
import { applySceneLayout } from './tree-traverser';

/**
 * Layout engine (pipeline)
 * - Input: graph model + expanded map.
 * - Step 1: build canonical visible scene tree from the document.
 * - Step 2: resolve semantic visual/projection hints for the visible tree.
 * - Step 3: enrich that same tree with sizing and relative positions.
 * - Step 4: derive scene indexes needed by transitions/adapters.
 * - Output: CanvasScene is a pure, stateless snapshot for the current doc state.
 */
export type LayoutResult = CanvasScene;

const results = new WeakMap<SemanticIndex, WeakMap<CompiledDiagramViewState, LayoutResult>>();

export function buildLayoutResult(params: {
  graph: SemanticIndex;
  viewState: CompiledDiagramViewState;
  uncached?: boolean;
}): LayoutResult {
  const { graph, viewState } = params;
  const cached = !params.uncached && results.get(graph)?.get(viewState);
  if (cached) return cached;
  const tree = createLayoutGeometry({ tree: viewState.tree });
  const nodeVisuals = buildNodeVisualMap({ schema: graph.schema, tree, uncached: params.uncached });
  const edges = buildEdgeVisuals({
    schema: graph.schema,
    edges: viewState.edges,
  });
  applySceneLayout({
    edges,
    tree,
    nodeVisuals,
    uncached: params.uncached,
  });
  for (const node of tree.byId.values()) {
    Object.freeze(node.size);
    Object.freeze(node.baseSize);
    if (node.position) Object.freeze(node.position);
    for (const rect of node.contentOccluders ?? []) Object.freeze(rect);
    if (node.contentOccluders) Object.freeze(node.contentOccluders);
    Object.freeze(node.children);
    Object.freeze(node);
  }
  tree.byId = new ImmutableMap(tree.byId);
  tree.childrenByParent = new ImmutableMap(tree.childrenByParent);
  Object.freeze(tree);
  for (const edge of edges) Object.freeze(edge);
  Object.freeze(edges);
  const absolutePositions = buildAbsolutePositions(tree);
  for (const position of Object.values(absolutePositions)) Object.freeze(position);
  Object.freeze(absolutePositions);
  const visibleIds = (() => {
    return new Set([
      ...[...tree.byId.keys()].filter((id) => id !== tree.rootId),
      ...(viewState.scopeRootId &&
      (viewState.edges.some((edge) => edge.external) ||
        !graph.tree.byId.get(viewState.scopeRootId)?.children.length)
        ? [viewState.scopeRootId]
        : []),
      ...viewState.edges.flatMap((edge) => (edge.external ? [edge.external.displayId] : [])),
    ]);
  })();
  const result = Object.freeze({
    schema: graph.schema,
    ...(viewState.scopeRootId &&
    (viewState.edges.some((edge) => edge.external) ||
      !graph.tree.byId.get(viewState.scopeRootId)?.children.length)
      ? {
          focusContext: {
            scopeRootId: viewState.scopeRootId,
            index: graph,
            edges: viewState.edges,
          },
        }
      : {}),
    tree,
    edges,
    nodeVisuals: new ImmutableMap(nodeVisuals),
    visibleIds,
    absolutePositions,
    zIndexById: new ImmutableMap(buildSceneZIndex(viewState.nodePaintOrder)),
  });
  if (!params.uncached) {
    let byView = results.get(graph);
    if (!byView) {
      byView = new WeakMap();
      results.set(graph, byView);
    }
    byView.set(viewState, result);
  }
  return result;
}
