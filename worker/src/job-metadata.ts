import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { StageRecords } from './advanced/checkpoint-inputs';
import type { AdvancedCheckpointStage } from './advanced/types';
import type { WorkerBuildSummary } from './build-summary';
import { emptyUsageAccountingState, type UsageAccountingState } from './codex/usage-accounting';
import { ensureJobRoot } from './job-root';
import { type ReasoningEffort, resolveReasoningEffort } from './reasoning-effort';
import { redactRepositorySpecifier } from './repository-identity';
import { type BuildSecrets, emptyBuildSecrets } from './secret-masking';
import type { Diagnostic } from './semantic';
import type { SourceRepositoryMetadata } from './source-repository';
import { writeFileAtomic } from './write-file-atomic';

export interface SerializedDiagnostic {
  severity: Diagnostic['severity'];
  phase: Diagnostic['phase'];
  code: string;
  message: string;
  entityId?: string;
  relationId?: string;
  moduleId?: string;
  path?: string;
  hint?: string;
}

export interface AdvancedJobMetadata {
  stageRecords?: StageRecords;
  lastCompletedStage: AdvancedCheckpointStage | null;
  restartFrom: AdvancedCheckpointStage | null;
  currentAdvancedThreadId: string | null;
  currentNodeRefinementArtifact: string | null;
  currentGraphArtifact: string | null;
  currentGraphResponseArtifact: string | null;
  currentGraphReviewCompleted: boolean;
}

export interface GeneratedSchemaMetadata {
  status: 'not-requested' | 'succeeded' | 'failed';
  schemaId: string;
  schemaRef: string;
  artifactPath: string | null;
  outputPath: string | null;
  repaired: boolean;
  reused: boolean;
  usedByDiagram: boolean;
  threadId: string | null;
  diagnostics: SerializedDiagnostic[];
  failureMessage: string | null;
}

export interface JobMetadata {
  secrets?: BuildSecrets;
  version: 1;
  repo: string;
  ref: string | null;
  model: string | null;
  reasoningEffort?: ReasoningEffort;
  generateSchema?: boolean;
  schemaId?: string | null;
  schemaOutPath?: string | null;
  schemaSource: string;
  outputPath: string;
  workspaceRoot: string;
  repoRevision: string | null;
  sourceRepository: SourceRepositoryMetadata | null;
  appDescription: string | null;
  schemaSourceRevision: string | null;
  status: 'running' | 'succeeded' | 'failed' | 'interrupted' | 'stopped' | 'budget-exhausted';
  activeStage: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  failureMessage: string | null;
  threadId: string | null;
  repaired: boolean;
  resolvedSchemaIds: string[];
  diagnostics: SerializedDiagnostic[];
  buildSummary?: WorkerBuildSummary | null;
  usageAccounting?: UsageAccountingState;
  generatedSchema?: GeneratedSchemaMetadata | null;
  advanced?: AdvancedJobMetadata;
}

function metadataDirectoryForJobRoot(jobRoot: string): string {
  return path.join(jobRoot, 'out');
}

export function metadataPathForJobRoot(jobRoot: string): string {
  return path.join(metadataDirectoryForJobRoot(jobRoot), 'job-metadata.json');
}

export function deriveDefaultJobRoot(outputPath: string): string {
  return `${path.resolve(outputPath)}.job`;
}

export function serializeDiagnostics(diagnostics: Diagnostic[]): SerializedDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    severity: diagnostic.severity,
    phase: diagnostic.phase,
    code: diagnostic.code,
    message: diagnostic.message,
    entityId: diagnostic.entityId,
    relationId: diagnostic.relationId,
    moduleId: diagnostic.moduleId,
    path: diagnostic.path,
    hint: diagnostic.hint,
  }));
}

export function createInitialJobMetadata(params: {
  repo: string;
  ref?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  generateSchema?: boolean;
  schemaId?: string;
  schemaRef?: string;
  schemaOutPath?: string;
  schemaSource: string;
  outputPath: string;
  workspaceRoot: string;
  repoRevision?: string;
  sourceRepository?: SourceRepositoryMetadata | null;
  appDescription?: string | null;
  schemaSourceRevision?: string;
  restartFrom?: AdvancedCheckpointStage;
}): JobMetadata {
  const now = new Date().toISOString();
  return {
    version: 1,
    usageAccounting: emptyUsageAccountingState(),
    repo: redactRepositorySpecifier(params.repo),
    ref: params.ref ?? null,
    model: params.model ?? null,
    reasoningEffort: resolveReasoningEffort(params.reasoningEffort),
    generateSchema: params.generateSchema ?? false,
    schemaId: params.schemaId ?? null,
    schemaOutPath: params.schemaOutPath ? path.resolve(params.schemaOutPath) : null,
    schemaSource: path.resolve(params.schemaSource),
    outputPath: path.resolve(params.outputPath),
    workspaceRoot: path.resolve(params.workspaceRoot),
    repoRevision: params.repoRevision ?? null,
    sourceRepository: params.sourceRepository ?? null,
    appDescription: params.appDescription ?? null,
    schemaSourceRevision: params.schemaSourceRevision ?? null,
    status: 'running',
    activeStage: 'repository-workspace-preparation',
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    failureMessage: null,
    threadId: null,
    repaired: false,
    resolvedSchemaIds: [],
    secrets: emptyBuildSecrets(),
    diagnostics: [],
    buildSummary: null,
    generatedSchema: params.schemaId
      ? {
          status: params.generateSchema ? 'failed' : 'not-requested',
          schemaId: params.schemaId,
          schemaRef: params.schemaRef ?? `${params.schemaId}@0.1`,
          artifactPath: null,
          outputPath: params.schemaOutPath ? path.resolve(params.schemaOutPath) : null,
          repaired: false,
          reused: false,
          usedByDiagram: false,
          threadId: null,
          diagnostics: [],
          failureMessage: params.generateSchema ? 'Schema generation has not run yet' : null,
        }
      : null,
    advanced: {
      lastCompletedStage: null,
      restartFrom: params.restartFrom ?? null,
      currentAdvancedThreadId: null,
      currentNodeRefinementArtifact: null,
      currentGraphArtifact: null,
      currentGraphResponseArtifact: null,
      currentGraphReviewCompleted: false,
    },
  };
}

export async function readJobMetadata(jobRoot: string): Promise<JobMetadata | undefined> {
  const metadataPath = metadataPathForJobRoot(jobRoot);
  try {
    const raw = await fs.readFile(metadataPath, 'utf8');
    const parsed = JSON.parse(raw) as JobMetadata & { mode?: string };
    if (!parsed || parsed.version !== 1) throw new Error('Unsupported or missing metadata version');
    // Legacy basic jobs have no reusable advanced pipeline checkpoints.
    if (parsed.mode === 'basic' || parsed.mode === 'simple') return undefined;
    delete parsed.mode;
    parsed.appDescription = parsed.appDescription ?? null;
    if (parsed.advanced) {
      parsed.advanced = {
        ...parsed.advanced,
        currentGraphReviewCompleted: parsed.advanced.currentGraphReviewCompleted ?? false,
      };
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(
      `Job metadata at ${metadataPath} is unreadable: ${error instanceof Error ? error.message : String(error)}. Delete the job folder or rerun with --overwrite to start fresh.`,
      { cause: error },
    );
  }
}

export async function writeJobMetadata(jobRoot: string, metadata: JobMetadata): Promise<void> {
  const metadataPath = metadataPathForJobRoot(jobRoot);
  await ensureJobRoot(jobRoot);
  await fs.mkdir(path.dirname(metadataPath), { recursive: true });
  await writeFileAtomic(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
}

export function isCompatibleResumeMetadata(
  metadata: JobMetadata | undefined,
  params: {
    repo: string;
    ref?: string;
    generateSchema?: boolean;
    schemaId?: string | null;
    schemaOutPath?: string | null;
    schemaSource: string;
    outputPath: string;
  },
): metadata is JobMetadata {
  if (!metadata) return false;
  return (
    redactRepositorySpecifier(metadata.repo) === redactRepositorySpecifier(params.repo) &&
    metadata.ref === (params.ref ?? null) &&
    (metadata.generateSchema ?? false) === (params.generateSchema ?? false) &&
    (metadata.schemaId ?? null) === (params.schemaId ?? null) &&
    (metadata.schemaOutPath ?? null) ===
      (params.schemaOutPath ? path.resolve(params.schemaOutPath) : null) &&
    metadata.schemaSource === path.resolve(params.schemaSource) &&
    metadata.outputPath === path.resolve(params.outputPath)
  );
}
