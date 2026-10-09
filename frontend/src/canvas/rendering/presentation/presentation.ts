import { type DiagramViewNodeControls, getSchemaObjectLocalId } from '@tarskia/diagram-semantics';
import type { CanvasScene } from '../scene/scene';
import type { DirectionalEdgeLabel } from '../visual/edge-labels';
import type { ResolvedNodeRichContent, ResolvedNodeVisual } from '../visual/node-visuals';
import { routeCanvasEdges } from './edge-routing';
import {
  buildBezierEdgeGeometry,
  type CanvasEdgeGeometry,
  type CanvasPoint,
  type CanvasRect,
} from './geometry';

const UNTAGGED_FALLBACK_HUE = 210;
const UNKNOWN_TAG_HUE_PALETTE = [196, 168, 132, 282, 338, 44];

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
};

const parseHexToHue = (hex: string): number | undefined => {
  const normalized = hex.trim().replace(/^#/, '');
  const fullHex =
    normalized.length === 3
      ? normalized
          .split('')
          .map((ch) => `${ch}${ch}`)
          .join('')
      : normalized;
  if (!/^[\da-f]{6}$/i.test(fullHex)) return undefined;
  const r = Number.parseInt(fullHex.slice(0, 2), 16) / 255;
  const g = Number.parseInt(fullHex.slice(2, 4), 16) / 255;
  const b = Number.parseInt(fullHex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let hue = 0;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  const degrees = Math.round(hue * 60);
  return degrees < 0 ? degrees + 360 : degrees;
};

const parseHslToHue = (color: string): number | undefined => {
  const match = color.match(/^hsl\(\s*(-?\d+(?:\.\d+)?)\s*(?:deg)?[,\s]/i);
  if (!match?.[1]) return undefined;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return undefined;
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

const resolveHueFromColor = (color?: string): number | undefined => {
  if (!color) return undefined;
  return parseHexToHue(color) ?? parseHslToHue(color);
};

const collectOrderedNodeIds = (scene: CanvasScene) => {
  const ordered: string[] = [];
  const visit = (parentId: string) => {
    const parent = scene.tree.byId.get(parentId);
    const children = parent ? parent.children : scene.tree.root.children;
    for (const child of children) {
      ordered.push(child.id);
      visit(child.id);
    }
  };
  visit(scene.tree.rootId);
  return ordered;
};

const collectRenderableNodeIds = (scene: CanvasScene) => {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const nodeId of collectOrderedNodeIds(scene)) {
    if (!scene.visibleIds.has(nodeId) || seen.has(nodeId)) continue;
    ordered.push(nodeId);
    seen.add(nodeId);
  }
  for (const nodeId of scene.visibleIds) {
    if (seen.has(nodeId)) continue;
    ordered.push(nodeId);
    seen.add(nodeId);
  }
  return ordered;
};

const resolveFallbackSolidOverNodeIds = (
  scene: CanvasScene,
  sourceId: string,
  targetId: string,
) => {
  const solidOverNodeIds = new Set<string>();
  const addAncestorChain = (nodeId: string) => {
    let current = scene.tree.byId.get(nodeId)?.parentId;
    while (current) {
      if (current !== scene.tree.rootId) {
        solidOverNodeIds.add(current);
      }
      current = scene.tree.byId.get(current)?.parentId;
    }
  };
  addAncestorChain(sourceId);
  addAncestorChain(targetId);
  return [...solidOverNodeIds];
};

export interface CanvasNodeContentOccluder {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasNodeView {
  id: string;
  kind: 'entity' | 'group';
  parentId?: string;
  matched: boolean;
  rect: CanvasRect;
  zIndex?: number;
  opacity: number;
  contentScale: number;
  content: {
    label: string;
    entityType: string;
    badges: string[];
    richContent?: ResolvedNodeRichContent;
    summaryLabel?: string;
    primaryTagLabel?: string;
    primaryTagHue?: number;
    listMode: boolean;
    listProps: string[];
    listShowType: boolean;
    focusShell?: boolean;
    focusShellDepth?: number;
    childOpacity?: number;
    debug?: {
      id: string;
      parentId?: string;
      visible: boolean;
      opacity: number;
      childOpacity?: number;
      absX: number;
      absY: number;
      transitioning: boolean;
    };
  };
  style: {
    background: string;
    border: string;
    color: string;
    selectionRing: string;
    selectionGlow: string;
    selectionFill: string;
    transparentChrome: boolean;
    focusShell: boolean;
  };
  controls: DiagramViewNodeControls;
  capabilities: {
    hasChildren: boolean;
  };
  contentOccluders?: CanvasNodeContentOccluder[];
}

export interface CanvasOverlayOccluder {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex?: number;
}

export interface CanvasOverlayEdgeView {
  id: string;
  relationId: string;
  relationIds?: string[];
  directionalLabels?: DirectionalEdgeLabel[];
  kind: 'routed' | 'local';
  sourceId: string;
  targetId: string;
  scopeId?: string;
  label?: string;
  state?: 'undecided' | 'none';
  matched: boolean;
  geometry: CanvasEdgeGeometry;
  path: string;
  labelAnchor: { x: number; y: number };
  opacity: number;
  selected?: boolean;
  hideLabel?: boolean;
  solidOverNodeIds: string[];
}

export interface CanvasPresentation {
  nodes: CanvasNodeView[];
  overlayEdges: CanvasOverlayEdgeView[];
}

export type CanvasRenderSnapshot = CanvasPresentation;

interface RawOverlayEdgeSpec
  extends Omit<CanvasOverlayEdgeView, 'geometry' | 'path' | 'labelAnchor'> {
  sourceRect: CanvasRect;
  targetRect: CanvasRect;
  semanticSourceId?: string;
  semanticTargetId?: string;
}

/** Immutable render snapshots are revisions; unchanged inputs retain their identity. */
export const areCanvasRenderSnapshotsEqual = (
  left: CanvasRenderSnapshot,
  right: CanvasRenderSnapshot,
): boolean => left === right;

const buildStaticCanvasPresentationUncached = ({
  scene,
  debug,
}: {
  scene: CanvasScene;
  debug?: boolean;
}): CanvasRenderSnapshot => {
  const tagById = new Map((scene.schema.tags ?? []).map((tag) => [tag.id, tag]));

  const resolvePrimaryTagHue = (primaryTag: string | undefined) => {
    if (!primaryTag) return undefined;
    const explicitColorHue = resolveHueFromColor(tagById.get(primaryTag)?.color);
    if (typeof explicitColorHue === 'number') {
      return explicitColorHue;
    }
    const fallbackIndex = hashString(primaryTag) % UNKNOWN_TAG_HUE_PALETTE.length;
    return UNKNOWN_TAG_HUE_PALETTE[fallbackIndex];
  };

  const resolveNodeHue = (nodeVisual: ResolvedNodeVisual | undefined) => {
    if (typeof nodeVisual?.identity.fallbackHue === 'number') {
      return nodeVisual.identity.fallbackHue;
    }
    return resolvePrimaryTagHue(nodeVisual?.identity.primaryTagId) ?? UNTAGGED_FALLBACK_HUE;
  };

  const resolveNodeStyle = (
    nodeVisual: ResolvedNodeVisual | undefined,
    isGroup: boolean,
    focusShell: boolean,
  ) => {
    const primaryTagId = nodeVisual?.identity.primaryTagId;
    const hue = resolveNodeHue(nodeVisual);
    const primaryTagHue = resolvePrimaryTagHue(primaryTagId) ?? hue;
    const primaryTagLabel = primaryTagId
      ? (tagById.get(primaryTagId)?.label ?? getSchemaObjectLocalId(primaryTagId))
      : undefined;
    const bgLightness = isGroup ? 'var(--node-bg-l-group, 18%)' : 'var(--node-bg-l, 16%)';
    if (focusShell) {
      return {
        background: 'transparent',
        border: '1px solid transparent',
        color: 'var(--node-text, hsla(0, 0%, 98%, 0.95))',
        primaryTagLabel,
        primaryTagHue,
        selectionRing: `hsla(${hue}, 60%, 70%, 0.9)`,
        selectionGlow: 'transparent',
        selectionFill: 'transparent',
      } as const;
    }
    return {
      background: `hsla(${hue}, var(--node-bg-s, 38%), ${bgLightness}, 1)`,
      border: `1px solid hsla(${hue}, var(--node-border-s, 40%), var(--node-border-l, 55%), var(--node-border-a, 0.55))`,
      color: 'var(--node-text, hsla(0, 0%, 98%, 0.95))',
      primaryTagLabel,
      primaryTagHue,
      selectionRing: `hsla(${hue}, 60%, 70%, 0.9)`,
      selectionGlow: 'transparent',
      selectionFill: `hsla(${hue}, 45%, 50%, 0.1)`,
    } as const;
  };

  const resolveSceneNode = (nodeId: string) => scene.tree.byId.get(nodeId);
  const resolveNodeVisual = (nodeId: string) => scene.nodeVisuals.get(nodeId);
  const resolveAbsolutePosition = (nodeId: string) => scene.absolutePositions[nodeId];
  const resolveLayoutMode = (nodeId: string) => scene.tree.byId.get(nodeId)?.layoutMode;

  const resolveRect = (nodeId: string): CanvasRect | undefined => {
    const sceneNode = resolveSceneNode(nodeId);
    const position = resolveAbsolutePosition(nodeId);
    const size = sceneNode?.size ?? sceneNode?.baseSize;
    if (!sceneNode || !position || !size) return undefined;
    return {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    };
  };

  const orderedNodeIds = collectRenderableNodeIds(scene);
  const nodes = orderedNodeIds.flatMap((nodeId) => {
    const sceneNode = resolveSceneNode(nodeId);
    const nodeVisual = resolveNodeVisual(nodeId);
    const rect = resolveRect(nodeId);
    if (!sceneNode || !nodeVisual || !rect) return [];
    const isGroup = Boolean(sceneNode.hasChildren);
    const parentId =
      sceneNode.parentId && sceneNode.parentId !== scene.tree.rootId
        ? sceneNode.parentId
        : undefined;
    const parentLayoutMode = parentId ? resolveLayoutMode(parentId) : undefined;
    const listMode = parentLayoutMode === 'list';
    const focusShell = isGroup && sceneNode.focusScaffoldDepth !== undefined;
    const showListType = sceneNode.listShowType ?? true;
    const styleTokens = resolveNodeStyle(nodeVisual, isGroup, focusShell);
    const label =
      nodeVisual.projection.explicitLabel ??
      (listMode ? `Unnamed ${nodeVisual.projection.typeLabel}` : '');

    return [
      {
        id: nodeId,
        kind: isGroup ? 'group' : 'entity',
        parentId,
        matched: false,
        rect,
        zIndex: scene.zIndexById.get(nodeId),
        opacity: 1,
        contentScale: 1,
        content: {
          label,
          entityType: nodeVisual.projection.typeLabel,
          badges: [],
          richContent: nodeVisual.projection.richContent,
          summaryLabel: sceneNode.summaryLabel,
          primaryTagLabel: styleTokens.primaryTagLabel,
          primaryTagHue: styleTokens.primaryTagHue,
          listMode,
          listProps: [],
          listShowType: showListType,
          focusShell,
          focusShellDepth: sceneNode.focusScaffoldDepth,
          childOpacity: isGroup ? 1 : undefined,
          debug: debug
            ? {
                id: nodeId,
                parentId,
                visible: scene.visibleIds.has(nodeId),
                opacity: 1,
                childOpacity: isGroup ? 1 : undefined,
                absX: rect.x,
                absY: rect.y,
                transitioning: false,
              }
            : undefined,
        },
        style: {
          background: styleTokens.background,
          border: styleTokens.border,
          color: styleTokens.color,
          selectionRing: styleTokens.selectionRing,
          selectionGlow: styleTokens.selectionGlow,
          selectionFill: styleTokens.selectionFill,
          transparentChrome: listMode || focusShell,
          focusShell,
        },
        controls: sceneNode.controls ?? {
          targetId: nodeId,
          showZoomControls: false,
          canZoomIn: false,
          canZoomOut: false,
          showDetailControls: false,
          canExpandDetails: false,
          canCollapseDetails: false,
          showChildGroupControls: false,
          canExpandChildGroups: false,
          canCollapseChildGroups: false,
        },
        capabilities: {
          hasChildren: Boolean(sceneNode.hasChildren),
        },
        contentOccluders: sceneNode.contentOccluders ?? [],
      } satisfies CanvasNodeView,
    ];
  });

  const nodeRects = new Map(nodes.map((node) => [node.id, node.rect]));
  const rawOverlayEdges: RawOverlayEdgeSpec[] = scene.edges.flatMap((edge) => {
    const sourceRect = nodeRects.get(edge.sourceId);
    const targetRect = nodeRects.get(edge.targetId);
    if (!sourceRect || !targetRect) return [];
    return [
      {
        id: edge.id,
        relationId: edge.relationId,
        relationIds: edge.relationIds,
        directionalLabels: edge.directionalLabels,
        semanticSourceId: edge.semanticSourceId,
        semanticTargetId: edge.semanticTargetId,
        kind: 'routed',
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        label: edge.label,
        state: edge.state,
        matched: false,
        opacity: 1,
        solidOverNodeIds:
          edge.solidOverNodeIds && edge.solidOverNodeIds.length > 0
            ? edge.solidOverNodeIds
            : resolveFallbackSolidOverNodeIds(scene, edge.sourceId, edge.targetId),
        sourceRect,
        targetRect,
      },
    ];
  });

  const overlayEdges: CanvasOverlayEdgeView[] = rawOverlayEdges.map((edge) => {
    const geometry = buildBezierEdgeGeometry({
      sourceRect: edge.sourceRect,
      targetRect: edge.targetRect,
    });

    return {
      id: edge.id,
      relationId: edge.relationId,
      relationIds: edge.relationIds,
      directionalLabels: edge.directionalLabels,
      kind: edge.kind,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      scopeId: edge.scopeId,
      label: edge.label,
      state: edge.state,
      matched: edge.matched,
      geometry,
      path: geometry.path,
      labelAnchor: geometry.labelAnchor,
      opacity: edge.opacity,
      selected: edge.selected,
      hideLabel: edge.hideLabel,
      solidOverNodeIds: edge.solidOverNodeIds,
    };
  });

  return {
    nodes,
    overlayEdges: routeCanvasEdges(nodes, overlayEdges),
  };
};

const staticPresentations = new WeakMap<CanvasScene, Map<boolean, CanvasRenderSnapshot>>();
export const buildStaticCanvasPresentation = (params: {
  scene: CanvasScene;
  debug?: boolean;
}): CanvasRenderSnapshot => {
  let variants = staticPresentations.get(params.scene);
  if (!variants) {
    variants = new Map();
    staticPresentations.set(params.scene, variants);
  }
  const key = Boolean(params.debug);
  let result = variants.get(key);
  if (!result) {
    result = buildStaticCanvasPresentationUncached(params);
    variants.set(key, result);
  }
  return result;
};
