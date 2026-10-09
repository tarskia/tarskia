import type { CompiledDiagramEdge } from '@tarskia/diagram-semantics';
import { countEdgeIncidents } from '../presentation/edge-routing';
import { reserveScopeRoutingSpace } from '../presentation/routing-space';
import type { ResolvedNodeVisual } from '../visual/node-visuals';
import {
  getGroupHeaderHeight,
  getGroupMinWidthWithControls,
  getLeafContentMinHeight,
  getLeafMinHeight,
  getListItemHeight,
  renderComponentLayout,
  renderComponentLayoutUncached,
  resolveNodeContentOccluders,
} from './component-renderer';
import { DEFAULT_NODE_SIZE } from './defaults';
import { buildLayoutEdgesByParent, buildLayoutEdgesForParent } from './layout-edges';
import type { LayoutNode, LayoutTree } from './layout-geometry';

/**
 * Layout tree builder
 * - Walks the visible component tree bottom-up.
 * - Computes each node's size and child positions using component renderer (Dagre).
 * - Stores relative positions (child positions are relative to parent).
 * - Produces a tree structure suitable for diffing/animation or projection.
 */
export type { LayoutNode, LayoutTree } from './layout-geometry';

const FOCUS_SHELL_BASE_HEIGHT = 920;
const FOCUS_SHELL_STEP_HEIGHT = 120;
const FOCUS_SHELL_FALLBACK_ASPECT = 16 / 9;
const FOCUS_SHELL_INSET_X = 72;
const FOCUS_SHELL_INSET_Y = 56;

export function applySceneLayout(params: {
  edges: CompiledDiagramEdge[];
  tree: LayoutTree;
  nodeVisuals: Map<string, ResolvedNodeVisual>;
  uncached?: boolean;
}): LayoutTree {
  const { edges, tree, nodeVisuals } = params;
  const edgesByParent = params.uncached ? undefined : buildLayoutEdgesByParent(tree, edges);
  const focusShellAspect = FOCUS_SHELL_FALLBACK_ASPECT;
  const routingIncidentCounts = countEdgeIncidents(edges);

  const baseSizes = new Map<string, { width: number; height: number }>();
  for (const [id, _node] of tree.byId.entries()) {
    if (id === tree.rootId) continue;
    baseSizes.set(id, nodeVisuals.get(id)?.layout.baseSize ?? DEFAULT_NODE_SIZE);
  }

  const computeNode = (nodeId: string): LayoutNode => {
    const node = tree.byId.get(nodeId);
    if (!node) {
      throw new Error(`Scene node "${nodeId}" not found`);
    }
    const base = baseSizes.get(nodeId) ?? DEFAULT_NODE_SIZE;
    const children = node.children;
    const isRoot = nodeId === tree.rootId;
    const nodeVisual = nodeVisuals.get(nodeId);
    const richContent = nodeVisual?.projection.richContent;
    const summaryLabel = nodeVisual?.projection.summaryLabel;
    const isGroup = !isRoot && node.hasChildren;
    const padding = isRoot ? 0 : isGroup ? 16 : 12;
    const childIds = children.map((child) => child.id);
    const layoutEdges = edgesByParent
      ? (edgesByParent.get(nodeId) ?? [])
      : buildLayoutEdgesForParent({
          parentId: nodeId,
          childIds,
          edges,
          tree,
        });

    const hasDetailsControls = node.controls?.showDetailControls ?? Boolean(node.hasChildren);
    const hasChildGroupControls = node.controls?.showChildGroupControls ?? false;

    const headerHeight = isGroup ? getGroupHeaderHeight(0) : 0;
    const childGap = isGroup && children.length > 0 ? 10 : 0;
    const layoutHeaderHeight = headerHeight + childGap;
    const minWidth = isGroup
      ? getGroupMinWidthWithControls(summaryLabel, padding, {
          detailControls: hasDetailsControls,
          childGroupControls: hasChildGroupControls,
        })
      : base.width;
    const minHeight = isGroup
      ? layoutHeaderHeight + padding * 2
      : richContent
        ? getLeafContentMinHeight({
            content: richContent,
            padding,
            width: base.width,
          })
        : getLeafMinHeight({
            badgeCount: 0,
            hasCount: Boolean(summaryLabel),
            padding,
          });
    const adjustedBase = {
      width: Math.max(base.width, minWidth),
      height: Math.max(base.height, minHeight),
    };

    node.baseSize = base;
    node.size = adjustedBase;
    node.summaryLabel = summaryLabel;
    node.layoutMode = undefined;
    node.listShowType = undefined;
    if (children.length === 0) {
      return node;
    }

    const childLayouts = children.map((child) => computeNode(child.id));
    const focusScaffoldDepth = node.focusScaffoldDepth;
    // Compact list mode is intentionally narrow:
    // 1) More than one child (single items should render as cards)
    // 2) No internal edges within this container
    // 3) Every child is a structural leaf in the full tree (not just currently collapsed)
    // Root children render as standalone cards, including the children of a focused list.
    const listMode =
      !isRoot &&
      node.isListContainer !== false &&
      focusScaffoldDepth === undefined &&
      children.length > 1 &&
      layoutEdges.length === 0 &&
      children.every(
        (child) => !child.hasChildren && !nodeVisuals.get(child.id)?.projection.richContent,
      );
    let listShowType = true;
    if (listMode && children.length > 0) {
      const childTypes = new Set(children.map((child) => child.entity.type));
      listShowType = childTypes.size > 1;
    }
    const childSizes: Record<string, { width: number; height: number }> = {};
    for (const childId of childIds) {
      const child = tree.byId.get(childId);
      childSizes[childId] = child?.size ?? baseSizes.get(childId) ?? DEFAULT_NODE_SIZE;
    }
    if (listMode) {
      const listWidth = Math.max(...childLayouts.map((child) => child.size.width));
      for (const child of childLayouts) {
        child.listShowType = listShowType;
        if (child.hasChildren) continue;
        const listHeight = getListItemHeight({
          propCount: 0,
          showType: listShowType,
        });
        child.size = {
          width: listWidth,
          height: listHeight,
        };
        childSizes[child.id] = child.size;
      }
    }

    const spec = {
      padding,
      headerHeight: layoutHeaderHeight,
      layoutMode: listMode ? ('list' as const) : ('graph' as const),
      listGap: 4,
      nodeSep: isRoot ? 40 : 16,
      rankSep: isRoot ? 56 : 22,
    };

    const cachedLayout = params.uncached
      ? undefined
      : renderComponentLayout(childSizes, layoutEdges, spec);
    const baseLayout =
      cachedLayout ?? renderComponentLayoutUncached(childSizes, layoutEdges, spec, true);
    const reserved = listMode
      ? { positions: baseLayout.positions, extraWidth: 0 }
      : reserveScopeRoutingSpace(nodeId, tree, edges, baseLayout.positions, routingIncidentCounts);
    // Never mutate cached layout products; relation labels affect only this presentation spacing.
    const layout = {
      ...baseLayout,
      positions: reserved.positions,
      requiredSize: {
        ...baseLayout.requiredSize,
        width: baseLayout.requiredSize.width + reserved.extraWidth,
      },
    };

    let size = {
      width: Math.max(adjustedBase.width, layout.requiredSize.width),
      height: Math.max(adjustedBase.height, layout.requiredSize.height),
    };

    for (const child of childLayouts) {
      const box = layout.positions[child.id];
      child.position = box ? { x: box.x, y: box.y } : { x: 0, y: 0 };
    }

    if (focusScaffoldDepth !== undefined) {
      const shellHeight = Math.max(
        adjustedBase.height,
        FOCUS_SHELL_BASE_HEIGHT - focusScaffoldDepth * FOCUS_SHELL_STEP_HEIGHT,
      );
      const shellWidth = Math.max(adjustedBase.width, Math.round(shellHeight * focusShellAspect));
      size = {
        width: Math.max(
          size.width,
          shellWidth,
          layout.requiredSize.width + FOCUS_SHELL_INSET_X * 2,
        ),
        height: Math.max(
          size.height,
          shellHeight,
          layout.requiredSize.height + FOCUS_SHELL_INSET_Y * 2,
        ),
      };
      const shiftX = Math.max(0, Math.round((size.width - layout.requiredSize.width) / 2));
      const shiftY = Math.max(0, Math.round((size.height - layout.requiredSize.height) / 2));
      for (const child of childLayouts) {
        const position = child.position ?? { x: 0, y: 0 };
        child.position = {
          x: position.x + shiftX,
          y: position.y + shiftY,
        };
      }
      node.size = size;
      node.summaryLabel = summaryLabel;
      node.layoutMode = 'graph';
      node.listShowType = undefined;
      return node;
    }

    node.size = size;
    node.summaryLabel = summaryLabel;
    node.layoutMode = listMode ? 'list' : 'graph';
    node.listShowType = listShowType;
    return node;
  };

  computeNode(tree.rootId);
  for (const [nodeId, node] of tree.byId.entries()) {
    if (nodeId === tree.rootId) {
      node.contentOccluders = [];
      continue;
    }
    const nodeVisual = nodeVisuals.get(nodeId);
    const isGroup = Boolean(node.hasChildren);
    // Root children render as standalone cards, including the children of a focused list.
    const listMode = node.parentId ? tree.byId.get(node.parentId)?.layoutMode === 'list' : false;
    const richContent = nodeVisual?.projection.richContent;
    const hasVisibleLabel = listMode ? true : Boolean(nodeVisual?.projection.explicitLabel);
    node.contentOccluders = resolveNodeContentOccluders({
      size: node.size,
      isGroup,
      focusShell: node.focusScaffoldDepth !== undefined,
      listMode,
      listShowType: node.listShowType,
      padding: isGroup ? 16 : 12,
      badgeCount: 0,
      showZoomControls: node.controls?.showZoomControls ?? false,
      showDetailControls: node.controls?.showDetailControls ?? false,
      showChildGroupControls: node.controls?.showChildGroupControls ?? false,
      hasSummary: Boolean(node.summaryLabel),
      hasLabel: hasVisibleLabel,
      listPropCount: 0,
      richContent,
    });
  }
  return tree;
}
