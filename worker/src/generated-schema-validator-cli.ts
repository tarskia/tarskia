import path from 'node:path';
import { validateGeneratedSchemaCandidate } from './generated-schema';
import { type SerializedDiagnostic, serializeDiagnostics } from './job-metadata';

export interface GeneratedSchemaValidationCliResult {
  ok: boolean;
  diagnostics: SerializedDiagnostic[];
  flowDiagnostics: SerializedDiagnostic[];
}

function buildWorkspacePaths(jobRoot: string) {
  const resolvedJobRoot = path.resolve(jobRoot);
  return {
    jobRoot: resolvedJobRoot,
    schemaRepoPath: path.join(resolvedJobRoot, 'schema-repo'),
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function validateGeneratedSchemaCandidateCommand(params: {
  jobRoot: string;
  schemaId: string;
  rawSchema: string;
}): Promise<GeneratedSchemaValidationCliResult> {
  const { schemaRepoPath } = buildWorkspacePaths(params.jobRoot);
  const validation = await validateGeneratedSchemaCandidate({
    rawSchema: params.rawSchema,
    schemaRegistryRoot: schemaRepoPath,
    schemaId: params.schemaId,
  });
  return {
    ok: validation.ok,
    diagnostics: serializeDiagnostics(validation.diagnostics),
    flowDiagnostics: serializeDiagnostics(validation.flowDiagnostics),
  };
}

export async function runValidateGeneratedSchemaCli(params: {
  jobRoot: string;
  schemaId: string;
}): Promise<void> {
  const rawSchema = await readStdin();
  const result = await validateGeneratedSchemaCandidateCommand({
    ...params,
    rawSchema,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
