import { type Diagnostic, diagramDiagnostic } from '../../semantic';
import type { NodeRefinementResult, NodeRefinementTask } from '../types';
import { UNREFINED_INHERITED_EDGE_DIAGNOSTIC_CODE } from './schema-context';

export function shouldRepairNodeRefinementDiagnostics(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === 'error' ||
      diagnostic.code === 'diagram.node_refinement.edge_refinement_soft_cap_exceeded' ||
      diagnostic.code === 'diagram.node_refinement.empty_group' ||
      diagnostic.code === 'diagram.node_refinement.single_child_group' ||
      diagnostic.code === 'diagram.node_refinement.leaf_group_child' ||
      diagnostic.code === UNREFINED_INHERITED_EDGE_DIAGNOSTIC_CODE,
  );
}

export function createEmptyNodeRefinementResult(): NodeRefinementResult {
  return {
    children: [],
    relations: [],
    edgeRefinements: [],
    edgeProposals: [],
    suggestedSchemaRefs: [],
    openQuestions: [],
  };
}

export function buildNodeRefinementModelOutputDiagnostics(params: {
  task: NodeRefinementTask;
  error: Error;
}): Diagnostic[] {
  return [
    diagramDiagnostic({
      phase: 'document',
      severity: 'error',
      code: 'diagram.node_refinement.invalid_model_output',
      entityId: params.task.nodeId,
      message: `Node refinement output for ${params.task.nodeId} was not valid structured JSON/YAML: ${params.error.message}. Return only the required node-refinement JSON shape.`,
    }),
  ];
}

export function isFatalNodeRefinementDiagnostic(diagnostic: Diagnostic): boolean {
  if (diagnostic.severity !== 'error') {
    return false;
  }
  return !diagnostic.code.startsWith('diagram.flow.');
}
