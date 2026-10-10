import type { AreaPlanEvidence, ChildNodeSpec, NodeRefinementTask } from '../types';

export function findOverlappingContextPath(
  leftPaths: string[],
  rightPaths: string[],
): string | undefined {
  for (const left of leftPaths) {
    for (const right of rightPaths) {
      if (left === right) {
        return left;
      }
      if (left.startsWith(`${right}/`)) {
        return right;
      }
      if (right.startsWith(`${left}/`)) {
        return left;
      }
    }
  }
  return undefined;
}

export function normalizeEvidencePath(path: string): string {
  return path.trim().replace(/^\.\//, '').replace(/\/+$/, '');
}

export function isSpecificEvidencePath(path: string): boolean {
  const normalized = normalizeEvidencePath(path);
  return (
    normalized.length > 0 &&
    normalized !== '.' &&
    (normalized.includes('/') || /[^/]+\.[^/]+$/.test(normalized))
  );
}

export function collectSpecificEvidencePaths(input: {
  scope?: string[];
  evidence?: AreaPlanEvidence[];
}): string[] {
  return [
    ...new Set(
      [...(input.scope ?? []), ...(input.evidence ?? []).map((item) => item.path)]
        .map((path) => normalizeEvidencePath(path))
        .filter(isSpecificEvidencePath),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

export interface SuggestedFlowEdgeRefinement {
  edgeId: string;
  endpoint: 'from' | 'to';
  childLocalId: string;
  fromChildLocalId?: string;
  toChildLocalId?: string;
  relationTypeId?: string;
  validRelationTypeIds?: string[];
  matchingPath: string;
  reason: string;
}

export function buildEvidenceMatchedFlowEdgeRefinements(params: {
  task: Pick<NodeRefinementTask, 'inboundEdges' | 'outboundEdges'>;
  child: ChildNodeSpec;
}): SuggestedFlowEdgeRefinement[] {
  const childPaths = collectSpecificEvidencePaths(params.child);
  if (childPaths.length === 0) {
    return [];
  }

  const suggestions: SuggestedFlowEdgeRefinement[] = [];
  for (const edge of params.task.inboundEdges) {
    const matchingPath = findOverlappingContextPath(
      childPaths,
      collectSpecificEvidencePaths({ evidence: edge.evidence }),
    );
    if (!matchingPath) {
      continue;
    }
    suggestions.push({
      edgeId: edge.id,
      endpoint: 'to',
      childLocalId: params.child.localId,
      relationTypeId: edge.relationTypeId,
      matchingPath,
      reason: `child evidence overlaps inherited inbound edge evidence at ${matchingPath}`,
    });
  }

  for (const edge of params.task.outboundEdges) {
    const matchingPath = findOverlappingContextPath(
      childPaths,
      collectSpecificEvidencePaths({ evidence: edge.evidence }),
    );
    if (!matchingPath) {
      continue;
    }
    suggestions.push({
      edgeId: edge.id,
      endpoint: 'from',
      childLocalId: params.child.localId,
      relationTypeId: edge.relationTypeId,
      matchingPath,
      reason: `child evidence overlaps inherited outbound edge evidence at ${matchingPath}`,
    });
  }

  return suggestions.sort((left, right) => {
    const leftKey = `${left.endpoint}:${left.edgeId}:${left.matchingPath}`;
    const rightKey = `${right.endpoint}:${right.edgeId}:${right.matchingPath}`;
    return leftKey.localeCompare(rightKey);
  });
}
