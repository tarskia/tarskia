import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DiagramGenerationResumeOptions } from '../ai-diagram-service';
import type { SchemaActivation } from '../semantic';
import { parseDocument } from '../semantic';
import { emptyTokenUsageTotals } from '../token-usage';
import type { PreparedWorkspace } from '../workspace';
import { writeFileAtomic } from '../write-file-atomic';
import type { Level0BackboneBuilderResult } from './graph-builders';
import {
  type AreaPlan,
  compareAdvancedCheckpointStage,
  type NodeRefinementState,
  type RepoCensus,
} from './types';

export class CheckpointParseError extends Error {
  constructor(filePath: string, cause: unknown) {
    super(
      `Cannot parse checkpoint ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = 'CheckpointParseError';
  }
}

function parseCheckpoint<T>(filePath: string, raw: string, parse: (raw: string) => T): T {
  try {
    return parse(raw);
  } catch (error) {
    throw new CheckpointParseError(filePath, error);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
type Shape = (value: unknown) => boolean;
const text: Shape = (value) => typeof value === 'string';
const number: Shape = (value) => typeof value === 'number' && Number.isFinite(value);
const array =
  (shape: Shape): Shape =>
  (value) =>
    Array.isArray(value) && value.every(shape);
const fields =
  (shapes: Record<string, Shape>): Shape =>
  (value) =>
    record(value) && Object.entries(shapes).every(([key, shape]) => shape(value[key]));
const optional =
  (shape: Shape): Shape =>
  (value) =>
    value === undefined || shape(value);
const evidence = array(fields({ path: text, reason: text }));
const edge = fields({ id: text, sourceId: text, targetId: text, evidence });
const child = fields({
  id: text,
  localId: text,
  typeId: text,
  scope: array(text),
  evidence,
  queueDecision: (value) => value === 'leaf' || value === 'expand',
});
const task = fields({
  nodeId: text,
  nodeTypeId: text,
  depth: number,
  scope: array(text),
  evidence,
  inboundEdges: array(edge),
  outboundEdges: array(edge),
});
const proposal = fields({
  edgeId: text,
  childId: text,
  childLocalId: text,
  childTypeId: text,
  endpoint: (value) => value === 'from' || value === 'to',
});
const refinement = fields({
  nodeId: text,
  children: array(child),
  relations: array(edge),
  edgeRefinements: array(
    fields({ edgeId: text, refinedEdgeId: text, sourceId: text, targetId: text }),
  ),
  edgeProposals: array(proposal),
  openQuestions: array(text),
});
const diagnostic = fields({ code: text, message: text, severity: text, phase: text });
const pendingResult = fields({
  children: array(
    fields({
      localId: text,
      name: text,
      typeId: text,
      scope: array(text),
      evidence,
      queueDecision: text,
    }),
  ),
  relations: array(
    fields({ localId: text, typeId: text, fromLocalId: text, toLocalId: text, evidence }),
  ),
  edgeRefinements: array(
    fields({ edgeId: text, fromChildLocalId: optional(text), toChildLocalId: optional(text) }),
  ),
  edgeProposals: optional(array(fields({ edgeId: text, childLocalId: text, endpoint: text }))),
  parseDiagnostics: optional(array(diagnostic)),
  edgeReferenceDiagnostics: optional(array(diagnostic)),
  suggestedSchemaRefs: optional(array(text)),
  openQuestions: optional(array(text)),
});
const pendingTurn = fields({
  result: pendingResult,
  rawResponse: text,
  threadId: (value) => value === null || text(value),
});
const pendingRepair = (value: unknown) =>
  pendingTurn(value) &&
  fields({
    nodeId: text,
    diagnostics: array(diagnostic),
    repairAttempt: (value) =>
      Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2,
    lastAcceptable: optional(pendingTurn),
  })(value);
const map =
  (shape: Shape): Shape =>
  (value) =>
    record(value) && Object.values(value).every(shape);
const activation = fields({ schema: text, layer: optional(number) });
const candidate = fields({ schemaRef: text, suggestedLayer: number, rationale: text, evidence });
function validShape(filePath: string, value: unknown): boolean {
  if (filePath.endsWith('repo-census.json'))
    return fields({
      summary: fields({ totalFiles: number, totalDirectories: number }),
      files: array(
        fields({
          path: text,
          directory: text,
          fileName: text,
          language: text,
          lineCount: number,
          byteCount: number,
        }),
      ),
      directories: array(
        fields({ path: text, fileCount: number, lineCount: number, languages: map(number) }),
      ),
      manifests: array(fields({ path: text, kind: text })),
      signals: array(fields({ path: text, kind: text, reason: text })),
    })(value);
  if (filePath.endsWith('area-plan.json')) {
    const concepts = array(
      fields({
        id: text,
        title: text,
        paths: array(text),
        rationale: text,
        evidence,
        openQuestions: array(text),
        groupingHints: optional(array(text)),
      }),
    );
    return (
      fields({
        repoSummary: text,
        initialSchemaActivations: array(activation),
        candidateSchemaRefs: array(candidate),
      })(value) &&
      record(value) &&
      concepts(value.keyConcepts ?? value.areas)
    );
  }
  if (filePath.endsWith('schema-set.json'))
    return fields({
      rootSchemaRefs: array(activation),
      activeSchemaRefs: array(activation),
      candidateSchemaRefs: array(candidate),
    })(value);
  // Validate nested collections before any consumer traverses a persisted state.
  return fields({
    pendingRepair: optional(pendingRepair),
    rootNodeIds: array(text),
    queue: array(task),
    tasksByNodeId: map(task),
    nodesById: map(child),
    refinementsByNodeId: map(refinement),
    edgeContracts: array(edge),
    activeEdgeProposals: array(proposal),
    reviewedDepths: array(number),
    budgets: fields({ maxDepth: number, turnsUsed: number }),
  })(value);
}
async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf8');
  return parseCheckpoint(filePath, raw, (text) => {
    const value: unknown = JSON.parse(text);
    if (!validShape(filePath, value)) throw new Error('unsupported or malformed checkpoint shape');
    return value as T;
  });
}

async function readJsonArtifact<T>(workspace: PreparedWorkspace, fileName: string): Promise<T> {
  return readJsonFile<T>(path.join(workspace.workspaceOutputDir, fileName));
}

async function readTextArtifact(workspace: PreparedWorkspace, fileName: string): Promise<string> {
  const artifactPath = path.join(workspace.workspaceOutputDir, fileName);
  return fs.readFile(artifactPath, 'utf8');
}

function resolveArtifactPath(workspace: PreparedWorkspace, artifactPath: string): string {
  const resolved = path.isAbsolute(artifactPath)
    ? path.resolve(artifactPath)
    : path.resolve(workspace.workspaceOutputDir, artifactPath);
  const relative = path.relative(workspace.workspaceOutputDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      `Checkpoint artifact path escapes the workspace output directory: ${artifactPath}`,
    );
  }
  return resolved;
}

export async function loadRepoCensusCheckpoint(workspace: PreparedWorkspace): Promise<RepoCensus> {
  return readJsonArtifact<RepoCensus>(workspace, 'analysis/repo-census.json');
}

export async function loadAreaPlanCheckpoint(workspace: PreparedWorkspace): Promise<AreaPlan> {
  return readJsonArtifact<AreaPlan>(workspace, 'analysis/area-plan.json');
}

export async function loadLevel0BackboneCheckpoint(
  workspace: PreparedWorkspace,
): Promise<Level0BackboneBuilderResult> {
  const rawYaml = await readTextArtifact(workspace, 'analysis/level0-backbone.pre-review.yaml');
  return {
    rawYaml,
    doc: parseCheckpoint(
      path.join(workspace.workspaceOutputDir, 'analysis/level0-backbone.pre-review.yaml'),
      rawYaml,
      parseDocument,
    ),
    rawResponse: await readTextArtifact(workspace, 'analysis/level0-backbone.response.yaml').catch(
      () => rawYaml,
    ),
    threadId: null,
    tokenUsage: emptyTokenUsageTotals(),
  };
}

export async function loadLevel0ReviewCheckpoint(
  workspace: PreparedWorkspace,
): Promise<Level0BackboneBuilderResult> {
  const rawYaml = await readTextArtifact(workspace, 'analysis/level0-review.yaml');
  return {
    rawYaml,
    doc: parseCheckpoint(
      path.join(workspace.workspaceOutputDir, 'analysis/level0-review.yaml'),
      rawYaml,
      parseDocument,
    ),
    rawResponse: await readTextArtifact(workspace, 'analysis/level0-review.response.yaml').catch(
      () => rawYaml,
    ),
    threadId: null,
    tokenUsage: emptyTokenUsageTotals(),
  };
}

// Snapshot legacy handoff files before any stage can overwrite them. New loaders never use
// the mutable handoff as a checkpoint; a persisted reviewed depth is the wave-1 commit marker.
export async function prepareBackboneCheckpoints(
  workspace: PreparedWorkspace,
  resume: DiagramGenerationResumeOptions['advanced'],
  warn: (message: string) => void = () => {},
): Promise<boolean> {
  if (!resume?.lastCompletedStage) return false;
  const completed = (stage: 'level0-backbone' | 'level0-review') =>
    compareAdvancedCheckpointStage(stage, resume.lastCompletedStage!) <= 0;
  const copyLegacy = async (destination: string) => {
    try {
      await writeFileAtomic(
        path.join(workspace.workspaceOutputDir, destination),
        await fs.readFile(path.join(workspace.workspaceOutputDir, 'analysis/level0-backbone.yaml')),
        { exclusive: true },
      );
    } catch (error) {
      if (!['ENOENT', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  };
  if (completed('level0-backbone')) await copyLegacy('analysis/level0-backbone.pre-review.yaml');
  if (!completed('level0-review')) return false;
  await copyLegacy('analysis/level0-review.yaml');
  let state: NodeRefinementState;
  try {
    state = await loadNodeRefinementCheckpoint({
      workspace,
      artifactPath: resume.currentNodeRefinementArtifact ?? undefined,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    if (error instanceof CheckpointParseError) {
      warn(`${error.message}; recomputing the checkpoint stage`);
      return false;
    }
    throw error;
  }
  const wave1Completed = state.reviewedDepths.includes(1);
  if (wave1Completed) await copyLegacy('analysis/level0-wave1.yaml');
  return wave1Completed;
}

export async function loadLevel0Wave1Checkpoint(
  workspace: PreparedWorkspace,
): Promise<Level0BackboneBuilderResult> {
  const rawYaml = await readTextArtifact(workspace, 'analysis/level0-wave1.yaml');
  return {
    rawYaml,
    doc: parseCheckpoint(
      path.join(workspace.workspaceOutputDir, 'analysis/level0-wave1.yaml'),
      rawYaml,
      parseDocument,
    ),
    rawResponse: rawYaml,
    threadId: null,
    tokenUsage: emptyTokenUsageTotals(),
  };
}

export async function loadNodeRefinementCheckpoint(params: {
  workspace: PreparedWorkspace;
  artifactPath?: string;
}): Promise<NodeRefinementState> {
  const state = params.artifactPath
    ? await readJsonFile<NodeRefinementState>(
        resolveArtifactPath(params.workspace, params.artifactPath),
      )
    : await readJsonArtifact<NodeRefinementState>(
        params.workspace,
        'analysis/node-refinement-state.json',
      );
  return {
    ...state,
    reviewedDepths: state.reviewedDepths ?? [],
    budgets: {
      ...state.budgets,
      tokenUsage: state.budgets?.tokenUsage ?? emptyTokenUsageTotals(),
    },
  };
}

export async function loadSchemaSetCheckpoint(workspace: PreparedWorkspace): Promise<{
  rootSchemaRefs: SchemaActivation[];
  activeSchemaRefs: SchemaActivation[];
  candidateSchemaRefs: unknown[];
}> {
  return readJsonArtifact<{
    rootSchemaRefs: SchemaActivation[];
    activeSchemaRefs: SchemaActivation[];
    candidateSchemaRefs: unknown[];
  }>(workspace, 'analysis/schema-set.json');
}

export async function loadGraphCollationCheckpoint(params: {
  workspace: PreparedWorkspace;
  artifactPath: string;
  responseArtifactPath?: string;
  threadId?: string | null;
}): Promise<{
  rawYaml: string;
  doc: ReturnType<typeof parseDocument>;
  rawResponse: string;
  threadId: string | null;
  tokenUsage: ReturnType<typeof emptyTokenUsageTotals>;
}> {
  const rawYaml = await fs.readFile(
    resolveArtifactPath(params.workspace, params.artifactPath),
    'utf8',
  );
  return {
    rawYaml,
    doc: parseCheckpoint(
      resolveArtifactPath(params.workspace, params.artifactPath),
      rawYaml,
      parseDocument,
    ),
    rawResponse: await fs
      .readFile(
        resolveArtifactPath(
          params.workspace,
          params.responseArtifactPath ?? params.artifactPath.replace(/\.ya?ml$/i, '.response.yaml'),
        ),
        'utf8',
      )
      .catch(() => rawYaml),
    threadId: params.threadId ?? null,
    tokenUsage: emptyTokenUsageTotals(),
  };
}
