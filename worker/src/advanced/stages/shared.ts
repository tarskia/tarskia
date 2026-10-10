import path from 'node:path';
import type { GenerateDiagramOptions } from '../../ai-diagram-service';
import {
  type Diagnostic,
  diagramDiagnostic,
  type SemanticDocument,
  STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
  sortDiagnostics,
  validateDiagramYaml,
} from '../../semantic';
import type { SchemaRegistry } from '../../semantic/schema-loader';

export const MAX_LEVEL0_BACKBONE_REPAIR_ATTEMPTS = 3;
export const MAX_AREA_PLAN_ATTEMPTS = 3;
export const MAX_WAVE1_REVIEW_REPAIR_ATTEMPTS = 2;
export const NODE_REFINEMENT_VALIDATION_CONTEXT_ARTIFACT =
  'analysis/node-refinement.validation-context.json';

export const NODE_REFINEMENT_VALIDATION_HELPER_ARTIFACT = 'analysis/validate-node-refinement.mjs';

export const SCHEMA_SELECTION_VALIDATION_CONTEXT_ARTIFACT =
  'analysis/schema-selection.validation-context.json';

export const SCHEMA_SELECTION_VALIDATION_HELPER_ARTIFACT = 'analysis/validate-schema-selection.mjs';

export const PRE_REFINEMENT_HANDOFF_ARTIFACT = 'analysis/pre-refinement.handoff.md';

export const BACKBONE_REVIEW_HANDOFF_ARTIFACT = 'analysis/backbone-review.handoff.md';

export const WAVE1_REVIEW_HANDOFF_ARTIFACT = 'analysis/wave1-review.handoff.md';

export const NODE_REFINEMENT_HANDOFF_ARTIFACT = 'analysis/node-refinement.handoff.md';

export const GRAPH_COLLATION_HANDOFF_ARTIFACT = 'analysis/graph-collation.handoff.md';

export const FINAL_REVIEW_HANDOFF_ARTIFACT = 'analysis/final-review.handoff.md';

export function createEmptySemanticDocument(
  schemaRefs: { schema: string; layer: number }[],
): SemanticDocument {
  return {
    version: '0.1.0',
    schemaRefs: [...schemaRefs],
    entities: [],
    relations: [],
  };
}

export function buildModelOutputDiagnostic(params: {
  code: string;
  message: string;
  severity?: Diagnostic['severity'];
}): Diagnostic {
  return diagramDiagnostic({
    phase: 'document',
    severity: params.severity ?? 'error',
    code: params.code,
    message: params.message,
  });
}

export function toWorkspaceRelativePath(workspaceRoot: string, targetPath: string): string {
  const relative = path.relative(workspaceRoot, targetPath);
  return relative.split(path.sep).join('/') || '.';
}

export function formatSchemaActivations(
  activations: Array<{ schema: string; layer: number }>,
): string {
  return activations.length > 0
    ? activations
        .map((activation) => `- ${activation.schema} (layer ${activation.layer})`)
        .join('\n')
    : '- None';
}

export function buildHandoffArtifact(params: {
  title: string;
  workspaceRoot: string;
  summary: string;
  artifactPaths: Array<{ label: string; path: string }>;
  extraSections?: Array<{ heading: string; body: string }>;
}): string {
  return [
    `# ${params.title}`,
    '',
    params.summary,
    '',
    'Canonical artifacts to read:',
    ...params.artifactPaths.map(
      (artifact) =>
        `- ${artifact.label}: ${toWorkspaceRelativePath(params.workspaceRoot, artifact.path)}`,
    ),
    ...(params.extraSections ?? []).flatMap((section) => [
      '',
      `## ${section.heading}`,
      '',
      section.body,
    ]),
    '',
  ].join('\n');
}

export function formatLevel0RepairPassCount(count: number): string {
  return `${count} level-0 ${count === 1 ? 'repair pass' : 'repair passes'}`;
}

export function formatReviewRepairPassCount(count: number): string {
  return `${count} review ${count === 1 ? 'repair pass' : 'repair passes'}`;
}

export function isFatalBackboneDiagnostic(diagnostic: Diagnostic): boolean {
  return !diagnostic.code.startsWith('diagram.flow.');
}

export function summarizeNodeIds(nodeIds: string[], limit = 5): string {
  return `${nodeIds.slice(0, limit).join(', ')}${
    nodeIds.length > limit ? ` (+${nodeIds.length - limit} more)` : ''
  }`;
}

export function validateSemanticDocument(params: {
  rawYaml: string;
  schemaRegistry: SchemaRegistry;
  primaryDocumentInput: GenerateDiagramOptions['primaryDocumentInput'];
}) {
  const validation = validateDiagramYaml({
    yaml: params.rawYaml,
    schemaRegistry: params.schemaRegistry,
    documentInputs: [params.primaryDocumentInput],
    validationOptions: STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
  });

  return {
    ...validation,
    diagnostics: sortDiagnostics(validation.diagnostics),
  };
}
