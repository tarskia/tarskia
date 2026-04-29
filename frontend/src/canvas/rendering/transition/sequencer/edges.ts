import type { CompiledDiagramEdge } from '../../../../semantic';
import type {
  SequencedTransitionAdvisory,
  StructuralEdgeDiff,
  StructuralNodeAdvisory,
} from './types';

const getEdgeKey = (edge: CompiledDiagramEdge) => edge.id;

const getFadeStepId = (
  advisories: Map<string, StructuralNodeAdvisory>,
  id: string,
  mode: 'in' | 'out',
) => {
  const advisory = advisories.get(id);
  if (!advisory?.fadeStepId || advisory.fadeMode !== mode) {
    return undefined;
  }
  return advisory.fadeStepId;
};

export function buildStructuralEdgeDiffs(params: {
  fromEdges: CompiledDiagramEdge[];
  toEdges: CompiledDiagramEdge[];
}): StructuralEdgeDiff[] {
  const { fromEdges, toEdges } = params;
  const diffs: StructuralEdgeDiff[] = [];
  const fromByRelationId = new Map(fromEdges.map((edge) => [edge.relationId, edge]));
  const toByRelationId = new Map(toEdges.map((edge) => [edge.relationId, edge]));
  const allRelationIds = new Set<string>([...fromByRelationId.keys(), ...toByRelationId.keys()]);

  for (const relationId of allRelationIds) {
    const oldEdge = fromByRelationId.get(relationId) ?? null;
    const newEdge = toByRelationId.get(relationId) ?? null;
    const stableEdge = newEdge ?? oldEdge;
    if (!stableEdge) continue;

    if (
      oldEdge &&
      newEdge &&
      getEdgeKey(oldEdge) === getEdgeKey(newEdge) &&
      oldEdge.sourceId === newEdge.sourceId &&
      oldEdge.targetId === newEdge.targetId
    ) {
      diffs.push({
        ...stableEdge,
        correspondence: 'stable',
      });
      continue;
    }

    if (oldEdge && newEdge && getEdgeKey(oldEdge) === getEdgeKey(newEdge)) {
      const disappearingEndpointIds: string[] = [];
      if (oldEdge.sourceId !== newEdge.sourceId) {
        disappearingEndpointIds.push(oldEdge.sourceId);
      }
      if (oldEdge.targetId !== newEdge.targetId) {
        disappearingEndpointIds.push(oldEdge.targetId);
      }

      const appearingEndpointIds: string[] = [];
      if (oldEdge.sourceId !== newEdge.sourceId) {
        appearingEndpointIds.push(newEdge.sourceId);
      }
      if (oldEdge.targetId !== newEdge.targetId) {
        appearingEndpointIds.push(newEdge.targetId);
      }

      diffs.push({
        ...newEdge,
        correspondence: 'reroute',
        appearingEndpointIds: appearingEndpointIds.length > 0 ? appearingEndpointIds : undefined,
        disappearingEndpointIds:
          disappearingEndpointIds.length > 0 ? disappearingEndpointIds : undefined,
      });
      continue;
    }

    const disappearingEndpointIds: string[] = [];
    if (oldEdge) {
      if (!newEdge || oldEdge.sourceId !== newEdge.sourceId) {
        disappearingEndpointIds.push(oldEdge.sourceId);
      }
      if (!newEdge || oldEdge.targetId !== newEdge.targetId) {
        disappearingEndpointIds.push(oldEdge.targetId);
      }
    }

    const appearingEndpointIds: string[] = [];
    if (newEdge) {
      if (!oldEdge || oldEdge.sourceId !== newEdge.sourceId) {
        appearingEndpointIds.push(newEdge.sourceId);
      }
      if (!oldEdge || oldEdge.targetId !== newEdge.targetId) {
        appearingEndpointIds.push(newEdge.targetId);
      }
    }

    if (oldEdge) {
      diffs.push({
        ...oldEdge,
        correspondence: newEdge ? 'reroute' : 'exit',
        hideAtStart: true,
        disappearingEndpointIds:
          disappearingEndpointIds.length > 0 ? disappearingEndpointIds : undefined,
      });
    }

    if (newEdge) {
      diffs.push({
        ...newEdge,
        correspondence: oldEdge ? 'reroute' : 'enter',
        appearingEndpointIds: appearingEndpointIds.length > 0 ? appearingEndpointIds : undefined,
        disappearingEndpointIds:
          oldEdge && disappearingEndpointIds.length > 0 ? disappearingEndpointIds : undefined,
      });
    }
  }

  return diffs;
}

export function buildEdgeSequenceAdvisories(params: {
  edgeDiffs: StructuralEdgeDiff[];
  nodeAdvisories: Map<string, StructuralNodeAdvisory>;
}): SequencedTransitionAdvisory['edgeAdvisories'] {
  const { edgeDiffs, nodeAdvisories } = params;
  const advisories = new Map<
    string,
    SequencedTransitionAdvisory['edgeAdvisories'] extends Map<string, infer TValue> ? TValue : never
  >();

  for (const edgeDiff of edgeDiffs) {
    const disappearingEndpoints = edgeDiff.disappearingEndpointIds ?? [];
    const appearingEndpoints = edgeDiff.appearingEndpointIds ?? [];
    const fadeOutStepIds = disappearingEndpoints
      .map((id) => getFadeStepId(nodeAdvisories, id, 'out'))
      .filter((stepId): stepId is string => Boolean(stepId));
    const fadeInStepIds = appearingEndpoints
      .map((id) => getFadeStepId(nodeAdvisories, id, 'in'))
      .filter((stepId): stepId is string => Boolean(stepId));

    if (edgeDiff.correspondence === 'exit' || edgeDiff.correspondence === 'reroute') {
      advisories.set(edgeDiff.id, {
        id: edgeDiff.id,
        fadeMode: fadeOutStepIds.length > 0 ? 'out' : undefined,
        fadeEndpointIds: fadeOutStepIds.length > 0 ? disappearingEndpoints : undefined,
      });
      continue;
    }

    if (edgeDiff.correspondence === 'enter') {
      advisories.set(edgeDiff.id, {
        id: edgeDiff.id,
        fadeMode: 'in',
        fadeEndpointIds: appearingEndpoints.length > 0 ? appearingEndpoints : undefined,
      });
    }
  }

  for (const edgeDiff of edgeDiffs) {
    if (edgeDiff.correspondence !== 'reroute') {
      continue;
    }
    const disappearingEndpoints = edgeDiff.disappearingEndpointIds ?? [];
    const appearingEndpoints = edgeDiff.appearingEndpointIds ?? [];
    if (appearingEndpoints.length === 0) {
      continue;
    }
    const fadeInStepIds = appearingEndpoints
      .map((id) => getFadeStepId(nodeAdvisories, id, 'in'))
      .filter((stepId): stepId is string => Boolean(stepId));
    const incomingFadeEndpointIds =
      fadeInStepIds.length > 0
        ? appearingEndpoints
        : disappearingEndpoints.length > 0
          ? disappearingEndpoints
          : undefined;
    advisories.set(edgeDiff.id, {
      id: edgeDiff.id,
      fadeMode: 'in',
      fadeEndpointIds: incomingFadeEndpointIds,
    });
  }

  return advisories;
}
