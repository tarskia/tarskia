import dagre from 'dagre';

export type LayoutNode = {
  id: string;
  width: number;
  height: number;
};

export type LayoutEdge = {
  source: string;
  target: string;
};

export type LayoutResult = Record<string, { x: number; y: number }>;

export function layoutGraphWithDagre(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options?: { direction?: 'LR' | 'TB'; nodeSep?: number; rankSep?: number },
): LayoutResult {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: options?.direction ?? 'LR',
    nodesep: options?.nodeSep ?? 60,
    ranksep: options?.rankSep ?? 80,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: node.width, height: node.height });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const positions: LayoutResult = {};
  for (const node of nodes) {
    const layoutNode = g.node(node.id);
    positions[node.id] = {
      x: layoutNode.x - node.width / 2,
      y: layoutNode.y - node.height / 2,
    };
  }

  return positions;
}

// Degenerate, looped and cyclic graphs retain Dagre's routing/ranking behavior.
export function layoutGraph(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options?: { direction?: 'LR' | 'TB'; nodeSep?: number; rankSep?: number },
): LayoutResult {
  if (nodes.length === 1 && edges.length === 0) return { [nodes[0].id]: { x: 0, y: 0 } };
  if (
    nodes.length === 2 &&
    edges.length <= 1 &&
    edges.every(
      (edge) =>
        edge.source !== edge.target &&
        nodes.some((node) => node.id === edge.source) &&
        nodes.some((node) => node.id === edge.target),
    )
  ) {
    const [first, second] =
      edges.length && edges[0].source === nodes[1].id ? [nodes[1], nodes[0]] : nodes;
    const horizontal = options?.direction !== 'TB';
    const connected = edges.length > 0;
    const alongX = horizontal === connected;
    const separation = connected ? (options?.rankSep ?? 80) : (options?.nodeSep ?? 60);
    const crossSize = Math.max(
      alongX ? first.height : first.width,
      alongX ? second.height : second.width,
    );
    return {
      [first.id]: alongX
        ? { x: 0, y: (crossSize - first.height) / 2 }
        : { x: (crossSize - first.width) / 2, y: 0 },
      [second.id]: alongX
        ? { x: first.width + separation, y: (crossSize - second.height) / 2 }
        : { x: (crossSize - second.width) / 2, y: first.height + separation },
    };
  }
  return layoutGraphWithDagre(nodes, edges, options);
}
