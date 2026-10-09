import { assignDistributedEdgeAnchors } from './edge-anchors';
import { buildBezierEdgeGeometry, type CanvasEdgeGeometry, type CanvasRect } from './geometry';

export interface RoutingNode {
  id: string;
  parentId?: string;
  kind: 'entity' | 'group';
  rect: CanvasRect;
}
interface RoutingEdge {
  id: string;
  sourceId: string;
  targetId: string;
  label?: string;
  state?: string;
  hideLabel?: boolean;
  geometry: CanvasEdgeGeometry;
}
export const EDGE_LANE_GAP = 8;
export const EDGE_LABEL_HEIGHT = 20;
/** Conservative bounds for the canvas's 10.88px Inter/system font, including 4px padding. */
export const measureEdgeLabel = (label: string) => ({
  width: Math.ceil(
    8 +
      [...label].reduce(
        (sum, ch) =>
          sum +
          (/[ilI.,'!:;|]/.test(ch) ? 4 : /[mwMW@%]/.test(ch) ? 12 : /[A-Z]/.test(ch) ? 10 : 8) +
          0.5,
        0,
      ),
  ),
  height: EDGE_LABEL_HEIGHT,
});
export const edgeLabelRect = (edge: RoutingEdge): CanvasRect => {
  const size =
    edge.label || edge.state !== 'none'
      ? measureEdgeLabel(edge.label || 'set')
      : { width: 6, height: 6 };
  return {
    x: edge.geometry.labelAnchor.x - size.width / 2,
    y: edge.geometry.labelAnchor.y - size.height / 2,
    ...size,
  };
};
export const resolveEntityCards = (nodes: RoutingNode[]) => {
  const expanded = new Set(nodes.map((node) => node.parentId));
  return nodes.filter((node) => node.kind === 'entity' || !expanded.has(node.id));
};
export const rectanglesIntersect = (a: CanvasRect, b: CanvasRect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export const countEdgeIncidents = (edges: { sourceId: string; targetId: string }[]) => {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    counts.set(edge.sourceId, (counts.get(edge.sourceId) ?? 0) + 1);
    counts.set(edge.targetId, (counts.get(edge.targetId) ?? 0) + 1);
  }
  return counts;
};

/** One channel immediately outside each source column at the endpoints' common scope. */
const buildEdgeChannels = <T extends Omit<RoutingEdge, 'geometry'>>(
  nodes: RoutingNode[],
  edges: T[],
  providedIncidentCounts?: ReadonlyMap<string, number>,
) => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incidentCounts = providedIncidentCounts ?? countEdgeIncidents(edges);
  const ancestry = new Map<string, RoutingNode[]>();
  const ancestors = (id: string) => {
    const cached = ancestry.get(id);
    if (cached) return cached;
    const chain: RoutingNode[] = [];
    let node = byId.get(id);
    while (node) {
      chain.push(node);
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }
    chain.reverse();
    ancestry.set(id, chain);
    return chain;
  };
  const routes = edges.flatMap((edge) => {
    const source = byId.get(edge.sourceId),
      target = byId.get(edge.targetId);
    if (!source || !target) return [];
    const a = ancestors(source.id),
      b = ancestors(target.id);
    let level = 0;
    while (level < Math.min(a.length, b.length) - 1 && a[level].id === b[level].id) level++;
    const branch = a[level],
      other = b[level];
    const siblings = nodes.filter((node) => node.parentId === branch.parentId);
    // Dagre centres variable-width siblings in their rank: merge overlapping x extents.
    let left = branch.rect.x,
      right = left + branch.rect.width;
    for (let pass = 0; pass < siblings.length; pass++) {
      const previousLeft = left,
        previousRight = right;
      for (const node of siblings)
        if (node.rect.x < right && node.rect.x + node.rect.width > left) {
          left = Math.min(left, node.rect.x);
          right = Math.max(right, node.rect.x + node.rect.width);
        }
      if (left === previousLeft && right === previousRight) break;
    }
    const direction = other.rect.x + other.rect.width / 2 < (left + right) / 2 ? -1 : 1;
    const boundary = direction === 1 ? right : left;
    return [
      {
        edge,
        source,
        target,
        direction,
        boundary,
        parentId: branch.parentId,
        key: `${branch.parentId ?? ''}:${boundary}:${direction}`,
        sourceSide: direction === 1 ? ('right' as const) : ('left' as const),
        targetSide:
          other.rect.x < right && other.rect.x + other.rect.width > left
            ? direction === 1
              ? ('right' as const)
              : ('left' as const)
            : direction === 1
              ? ('left' as const)
              : ('right' as const),
      },
    ];
  });
  const anchors = assignDistributedEdgeAnchors(
    routes.map((route) => ({
      ...route.edge,
      sourceRect: route.source.rect,
      targetRect: route.target.rect,
      sourceSide: route.sourceSide,
      targetSide: route.targetSide,
    })),
  );
  const channels = new Map<string, typeof routes>();
  for (const route of routes) channels.set(route.key, [...(channels.get(route.key) ?? []), route]);
  const reservations = [...channels.values()].map((channel) => {
    // External relations also consume anchor slots. Budget the maximum labels from each
    // source that can share a 22px band, then combine only vertically overlapping sources.
    const sourceGroups = new Map<string, typeof channel>();
    for (const route of channel)
      sourceGroups.set(route.source.id, [...(sourceGroups.get(route.source.id) ?? []), route]);
    const bands = [...sourceGroups.values()].map((group) => {
      const source = group[0].source;
      const incidentCount = incidentCounts.get(source.id) ?? 0;
      const concurrent = Math.min(
        group.length,
        Math.ceil(
          ((EDGE_LABEL_HEIGHT + 2) * (incidentCount + 1)) / Math.max(1, source.rect.height),
        ),
      );
      const widths = group
        .map((route) => measureEdgeLabel(route.edge.label || 'set').width + 4)
        .sort((a, b) => b - a);
      return {
        y: source.rect.y - EDGE_LABEL_HEIGHT - 2,
        bottom: source.rect.y + source.rect.height,
        width: widths.slice(0, concurrent).reduce((sum, width) => sum + width, 0),
      };
    });
    const labelSpace = Math.max(
      0,
      ...bands.map((band) =>
        bands.reduce(
          (sum, other) => (other.y <= band.y && other.bottom > band.y ? sum + other.width : sum),
          0,
        ),
      ),
    );
    return {
      channel,
      labelSpace,
      parentId: channel[0].parentId,
      boundary: channel[0].boundary,
      direction: channel[0].direction,
      space: labelSpace + 16 + (channel.length - 1) * EDGE_LANE_GAP,
    };
  });
  return { anchors, reservations };
};

export const getRoutingChannelReservations = (
  nodes: RoutingNode[],
  edges: Omit<RoutingEdge, 'geometry'>[],
  incidentCounts?: ReadonlyMap<string, number>,
) => buildEdgeChannels(nodes, edges, incidentCounts).reservations;

export const routeCanvasEdges = <T extends RoutingEdge>(nodes: RoutingNode[], edges: T[]): T[] => {
  const { anchors, reservations } = buildEdgeChannels(nodes, edges);
  const routed = new Map<string, T>();
  const pending: {
    result: T & { labelAnchor: { x: number; y: number } };
    route: (typeof reservations)[number]['channel'][number];
    anchor: NonNullable<ReturnType<typeof anchors.get>>;
    trunkX: number;
  }[] = [];
  const occupied: CanvasRect[] = [];
  const obstacles = resolveEntityCards(nodes).map((node) => node.rect);
  for (const { channel, labelSpace } of reservations.sort((a, b) =>
    a.channel[0].key.localeCompare(b.channel[0].key),
  )) {
    channel.sort(
      (a, b) =>
        a.target.rect.y - b.target.rect.y ||
        a.source.rect.y - b.source.rect.y ||
        a.edge.id.localeCompare(b.edge.id),
    );
    for (const [index, route] of channel.entries()) {
      const anchor = anchors.get(route.edge.id)!;
      const trunkX = route.boundary + route.direction * (labelSpace + 12 + index * EDGE_LANE_GAP);
      const geometry = buildBezierEdgeGeometry({
        sourceRect: route.source.rect,
        targetRect: route.target.rect,
        sourceSide: anchor.sourceSide,
        targetSide: anchor.targetSide,
        sourcePointOverride: anchor.sourcePoint,
        targetPointOverride: anchor.targetPoint,
        trunkX,
      });
      const result = {
        ...route.edge,
        geometry,
        path: geometry.path,
        labelAnchor: geometry.labelAnchor,
      };
      pending.push({ result, route, anchor, trunkX });
    }
  }
  // Short inner legs have fewer placement options than long cross-scope legs.
  pending.sort(
    (a, b) =>
      Math.abs(a.trunkX - a.anchor.sourcePoint.x) - Math.abs(b.trunkX - b.anchor.sourcePoint.x) ||
      a.result.id.localeCompare(b.result.id),
  );
  for (const { result, route, anchor, trunkX } of pending) {
    const geometry = result.geometry;
    const size = edgeLabelRect(result);
    const minX = Math.min(anchor.sourcePoint.x, trunkX) + size.width / 2 + 4;
    const maxX = Math.max(anchor.sourcePoint.x, trunkX) - size.width / 2 - 4;
    const blocked = [...obstacles, ...occupied].filter(
      (rect) =>
        rect.y < anchor.sourcePoint.y + size.height / 2 &&
        rect.y + rect.height > anchor.sourcePoint.y - size.height / 2,
    );
    const candidates = [route.direction === 1 ? minX : maxX];
    for (const obstacle of blocked) {
      candidates.push(
        route.direction === 1
          ? obstacle.x + obstacle.width + size.width / 2 + 2
          : obstacle.x - size.width / 2 - 2,
      );
    }
    candidates.sort((a, b) => route.direction * (a - b));
    for (const x of candidates) {
      if (x < minX || x > maxX) continue;
      const box = { ...size, x: x - size.width / 2, y: anchor.sourcePoint.y - size.height / 2 };
      if (blocked.some((obstacle) => rectanglesIntersect(box, obstacle))) continue;
      geometry.labelAnchor = { x, y: anchor.sourcePoint.y };
      result.labelAnchor = geometry.labelAnchor;
      break;
    }
    if (!result.hideLabel) occupied.push(edgeLabelRect(result));
    routed.set(result.id, result);
  }
  return edges.map((edge) => routed.get(edge.id) ?? edge);
};
