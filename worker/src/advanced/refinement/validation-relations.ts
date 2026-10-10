import {
  diagramDiagnostic,
  getAllowedChildTypeIds,
  getAllowedRelationTypeIds,
} from '../../semantic';
import { buildNodeRefinementEdgeHandles } from '../node-refinement-edge-handles';
import { matchInheritedEdge } from './edge-orientation';
import type { createValidationContext } from './validation-context';

export function validateLocalRelations(context: ReturnType<typeof createValidationContext>): void {
  const { params, diagnostics, childByLocalId } = context;

  for (const relation of params.result.relations) {
    const fromChild = childByLocalId.get(relation.fromLocalId);
    const toChild = childByLocalId.get(relation.toLocalId);
    if (Boolean(fromChild) !== Boolean(toChild)) {
      const { candidates } = fromChild
        ? matchInheritedEdge(
            params.task.outboundEdges,
            relation.toLocalId,
            'targetId',
            relation.typeId,
          )
        : matchInheritedEdge(
            params.task.inboundEdges,
            relation.fromLocalId,
            'sourceId',
            relation.typeId,
          );
      if (candidates.length > 1) {
        const ids = new Set(candidates.map((edge) => edge.id));
        const candidateHandles = Object.entries(buildNodeRefinementEdgeHandles(params.task))
          .filter(([, id]) => ids.has(id))
          .map(([handle]) => handle);
        diagnostics.push(
          diagramDiagnostic({
            phase: 'document',
            severity: 'error',
            code: 'diagram.node_refinement.ambiguous_inherited_edge',
            entityId: params.task.nodeId,
            relationId: relation.localId,
            message: `Relation ${relation.localId} matches several inherited edges (${candidateHandles.join(', ')}). Replace this cross-boundary relation with an explicit edgeRefinement using the intended handle.`,
            details: { candidateHandles },
          }),
        );
        continue;
      }
    }
    if (!fromChild || !toChild) {
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.relation_missing_child_endpoint',
          entityId: params.task.nodeId,
          relationId: relation.localId,
          message: `Relation ${relation.localId} references missing child endpoints`,
        }),
      );
      continue;
    }
    const validRelationTypeIds = getAllowedRelationTypeIds({
      schema: params.schema,
      semantics: params.semantics,
      fromTypeId: fromChild.typeId,
      toTypeId: toChild.typeId,
    });
    const fromAllowedChildTypeIds = getAllowedChildTypeIds({
      schema: params.schema,
      parentTypeId: fromChild.typeId,
      schemaActivations: params.schemaActivations,
    });
    const toAllowedChildTypeIds = getAllowedChildTypeIds({
      schema: params.schema,
      parentTypeId: toChild.typeId,
      schemaActivations: params.schemaActivations,
    });
    const fromCanContainTo = fromAllowedChildTypeIds.includes(toChild.typeId);
    const toCanContainFrom = toAllowedChildTypeIds.includes(fromChild.typeId);
    const preferredContainmentOwner =
      fromCanContainTo && fromChild.queueDecision === 'expand'
        ? {
            ownerLocalId: fromChild.localId,
            ownerTypeId: fromChild.typeId,
            childLocalId: toChild.localId,
            childTypeId: toChild.typeId,
          }
        : toCanContainFrom && toChild.queueDecision === 'expand'
          ? {
              ownerLocalId: toChild.localId,
              ownerTypeId: toChild.typeId,
              childLocalId: fromChild.localId,
              childTypeId: fromChild.typeId,
            }
          : fromCanContainTo
            ? {
                ownerLocalId: fromChild.localId,
                ownerTypeId: fromChild.typeId,
                childLocalId: toChild.localId,
                childTypeId: toChild.typeId,
              }
            : toCanContainFrom
              ? {
                  ownerLocalId: toChild.localId,
                  ownerTypeId: toChild.typeId,
                  childLocalId: fromChild.localId,
                  childTypeId: fromChild.typeId,
                }
              : null;
    if (!validRelationTypeIds.includes(relation.typeId)) {
      const containmentSuffix = preferredContainmentOwner
        ? ` ${preferredContainmentOwner.ownerLocalId} should usually contain ${preferredContainmentOwner.childLocalId} in a later refinement instead of relating to it as a sibling.`
        : '';
      const remedy = preferredContainmentOwner
        ? {
            kind: 'containment' as const,
            ownerLocalId: preferredContainmentOwner.ownerLocalId,
            ownerTypeId: preferredContainmentOwner.ownerTypeId,
            childLocalId: preferredContainmentOwner.childLocalId,
            childTypeId: preferredContainmentOwner.childTypeId,
            deferToChildRefinement: true,
          }
        : null;
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.invalid_relation_type',
          entityId: params.task.nodeId,
          relationId: relation.localId,
          message: `Relation ${relation.localId} uses invalid type ${relation.typeId} for ${fromChild.typeId} -> ${toChild.typeId}.${containmentSuffix}`,
          details: {
            relationAnalysis: {
              fromRef: relation.fromLocalId,
              fromType: fromChild.typeId,
              toRef: relation.toLocalId,
              toType: toChild.typeId,
              selectedType: relation.typeId,
              validRelationTypes: validRelationTypeIds,
              requiresEndpointChange: validRelationTypeIds.length === 0,
              preferredContainmentOwner,
              remedy,
            },
          },
        }),
      );
    }
  }
}
