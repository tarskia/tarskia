import type { Diagnostic, DocumentInput, SemanticDocument } from '../semantic';
import {
  diagramDiagnostic,
  STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
  sortDiagnostics,
  validateDocument,
} from '../semantic';
import {
  buildFlowBuildState,
  buildFlowExpectationsFromEdgeProposals,
  buildFlowRepairDiagnostics,
} from './flow-build-state';
import {
  evaluateNodeRefinementCandidate,
  type NodeRefinementSchemaContext,
} from './node-refinement-engine';
import { isGroupLikeType } from './refinement-helpers';
import type { NodeRefinementResult, NodeRefinementState, NodeRefinementTask } from './types';

const INTERMEDIATE_NODE_REFINEMENT_VALIDATION_OPTIONS = {
  ...STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
  structure: {
    ...STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS.structure,
    requireChildrenForGroupLikeEntities: false,
  },
};

function collectQueuedExpandableGroupIds(params: {
  state: NodeRefinementState;
  semantics: NodeRefinementSchemaContext['semantics'];
}): Set<string> {
  const queuedNodeIds = new Set(params.state.queue.map((task) => task.nodeId));
  return new Set(
    Object.values(params.state.nodesById)
      .filter(
        (node) =>
          queuedNodeIds.has(node.id) &&
          node.queueDecision === 'expand' &&
          isGroupLikeType(params.semantics, node.typeId),
      )
      .map((node) => node.id),
  );
}

function collectIntermediateGroupDiagnostics(params: {
  assembledDoc: SemanticDocument;
  state: NodeRefinementState;
  semantics: NodeRefinementSchemaContext['semantics'];
}): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const queuedExpandableGroupIds = collectQueuedExpandableGroupIds({
    state: params.state,
    semantics: params.semantics,
  });

  const visit = (entities: SemanticDocument['entities']) => {
    for (const entity of entities) {
      if (
        isGroupLikeType(params.semantics, entity.type) &&
        (entity.children?.length ?? 0) === 0 &&
        !queuedExpandableGroupIds.has(entity.id)
      ) {
        diagnostics.push(
          diagramDiagnostic({
            phase: 'document',
            severity: 'error',
            code: 'diagram.document.group_like_entity_missing_children',
            entityId: entity.id,
            message: `Group-like entity ${entity.id} has no children; use a concrete boundary or add contained entities`,
          }),
        );
      }
      visit(entity.children ?? []);
    }
  };

  visit(params.assembledDoc.entities);
  return diagnostics;
}

export function validateIntermediateRefinedState(params: {
  state: NodeRefinementState;
  assembledDoc: SemanticDocument;
  schemaContext: Pick<NodeRefinementSchemaContext, 'schema' | 'semantics'>;
  primaryDocumentInput: DocumentInput;
}): Diagnostic[] {
  const validationDiagnostics = validateDocument(
    {
      ...params.assembledDoc,
      inputs: [params.primaryDocumentInput],
    },
    params.schemaContext.schema,
    INTERMEDIATE_NODE_REFINEMENT_VALIDATION_OPTIONS,
  );
  const groupDiagnostics = collectIntermediateGroupDiagnostics({
    assembledDoc: params.assembledDoc,
    state: params.state,
    semantics: params.schemaContext.semantics,
  });
  const analyzedState = buildFlowBuildState({
    level0Doc: params.assembledDoc,
    effectiveSchema: params.schemaContext.schema,
    repoOwnedResponsibilityIds: params.state.rootNodeIds,
    expectations: buildFlowExpectationsFromEdgeProposals({
      doc: params.assembledDoc,
      activeEdgeProposals: params.state.activeEdgeProposals,
    }),
  });
  const flowDiagnostics = buildFlowRepairDiagnostics({
    flowBuildState: analyzedState.state,
    analysis: analyzedState.analysis,
    effectiveSchema: params.schemaContext.schema,
  });
  return sortDiagnostics([...validationDiagnostics, ...groupDiagnostics, ...flowDiagnostics]);
}

export interface NodeRefinementDiagnosticBuckets {
  diagnostics: Diagnostic[];
  hardDiagnostics: Diagnostic[];
  softDiagnostics: Diagnostic[];
}

export interface NodeRefinementValidationResult extends NodeRefinementDiagnosticBuckets {
  assembledDoc: SemanticDocument;
  nextState: NodeRefinementState;
}

export function splitNodeRefinementDiagnostics(
  diagnostics: Diagnostic[],
): NodeRefinementDiagnosticBuckets {
  const hardDiagnostics = sortDiagnostics(
    diagnostics.filter(
      (diagnostic) =>
        diagnostic.severity === 'error' && !diagnostic.code.startsWith('diagram.flow.'),
    ),
  );
  const softDiagnostics = sortDiagnostics(
    diagnostics.filter(
      (diagnostic) =>
        diagnostic.severity !== 'error' || diagnostic.code.startsWith('diagram.flow.'),
    ),
  );
  return {
    diagnostics: sortDiagnostics(diagnostics),
    hardDiagnostics,
    softDiagnostics,
  };
}

export async function validateAppliedNodeRefinement(params: {
  state: NodeRefinementState;
  task: NodeRefinementTask;
  result: NodeRefinementResult;
  baseDoc: SemanticDocument;
  schemaContext: Pick<NodeRefinementSchemaContext, 'activeSchemaRefs' | 'schema' | 'semantics'>;
  primaryDocumentInput: DocumentInput;
  baselineDiagnosticFingerprints?: string[];
}): Promise<NodeRefinementValidationResult> {
  const evaluation = await evaluateNodeRefinementCandidate({
    ...params,
    validateAppliedState: (state, assembledDoc) =>
      validateIntermediateRefinedState({
        state,
        assembledDoc,
        schemaContext: params.schemaContext,
        primaryDocumentInput: params.primaryDocumentInput,
      }),
  });
  return {
    assembledDoc: evaluation.assembledDoc,
    nextState: evaluation.nextState,
    ...splitNodeRefinementDiagnostics(evaluation.diagnostics),
  };
}
