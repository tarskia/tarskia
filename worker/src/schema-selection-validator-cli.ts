import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AdvancedSchemaSetManager, serializeSchemaSetArtifact } from './advanced/schema-set';
import type { SchemaRefCandidate } from './advanced/types';
import { type SerializedDiagnostic, serializeDiagnostics } from './job-metadata';
import {
  type Diagnostic,
  diagramDiagnostic,
  loadSchemaRegistry,
  parseDocument,
  type SchemaActivation,
  sortDiagnostics,
} from './semantic';
import type { SchemaRegistry } from './semantic/schema-loader';
import { assertYamlInputSize, YamlInputError, yamlInputDiagnostic } from './untrusted-yaml';

export interface SchemaSelectionValidationContextArtifact {
  version: 1;
  rootSchemaRefs: SchemaActivation[];
  activeSchemaRefs: SchemaActivation[];
  candidateSchemaRefs: SchemaRefCandidate[];
}

export interface SchemaSelectionValidationCliResult {
  ok: boolean;
  acceptedSchemaRefs: string[];
  rejectedSchemaRefs: string[];
  activeSchemaRefs: SchemaActivation[];
  diagnostics: SerializedDiagnostic[];
  schemaSet: ReturnType<typeof serializeSchemaSetArtifact>;
}

type SchemaRefLike = string | { schema?: unknown } | undefined | null;

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
}): Promise<SchemaSelectionValidationContextArtifact> {
  const resolvedContextPath = resolveContextPath(params.jobRoot, params.contextPath);
  return JSON.parse(
    await fs.readFile(resolvedContextPath, 'utf8'),
  ) as SchemaSelectionValidationContextArtifact;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function normalizeSchemaRefValues(values: SchemaRefLike[]): string[] {
  return [
    ...new Set(
      values
        .map((value) => (typeof value === 'string' ? value : value?.schema))
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim()),
    ),
  ];
}

function collectSchemaRefsFromJsonValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeSchemaRefValues(value as SchemaRefLike[]);
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  const record = value as Record<string, unknown>;
  const direct = normalizeSchemaRefValues([
    ...(Array.isArray(record.schemaRefs) ? record.schemaRefs : []),
    ...(Array.isArray(record.suggestedSchemaRefs) ? record.suggestedSchemaRefs : []),
    ...(Array.isArray(record.initialSchemaActivations) ? record.initialSchemaActivations : []),
  ] as SchemaRefLike[]);
  const candidateRefs = Array.isArray(record.candidateSchemaRefs)
    ? [
        ...new Set(
          record.candidateSchemaRefs
            .map((candidate) =>
              candidate && typeof candidate === 'object'
                ? (candidate as Record<string, unknown>).schemaRef
                : undefined,
            )
            .filter(
              (schemaRef): schemaRef is string =>
                typeof schemaRef === 'string' && schemaRef.trim().length > 0,
            )
            .map((schemaRef) => schemaRef.trim()),
        ),
      ]
    : [];
  const rootEditRefs = Array.isArray(record.rootEdits)
    ? record.rootEdits.flatMap((edit) => {
        if (!edit || typeof edit !== 'object') {
          return [];
        }
        const refinement = (edit as Record<string, unknown>).refinement;
        if (!refinement || typeof refinement !== 'object') {
          return [];
        }
        const refs = (refinement as Record<string, unknown>).suggestedSchemaRefs;
        return Array.isArray(refs) ? normalizeSchemaRefValues(refs as SchemaRefLike[]) : [];
      })
    : [];
  return [...new Set([...direct, ...candidateRefs, ...rootEditRefs])];
}

export function extractProposedSchemaRefs(rawResponse: string): {
  schemaRefs: string[];
  diagnostics: Diagnostic[];
} {
  try {
    assertYamlInputSize(rawResponse);
  } catch (error) {
    if (!(error instanceof YamlInputError)) throw error;
    return { schemaRefs: [], diagnostics: [yamlInputDiagnostic(error)] };
  }
  const trimmed = rawResponse.trim();
  if (!trimmed) {
    return {
      schemaRefs: [],
      diagnostics: [],
    };
  }

  try {
    const parsedJson = JSON.parse(trimmed) as unknown;
    return {
      schemaRefs: collectSchemaRefsFromJsonValue(parsedJson),
      diagnostics: [],
    };
  } catch {
    // Fall through to semantic YAML parsing.
  }

  try {
    const document = parseDocument(trimmed);
    return {
      schemaRefs: normalizeSchemaRefValues(document.schemaRefs),
      diagnostics: [],
    };
  } catch (error) {
    return {
      schemaRefs: [],
      diagnostics: [
        diagramDiagnostic({
          phase: 'parse',
          severity: 'error',
          code: 'diagram.schema_selection.invalid_candidate',
          message:
            error instanceof Error
              ? error.message
              : 'Schema selection validator could not parse the candidate as JSON or YAML',
        }),
      ],
    };
  }
}

export function validateSchemaSelectionCandidate(params: {
  schemaRegistry: SchemaRegistry;
  context: SchemaSelectionValidationContextArtifact;
  proposedSchemaRefs: string[];
}): SchemaSelectionValidationCliResult {
  const manager = new AdvancedSchemaSetManager({
    schemaRegistry: params.schemaRegistry,
    initialSchemaActivations: params.context.rootSchemaRefs,
    candidateSchemaRefs: params.context.candidateSchemaRefs,
  });
  const decision = manager.acceptSchemaRefs(params.proposedSchemaRefs);
  const snapshot = manager.snapshot();
  const rejectedDiagnostics: Diagnostic[] = decision.rejectedSchemaRefs.map((schemaRef) =>
    diagramDiagnostic({
      phase: 'document',
      severity: 'error',
      code: 'diagram.document.schema_ref_not_accepted',
      message: `Schema ref ${schemaRef} is not accepted by the active schema-set rules`,
    }),
  );
  const runtimeDiagnostics = snapshot.runtime.resolved.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error',
  );
  const diagnostics = sortDiagnostics([...rejectedDiagnostics, ...runtimeDiagnostics]);

  return {
    ok: diagnostics.length === 0,
    acceptedSchemaRefs: decision.acceptedSchemaRefs,
    rejectedSchemaRefs: decision.rejectedSchemaRefs,
    activeSchemaRefs: snapshot.activeSchemaRefs,
    diagnostics: serializeDiagnostics(diagnostics),
    schemaSet: serializeSchemaSetArtifact(snapshot),
  };
}

export async function validateSchemaSelectionCandidateCommand(params: {
  jobRoot: string;
  contextPath: string;
  rawResponse: string;
}): Promise<SchemaSelectionValidationCliResult> {
  const { schemaRepoPath } = buildWorkspacePaths(params.jobRoot);
  const context = await readValidationContext(params);
  const parsed = extractProposedSchemaRefs(params.rawResponse);
  if (parsed.diagnostics.length > 0) {
    return {
      ok: false,
      acceptedSchemaRefs: [],
      rejectedSchemaRefs: [],
      activeSchemaRefs: context.activeSchemaRefs,
      diagnostics: serializeDiagnostics(parsed.diagnostics),
      schemaSet: {
        rootSchemaRefs: context.rootSchemaRefs,
        activeSchemaRefs: context.activeSchemaRefs,
        candidateSchemaRefs: context.candidateSchemaRefs,
      },
    };
  }
  const schemaRegistry = await loadSchemaRegistry(schemaRepoPath);
  return validateSchemaSelectionCandidate({
    schemaRegistry,
    context,
    proposedSchemaRefs: parsed.schemaRefs,
  });
}

export async function runValidateSchemaSelectionCli(params: {
  jobRoot: string;
  contextPath: string;
}): Promise<void> {
  const rawResponse = await readStdin();
  const result = await validateSchemaSelectionCandidateCommand({
    ...params,
    rawResponse,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
