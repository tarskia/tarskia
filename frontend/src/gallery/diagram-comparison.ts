import {
  compileSemanticDiagramDiffUnion,
  type DiagramView,
  diffSemanticDiagramDocuments,
  type Entity,
  type SemanticDiagramDiff,
  type SemanticDiagramDiffNode,
  type SemanticDocument,
} from '@tarskia/diagram-semantics';

export interface DiagramComparison {
  before: SemanticDocument;
  after: SemanticDocument;
  baseCommits?: string[];
}
export interface ChangeTarget {
  kind: 'entity' | 'relation';
  id: string;
  nodeIds: string[];
}
export interface ViewerComparison {
  document: SemanticDocument;
  diff: SemanticDiagramDiff;
  targets: ChangeTarget[];
  initialView: DiagramView;
}

/** Keep the union's tombstones, but project moves only into their after location. */
export function buildViewerComparison({ before, after }: DiagramComparison): ViewerComparison {
  const diff = diffSemanticDiagramDocuments({ before, after });
  const union = compileSemanticDiagramDiffUnion({ before, after, diff });
  const selected = new Map<string, SemanticDiagramDiffNode>();
  for (const node of union.tree.byId.values()) {
    if (node.id === union.tree.rootId) continue;
    const prior = selected.get(node.entity.id);
    if (!prior || node.diff.side !== 'before') selected.set(node.entity.id, node);
  }
  const entities: Entity[] = [...selected.values()].map((node) => {
    const { children: _children, parent: _parent, ...entity } = node.entity;
    const parent =
      node.parentId && node.parentId !== union.tree.rootId
        ? union.tree.byId.get(node.parentId)?.entity.id
        : undefined;
    return { ...entity, ...(parent ? { parent } : {}) };
  });
  const edges = new Map<string, (typeof union.edges)[number]>();
  for (const edge of union.edges) {
    if (!edges.has(edge.relationId) || edge.diff.side !== 'before')
      edges.set(edge.relationId, edge);
  }
  const relations = [...edges.values()].map((edge) => ({ ...edge.relation }));
  const targets: ChangeTarget[] = [];
  const seenNodes = new Set<string>();
  for (const id of union.pointsOfInterest.nodeIds) {
    const node = union.tree.byId.get(id);
    if (node && !seenNodes.has(node.entity.id)) {
      seenNodes.add(node.entity.id);
      targets.push({ kind: 'entity', id: node.entity.id, nodeIds: [node.entity.id] });
    }
  }
  const seenEdges = new Set<string>();
  for (const id of union.pointsOfInterest.edgeIds) {
    const edge = union.edges.find((candidate) => candidate.id === id);
    if (!edge || seenEdges.has(edge.relationId)) continue;
    const chosen = edges.get(edge.relationId)!;
    seenEdges.add(edge.relationId);
    targets.push({
      kind: 'relation',
      id: edge.relationId,
      nodeIds: [chosen.relation.from, chosen.relation.to],
    });
  }
  const nodesById = { ...after.view?.nodesById };
  const parents = new Map(entities.map((entity) => [entity.id, entity.parent]));
  for (const target of targets)
    for (const id of target.nodeIds) {
      let parent = parents.get(id);
      const seen = new Set<string>();
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        nodesById[parent] = { ...nodesById[parent], expanded: true };
        parent = parents.get(parent);
      }
    }
  const initialView: DiagramView = {
    ...after.view,
    kind: 'semantic-diagram-view',
    version: 3,
    nodesById,
  };
  // A saved scope/camera can hide newly removed items or changes outside that scope.
  delete initialView.scopeRootId;
  delete initialView.camera;
  return {
    document: { ...after, entities, relations, view: initialView },
    diff,
    targets,
    initialView,
  };
}

export async function isCurrentComparison(
  raw: string,
  metadata: string,
): Promise<string | undefined> {
  try {
    const value = JSON.parse(metadata) as { baseCommit?: unknown; afterSha256?: unknown };
    if (typeof value.baseCommit !== 'string' || typeof value.afterSha256 !== 'string') return;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    return hash === value.afterSha256 ? value.baseCommit : undefined;
  } catch {
    return;
  }
}

export function nextChangeIndex(current: number, direction: number, count: number): number {
  if (!count) return -1;
  if (current < 0) return direction < 0 ? count - 1 : 0;
  return (current + direction + count) % count;
}
