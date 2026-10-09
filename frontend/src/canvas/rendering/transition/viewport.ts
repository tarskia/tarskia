import { collectDescendantIds } from '@tarskia/diagram-semantics';
import type { LayoutTree } from '../layout/tree-traverser';

export type ViewportBounds = { minX: number; minY: number; maxX: number; maxY: number };

export function collectSubtreeIds(tree: LayoutTree, rootId: string): Set<string> {
  return collectDescendantIds(tree, rootId, { includeRoot: true });
}
