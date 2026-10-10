import { resolveRelationVisualDefaults } from '../../../model/relation-visual-defaults';
import { collectRectBounds } from '../../focus-viewport';
import type { CanvasScene } from '../scene/scene';
import type { CanvasNodeView } from './presentation';

const WIDTH = 160;
const HEIGHT = 64;
const GAP = 40;
const FRAME_PADDING = 100;

/** Context geometry is added after interior layout, so it cannot rearrange focused content. */
export function addFocusContextNodes(scene: CanvasScene, nodes: CanvasNodeView[]) {
  const context = scene.focusContext;
  if (!context) return;
  const bounds = collectRectBounds(nodes.map((node) => node.rect)) ?? {
    minX: 0,
    minY: 0,
    maxX: 280,
    maxY: 120,
  };
  const frame = {
    x: bounds.minX - FRAME_PADDING,
    y: bounds.minY - FRAME_PADDING,
    width: bounds.maxX - bounds.minX + FRAME_PADDING * 2,
    height: bounds.maxY - bounds.minY + FRAME_PADDING * 2,
  };
  const makeNode = (id: string, boundary: boolean): CanvasNodeView => ({
    id,
    kind: boundary ? 'group' : 'entity',
    matched: false,
    rect: frame,
    zIndex: boundary ? 0 : nodes.length + 1,
    opacity: 1,
    contentScale: 1,
    content: {
      label: context.index.entityIndex.byId.get(id)?.name ?? id,
      entityType: boundary ? 'Focus' : 'Outside Focus',
      badges: [],
      listMode: false,
      listProps: [],
      listShowType: true,
      externalContext: !boundary,
      focusBoundary: boundary,
    },
    style: {
      background: boundary ? 'transparent' : 'hsl(0, 0%, var(--node-bg-l, 18%))',
      border: '1px solid hsl(0, 0%, 50%)',
      color: 'var(--node-text)',
      selectionRing: 'hsl(0, 0%, 80%)',
      selectionGlow: 'transparent',
      selectionFill: 'hsla(0, 0%, 80%, 0.1)',
      transparentChrome: false,
      focusShell: boundary,
    },
    controls: {
      targetId: id,
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
    capabilities: { hasChildren: false },
  });
  const boundary = makeNode(context.scopeRootId, true);
  for (const node of nodes) {
    if (!node.parentId) node.parentId = context.scopeRootId;
  }
  nodes.unshift(boundary);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const groups = new Map<string, { sent: number; received: number; ys: number[] }>();
  const relationTypes = new Map(scene.schema.relations.map((type) => [type.id, type]));
  for (const edge of context.edges) {
    const external = edge.external;
    if (!external) continue;
    const group = groups.get(external.displayId) ?? { sent: 0, received: 0, ys: [] };
    const reversed =
      resolveRelationVisualDefaults(edge.type ? relationTypes.get(edge.type) : undefined)
        .flowDirection === 'reverse';
    const sourceId = reversed ? edge.targetId : edge.sourceId;
    const targetId = reversed ? edge.sourceId : edge.targetId;
    const sends = sourceId === external.displayId;
    const inside = byId.get(sends ? targetId : sourceId);
    if (!inside) continue;
    if (sends) group.sent += 1;
    else group.received += 1;
    group.ys.push(inside.rect.y + inside.rect.height / 2);
    groups.set(external.displayId, group);
  }
  const columns = [true, false].map((left) =>
    [...groups.entries()]
      .filter(([, group]) => group.sent >= group.received === left)
      .map(([id, group]) => ({ id, mean: group.ys.reduce((a, b) => a + b, 0) / group.ys.length }))
      .sort((a, b) => a.mean - b.mean || a.id.localeCompare(b.id)),
  );
  columns.forEach((column, index) => {
    let bottom = Number.NEGATIVE_INFINITY;
    for (const item of column) {
      const node = makeNode(item.id, false);
      const y = Math.max(frame.y, item.mean - HEIGHT / 2, bottom + GAP);
      node.rect = {
        x: index === 0 ? frame.x - GAP - WIDTH : frame.x + frame.width + GAP,
        y,
        width: WIDTH,
        height: HEIGHT,
      };
      bottom = y + HEIGHT;
      nodes.push(node);
    }
  });
}
