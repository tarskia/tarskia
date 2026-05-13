import type { CompiledDiagramViewState } from '../../../semantic';
import type { GraphModel } from '../graph/graph-model';
import { buildAbsolutePositions, buildSceneZIndex, type CanvasScene } from '../scene/scene';
import { buildSceneTree } from '../tree/scene-tree';
import { buildEdgeVisuals } from '../visual/edge-visuals';
import { buildNodeVisualMap } from '../visual/node-visuals';
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

export function buildLayoutResult(params: {
  graph: GraphModel;
  viewState: CompiledDiagramViewState;
  canvasSize?: { width: number; height: number } | null;
}): LayoutResult {
  const { graph, viewState } = params;
  const tree = buildSceneTree({ tree: viewState.tree });
  const nodeVisuals = buildNodeVisualMap({ schema: graph.schema, tree });
  const edges = buildEdgeVisuals({
    schema: graph.schema,
    edges: viewState.edges,
  });
  applySceneLayout({
    schema: graph.schema,
    edges,
    tree,
    nodeVisuals,
  });
  const visibleIds = (() => {
    return new Set([...tree.byId.keys()].filter((id) => id !== tree.rootId));
  })();
  return {
    doc: graph.doc,
    schema: graph.schema,
    tree,
    edges,
    nodeVisuals,
    visibleIds,
    absolutePositions: buildAbsolutePositions(tree),
    zIndexById: buildSceneZIndex(viewState.nodePaintOrder),
    layoutMeta: {
      level: 0,
    },
  };
}
