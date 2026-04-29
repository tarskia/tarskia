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

export function layoutGraph(
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
