import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseNodeRefinementResponse } from './advanced/node-refinement';
import { formatWithEdgeHandles } from './advanced/node-refinement-edge-handles';
import { validateAppliedNodeRefinement } from './advanced/node-refinement-validator';
import type { NodeRefinementState, NodeRefinementTask } from './advanced/types';
import { type SerializedDiagnostic, serializeDiagnostics } from './job-metadata';
import type { DocumentInput, SchemaActivation, SemanticDocument } from './semantic';
import {
  buildRawSchemaSet,
  buildSchemaRuntime,
  buildSchemaSelection,
  diagramDiagnostic,
  loadSchemaRegistry,
  sortDiagnostics,
} from './semantic';

export interface NodeRefinementValidationContextArtifact {
  version: 1;
  baselineDiagnosticFingerprints?: string[];
  task: NodeRefinementTask;
  state: NodeRefinementState;
  baseDoc: SemanticDocument;
  activeSchemaRefs: SchemaActivation[];
  primaryDocumentInput: DocumentInput;
}

export interface NodeRefinementValidationCliResult {
  hardOk: boolean;
  softOk: boolean;
  hardDiagnostics: SerializedDiagnostic[];
  softDiagnostics: SerializedDiagnostic[];
}

function buildWorkspacePaths(jobRoot: string) {
  const resolvedJobRoot = path.resolve(jobRoot);
  return {
    jobRoot: resolvedJobRoot,
    schemaRepoPath: path.join(resolvedJobRoot, 'schema-repo'),
  };
}

function resolveContextPath(jobRoot: string, contextPath: string): string {
  return path.isAbsolute(contextPath) ? contextPath : path.resolve(jobRoot, contextPath);
}

async function readValidationContext(params: {
  jobRoot: string;
  contextPath: string;
}): Promise<NodeRefinementValidationContextArtifact> {
  const resolvedContextPath = resolveContextPath(params.jobRoot, params.contextPath);
  return JSON.parse(
    await fs.readFile(resolvedContextPath, 'utf8'),
  ) as NodeRefinementValidationContextArtifact;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function validateNodeRefinementCandidateCommand(params: {
  jobRoot: string;
  contextPath: string;
  rawResponse: string;
}): Promise<NodeRefinementValidationCliResult> {
  const { schemaRepoPath } = buildWorkspacePaths(params.jobRoot);
  const context = await readValidationContext(params);
  const schemaRegistry = await loadSchemaRegistry(schemaRepoPath);
  const rawSchemaSet = buildRawSchemaSet(Array.from(schemaRegistry.modulesById.values()));
  const runtime = buildSchemaRuntime({
    raw: rawSchemaSet,
    selection: buildSchemaSelection({
      raw: rawSchemaSet,
      activations: context.activeSchemaRefs,
    }),
  });
  const resolutionDiagnostics = sortDiagnostics(runtime.resolved.diagnostics);
  if (
    resolutionDiagnostics.some((diagnostic) => diagnostic.severity === 'error') ||
    !runtime.resolved.effectiveSchema
  ) {
    const hardDiagnostics = serializeDiagnostics(
      runtime.resolved.effectiveSchema
        ? resolutionDiagnostics
        : [
            ...resolutionDiagnostics,
            diagramDiagnostic({
              phase: 'document',
              severity: 'error',
              code: 'diagram.node_refinement.validation_schema_unavailable',
              message: 'Node refinement validation could not resolve an effective schema',
            }),
          ],
    );
    return {
      hardOk: false,
      softOk: true,
      hardDiagnostics,
      softDiagnostics: [],
    };
  }

  try {
    const result = parseNodeRefinementResponse(params.rawResponse, context.task);
    const validation = await validateAppliedNodeRefinement({
      baselineDiagnosticFingerprints: context.baselineDiagnosticFingerprints,
      state: context.state,
      task: context.task,
      result,
      baseDoc: context.baseDoc,
      schemaContext: {
        activeSchemaRefs: context.activeSchemaRefs,
        schema: runtime.resolved.effectiveSchema,
        semantics: runtime.semantics,
      },
      primaryDocumentInput: context.primaryDocumentInput,
    });
    return {
      hardOk: validation.hardDiagnostics.length === 0,
      softOk: validation.softDiagnostics.length === 0,
      hardDiagnostics: JSON.parse(
        formatWithEdgeHandles(serializeDiagnostics(validation.hardDiagnostics), context.task),
      ),
      softDiagnostics: JSON.parse(
        formatWithEdgeHandles(serializeDiagnostics(validation.softDiagnostics), context.task),
      ),
    };
  } catch (error) {
    const diagnostics = [
      diagramDiagnostic({
        phase: 'parse',
        severity: 'error',
        code: 'diagram.node_refinement.invalid_json_response',
        message:
          error instanceof Error
            ? error.message
            : 'Node refinement validator could not parse the candidate JSON',
      }),
    ];
    return {
      hardOk: false,
      softOk: true,
      hardDiagnostics: serializeDiagnostics(diagnostics),
      softDiagnostics: [],
    };
  }
}

export async function runValidateNodeRefinementCli(params: {
  jobRoot: string;
  contextPath: string;
}): Promise<void> {
  const rawResponse = await readStdin();
  const result = await validateNodeRefinementCandidateCommand({
    ...params,
    rawResponse,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
