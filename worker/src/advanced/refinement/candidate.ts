import type { Logger } from '../../logger';
import {
  type Diagnostic,
  diagnosticFingerprint,
  type SemanticDocument,
  sortDiagnostics,
} from '../../semantic';
import type { NodeRefinementResult, NodeRefinementState, NodeRefinementTask } from '../types';
import { applyNodeRefinementResult, assembleRefinedDocument } from './application';
import { normalizeEdgeRefinementOrientation } from './edge-orientation';
import { pruneInvalidEdgeRefinements } from './edge-pruning';
import type { NodeRefinementSchemaContext } from './schema-context';
import { applySoftExpansionPolicy, canExpandRefinementChildren } from './soft-expansion';
import { refreshNodeRefinementTask, resolveCurrentEdgeRefinements } from './task-refresh';
import { validateNodeRefinementSemantics } from './validation';

/** Evaluate the exact candidate the engine will accept, before charging its model turn. */
export async function evaluateNodeRefinementCandidate(params: {
  task: NodeRefinementTask;
  result: NodeRefinementResult;
  state: NodeRefinementState;
  baseDoc: SemanticDocument;
  schemaContext: Pick<NodeRefinementSchemaContext, 'schema' | 'semantics' | 'activeSchemaRefs'>;
  baselineDiagnosticFingerprints?: readonly string[];
  logger?: Logger;
  validateAppliedState?: (
    state: NodeRefinementState,
    assembledDoc: SemanticDocument,
  ) => Diagnostic[] | Promise<Diagnostic[]>;
}) {
  const task = refreshNodeRefinementTask(params.state, params.task);
  const currentResult = resolveCurrentEdgeRefinements(params);
  const result = applySoftExpansionPolicy({
    semantics: params.schemaContext.semantics,
    task,
    state: params.state,
    logger: params.logger ?? { info() {}, warn() {}, error() {} },
    result: pruneInvalidEdgeRefinements({
      task,
      result: normalizeEdgeRefinementOrientation({
        task,
        result: currentResult,
        semantics: params.schemaContext.semantics,
      }),
      schema: params.schemaContext.schema,
      semantics: params.schemaContext.semantics,
      activeEdgeProposals: params.state.activeEdgeProposals,
    }),
  });
  const localDiagnostics = validateNodeRefinementSemantics({
    task,
    result,
    schema: params.schemaContext.schema,
    semantics: params.schemaContext.semantics,
    schemaActivations: params.schemaContext.activeSchemaRefs,
    activeEdgeProposals: params.state.activeEdgeProposals,
  }).map((diagnostic) =>
    diagnostic.code === 'diagram.node_refinement.leaf_group_child' &&
    !canExpandRefinementChildren(task, params.state)
      ? {
          ...diagnostic,
          message: `Group child ${diagnostic.targetId} cannot be expanded at the current depth or refinement budget. Every child must be a leaf; do not return group-type children. Return their concrete members as direct children instead.`,
        }
      : diagnostic,
  );
  const nextState = applyNodeRefinementResult({ state: params.state, task, result });
  const assembledDoc = {
    ...assembleRefinedDocument({
      baseDoc: params.baseDoc,
      state: nextState,
      semantics: params.schemaContext.semantics,
    }),
    schemaRefs: params.schemaContext.activeSchemaRefs,
  };
  const globalDiagnostics = sortDiagnostics(
    (await params.validateAppliedState?.(nextState, assembledDoc)) ?? [],
  );
  const baseline = new Set(params.baselineDiagnosticFingerprints ?? []);
  const introduced = globalDiagnostics.filter(
    (diagnostic) => !baseline.has(diagnosticFingerprint(diagnostic)),
  );
  return {
    result,
    nextState,
    assembledDoc,
    globalDiagnostics,
    diagnostics: sortDiagnostics([...localDiagnostics, ...introduced]),
  };
}
