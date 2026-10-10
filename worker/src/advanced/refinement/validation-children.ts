import { diagramDiagnostic } from '../../semantic';
import { isGroupLikeType } from '../refinement-helpers';
import { NODE_REFINEMENT_SOFT_LIMITS } from '../types';
import { buildEvidenceMatchedFlowEdgeRefinements } from './evidence';
import type { createValidationContext } from './validation-context';

export function validateChildren(context: ReturnType<typeof createValidationContext>): void {
  const {
    params,
    diagnostics,
    allowedChildTypeIds,
    getTypeLayer,
    parentLayer,
    flowRelevantChildIds,
    taskIsGroupLike,
  } = context;

  if (taskIsGroupLike && params.result.children.length === 0) {
    diagnostics.push(
      diagramDiagnostic({
        phase: 'document',
        severity: 'warning',
        code: 'diagram.node_refinement.empty_group',
        entityId: params.task.nodeId,
        message: `Grouping node ${params.task.nodeId} emitted no children; prefer a concrete boundary or drop the empty wrapper`,
      }),
    );
  }

  if (taskIsGroupLike && params.result.children.length === 1) {
    diagnostics.push(
      diagramDiagnostic({
        phase: 'document',
        severity: 'warning',
        code: 'diagram.node_refinement.single_child_group',
        entityId: params.task.nodeId,
        message: `Grouping node ${params.task.nodeId} emitted only one child; collapse the wrapper unless it adds distinct architectural meaning`,
      }),
    );
  }

  if (params.result.children.length > NODE_REFINEMENT_SOFT_LIMITS.maxChildrenPerNode) {
    diagnostics.push(
      diagramDiagnostic({
        phase: 'document',
        severity: 'warning',
        code: 'diagram.node_refinement.child_count_soft_cap_exceeded',
        entityId: params.task.nodeId,
        message: `${params.task.nodeId} emitted ${params.result.children.length} children; prefer grouping or pruning low-value detail`,
      }),
    );
  }

  const expandChildren = params.result.children.filter((child) => child.queueDecision === 'expand');
  if (expandChildren.length > NODE_REFINEMENT_SOFT_LIMITS.maxExpandableChildrenPerNode) {
    diagnostics.push(
      diagramDiagnostic({
        phase: 'document',
        severity: 'warning',
        code: 'diagram.node_refinement.expand_count_soft_cap_exceeded',
        entityId: params.task.nodeId,
        message: `${params.task.nodeId} emitted ${expandChildren.length} expandable children; prefer grouping or leaf children for lower-value detail`,
      }),
    );
  }

  for (const child of params.result.children) {
    if (!allowedChildTypeIds.has(child.typeId)) {
      const childLayer = getTypeLayer(child.typeId);
      const suggestedAllowedChildTypeIds = [...allowedChildTypeIds]
        .filter((typeId) => {
          const layer = getTypeLayer(typeId);
          if (parentLayer === undefined || layer === undefined) {
            return true;
          }
          return layer >= parentLayer;
        })
        .sort((left, right) => left.localeCompare(right));
      const isOutwardLayerRegression =
        parentLayer !== undefined && childLayer !== undefined && childLayer < parentLayer;
      const layerSuffix = isOutwardLayerRegression
        ? ` ${child.typeId} is layer ${childLayer}, but ${params.task.nodeTypeId} is layer ${parentLayer}; containment cannot move outward to a lower layer. Keep this child in layer ${parentLayer} or move this runtime/grouping boundary back to an outer parent.`
        : '';
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.invalid_child_type',
          entityId: params.task.nodeId,
          targetId: child.typeId,
          message: `Child ${child.localId} (${child.typeId}) is not allowed under ${params.task.nodeTypeId}.${layerSuffix}`,
          hint:
            suggestedAllowedChildTypeIds.length > 0
              ? `Choose an allowed child type such as ${suggestedAllowedChildTypeIds.slice(0, 5).join(', ')}.`
              : undefined,
          details: {
            parentTypeId: params.task.nodeTypeId,
            parentLayer,
            childTypeId: child.typeId,
            childLayer,
            allowedChildTypeIds: [...allowedChildTypeIds].sort((left, right) =>
              left.localeCompare(right),
            ),
            suggestedAllowedChildTypeIds,
            remedy: isOutwardLayerRegression
              ? {
                  kind: 'stay_same_layer_or_move_to_outer_parent',
                  childLayer,
                  parentLayer,
                }
              : undefined,
          },
        }),
      );
    }
    if (isGroupLikeType(params.semantics, child.typeId) && child.queueDecision === 'leaf') {
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.leaf_group_child',
          entityId: params.task.nodeId,
          targetId: child.localId,
          message: `Group child ${child.localId} is marked leaf and will become an empty wrapper; expand it or replace it with a concrete child`,
        }),
      );
    }
    if (isGroupLikeType(params.semantics, child.typeId)) {
      const mode = child.groupMode ?? 'mixed';
      if (mode === 'typed' && !child.groupTypeId) {
        diagnostics.push(
          diagramDiagnostic({
            phase: 'document',
            severity: 'error',
            code: 'diagram.node_refinement.typed_group_missing_group_type',
            entityId: params.task.nodeId,
            targetId: child.localId,
            message: `Typed group ${child.localId} is missing groupTypeId`,
          }),
        );
      }
      if (mode !== 'typed' && child.groupTypeId) {
        diagnostics.push(
          diagramDiagnostic({
            phase: 'document',
            severity: 'error',
            code: 'diagram.node_refinement.mixed_group_with_group_type',
            entityId: params.task.nodeId,
            targetId: child.localId,
            message: `Mixed group ${child.localId} must not declare groupTypeId`,
          }),
        );
      }
    } else if (child.groupMode || child.groupTypeId) {
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.node_refinement.non_group_with_group_metadata',
          entityId: params.task.nodeId,
          targetId: child.localId,
          message: `Non-group child ${child.localId} cannot declare group metadata`,
        }),
      );
    }
    if (child.queueDecision === 'expand' && !flowRelevantChildIds.has(child.localId)) {
      const isDisconnectedGroup = isGroupLikeType(params.semantics, child.typeId);
      const suggestedEdgeRefinements = buildEvidenceMatchedFlowEdgeRefinements({
        task: params.task,
        child,
      });
      diagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: isDisconnectedGroup ? 'error' : 'warning',
          code: 'diagram.node_refinement.expand_child_not_flow_justified',
          entityId: params.task.nodeId,
          targetId: child.localId,
          message: isDisconnectedGroup
            ? `Expandable group child ${child.localId} is not connected to the node's inherited or local flow`
            : `Expandable child ${child.localId} is not connected to the node's inherited or local flow`,
          hint:
            suggestedEdgeRefinements.length > 0
              ? 'Use one of the suggested edgeRefinements when this child is a real carrier of the inherited flow; otherwise downgrade, collapse, or remove it.'
              : 'Connect this child with a local relation, inherited edge refinement, or edge proposal; otherwise downgrade, collapse, or remove it.',
          details: {
            suggestedEdgeRefinements,
          },
        }),
      );
    }
  }

  if (params.task.groupMode === 'typed' && params.task.groupTypeId) {
    for (const child of params.result.children) {
      if (isGroupLikeType(params.semantics, child.typeId)) {
        continue;
      }
      if (child.typeId !== params.task.groupTypeId) {
        diagnostics.push(
          diagramDiagnostic({
            phase: 'document',
            severity: 'error',
            code: 'diagram.node_refinement.typed_group_child_mismatch',
            entityId: params.task.nodeId,
            targetId: child.localId,
            message: `Typed group ${params.task.nodeId} may contain only ${params.task.groupTypeId} children`,
          }),
        );
      }
    }
  }
}
