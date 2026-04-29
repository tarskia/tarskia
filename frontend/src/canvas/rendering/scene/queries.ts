import { collectDescendantParentIds, getChildren } from '../../../semantic';
import type { LayoutResult } from '../layout/layout-pipeline';

export interface DiagramViewQueries {
  getChildren: (rootId: string) => Array<{ id: string }>;
  getDescendantParentIds: (rootId: string, includeRoot?: boolean) => string[];
}

export const buildRenderedDiagramViewQueries = (layout: LayoutResult): DiagramViewQueries => ({
  getChildren: (rootId) => getChildren(layout.tree, rootId),
  getDescendantParentIds: (rootId, includeRoot = false) =>
    collectDescendantParentIds(layout.tree, rootId, { includeRoot }),
});
