import type { CompiledDiagramEdge, SchemaModule } from '@tarskia/diagram-semantics';
import { resolveRelationVisualDefaults } from '../../../model/relation-visual-defaults';
import { type DirectionalEdgeLabel, joinDirectionalLabels } from './edge-labels';

export interface ResolvedVisualEdge extends CompiledDiagramEdge {
  semanticSourceId: string;
  semanticTargetId: string;
  relationIds?: string[];
  directionalLabels?: DirectionalEdgeLabel[];
}

export function buildEdgeVisuals(params: {
  schema: SchemaModule;
  edges: CompiledDiagramEdge[];
}): ResolvedVisualEdge[] {
  const { schema, edges } = params;
  const relationTypeById = new Map(schema.relations.map((relation) => [relation.id, relation]));
  const candidates = edges.map((edge, order) => {
    const relationType = edge.type ? relationTypeById.get(edge.type) : undefined;
    const flowDirection = resolveRelationVisualDefaults(relationType).flowDirection;
    const reversed = flowDirection === 'reverse';

    return {
      ...edge,
      semanticSourceId: edge.semanticSourceId ?? edge.sourceId,
      semanticTargetId: edge.semanticTargetId ?? edge.targetId,
      sourceId: reversed ? edge.targetId : edge.sourceId,
      targetId: reversed ? edge.sourceId : edge.targetId,
      relationIds: [edge.relationId],
      _priority: relationType?.priority ?? Number.POSITIVE_INFINITY,
      _order: order,
    };
  });

  const groupedByVisibleEndpoints = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const key = JSON.stringify([candidate.sourceId, candidate.targetId].sort());
    const group = groupedByVisibleEndpoints.get(key) ?? [];
    group.push(candidate);
    groupedByVisibleEndpoints.set(key, group);
  }

  return [...groupedByVisibleEndpoints.values()].map((group) => {
    group.sort((left, right) => {
      if (left._priority !== right._priority) {
        return left._priority - right._priority;
      }
      if (left.relationId !== right.relationId) {
        return left.relationId.localeCompare(right.relationId);
      }
      return left._order - right._order;
    });
    const primary = group[0];
    if (!primary) {
      throw new Error('Expected at least one edge candidate in group');
    }
    const reverse = group.find(
      (candidate) =>
        candidate.sourceId !== primary.sourceId || candidate.targetId !== primary.targetId,
    );
    const directionalLabels = reverse
      ? [primary, reverse].map((candidate) => ({
          sourceId: candidate.sourceId,
          targetId: candidate.targetId,
          relationId: candidate.relationId,
          label: candidate.state === 'none' ? undefined : candidate.label?.trim() || undefined,
        }))
      : undefined;
    const { _priority, _order, ...resolvedPrimary } = primary;
    void _priority;
    void _order;
    return {
      ...resolvedPrimary,
      relationIds: [...new Set(group.map((candidate) => candidate.relationId))],
      ...(directionalLabels
        ? { directionalLabels, label: joinDirectionalLabels(directionalLabels) }
        : {}),
      solidOverNodeIds: [
        ...new Set(group.flatMap((candidate) => candidate.solidOverNodeIds ?? [])),
      ],
    };
  });
}
