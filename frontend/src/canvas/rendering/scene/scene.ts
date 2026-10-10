import type { CompiledDiagramEdge, SchemaModule, SemanticIndex } from '@tarskia/diagram-semantics';
import type { LayoutTree } from '../layout/layout-geometry';
import type { ResolvedVisualEdge } from '../visual/edge-visuals';
import type { ResolvedNodeVisual } from '../visual/node-visuals';

export interface CanvasScene {
  schema: SchemaModule;
  focusContext?: { scopeRootId: string; index: SemanticIndex; edges: CompiledDiagramEdge[] };
  tree: LayoutTree;
  edges: ResolvedVisualEdge[];
  nodeVisuals: Map<string, ResolvedNodeVisual>;
  visibleIds: Set<string>;
  absolutePositions: Record<string, { x: number; y: number }>;
  zIndexById: Map<string, number>;
}

export function buildAbsolutePositions(tree: LayoutTree): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const queue: Array<{ id: string; abs: { x: number; y: number } }> = [];
  for (const child of tree.root.children) {
    const pos = child.position ?? { x: 0, y: 0 };
    positions[child.id] = pos;
    queue.push({ id: child.id, abs: pos });
  }
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const node = tree.byId.get(current.id);
    if (!node) continue;
    for (const child of node.children) {
      const rel = child.position ?? { x: 0, y: 0 };
      const next = { x: current.abs.x + rel.x, y: current.abs.y + rel.y };
      positions[child.id] = next;
      queue.push({ id: child.id, abs: next });
    }
  }
  return positions;
}

export function buildSceneZIndex(nodePaintOrder: readonly string[]): Map<string, number> {
  return new Map(nodePaintOrder.map((nodeId, index) => [nodeId, index + 1] as const));
}
