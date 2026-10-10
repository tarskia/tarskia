import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Diagnostic, SchemaActivation } from '../semantic';
import type { PreparedWorkspace } from '../workspace';
import { writeFileAtomic } from '../write-file-atomic';
import type {
  NodeRefinementResult,
  NodeRefinementState,
  NodeRefinementSurroundingContext,
  NodeRefinementTask,
  SchemaRefCandidate,
} from './types';

const NODE_REFINEMENT_CACHE_VERSION = 3;
const NODE_REFINEMENT_CACHE_DIR = 'analysis/node-refinement-cache';

export interface NodeRefinementCacheSchemaContext {
  inputFingerprint?: string;
  activeSchemaRefs: SchemaActivation[];
  candidateSchemaRefs: SchemaRefCandidate[];
}

export interface CachedNodeRefinementEntry {
  version: number;
  nodeId: string;
  taskFingerprint: string;
  schemaContextFingerprint: string;
  stateFingerprint: string;
  task: NodeRefinementTask;
  result: NodeRefinementResult;
  rawResponse: string | null;
  diagnostics: Diagnostic[];
  repairAttemptCount: number;
  appliedAtTurn: number;
  cachedAt: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, canonicalize(entryValue)]),
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function sanitizeNodeId(nodeId: string): string {
  const normalized = nodeId.replace(/[^a-zA-Z0-9._-]+/g, '--').slice(0, 120);
  return `${normalized || 'node'}-${createHash('sha256').update(nodeId).digest('hex').slice(0, 10)}`;
}

function cacheArtifactPathForNodeId(nodeId: string): string {
  return path.join(NODE_REFINEMENT_CACHE_DIR, `${sanitizeNodeId(nodeId)}.json`);
}

export function buildNodeRefinementTaskFingerprint(task: NodeRefinementTask): string {
  return fingerprint(task);
}

export function buildNodeRefinementSchemaContextFingerprint(
  schemaContext: NodeRefinementCacheSchemaContext,
): string {
  return fingerprint({
    inputFingerprint: schemaContext.inputFingerprint,
    activeSchemaRefs: schemaContext.activeSchemaRefs,
    candidateSchemaRefs: schemaContext.candidateSchemaRefs.map((candidate) => ({
      schemaRef: candidate.schemaRef,
      suggestedLayer: candidate.suggestedLayer,
    })),
  });
}

export function buildNodeRefinementStateFingerprintWithContext(
  state: NodeRefinementState,
  surroundingContext?: NodeRefinementSurroundingContext,
): string {
  return fingerprint({
    maxDepth: state.budgets.maxDepth,
    activeEdgeProposals: state.activeEdgeProposals,
    reviewedDepths: state.reviewedDepths,
    surroundingContext,
  });
}

export function buildCachedNodeRefinementEntry(params: {
  state: NodeRefinementState;
  task: NodeRefinementTask;
  schemaContext: NodeRefinementCacheSchemaContext;
  surroundingContext?: NodeRefinementSurroundingContext;
  result: NodeRefinementResult;
  rawResponse: string | null;
  diagnostics: Diagnostic[];
  repairAttemptCount: number;
}): CachedNodeRefinementEntry {
  return {
    version: NODE_REFINEMENT_CACHE_VERSION,
    nodeId: params.task.nodeId,
    taskFingerprint: buildNodeRefinementTaskFingerprint(params.task),
    schemaContextFingerprint: buildNodeRefinementSchemaContextFingerprint(params.schemaContext),
    stateFingerprint: buildNodeRefinementStateFingerprintWithContext(
      params.state,
      params.surroundingContext,
    ),
    task: params.task,
    result: params.result,
    rawResponse: params.rawResponse,
    diagnostics: params.diagnostics,
    repairAttemptCount: params.repairAttemptCount,
    appliedAtTurn: params.state.budgets.turnsUsed,
    cachedAt: new Date().toISOString(),
  };
}

export async function loadCachedNodeRefinementEntry(params: {
  workspace: PreparedWorkspace;
  nodeId: string;
}): Promise<CachedNodeRefinementEntry | undefined> {
  const artifactPath = path.join(
    params.workspace.workspaceOutputDir,
    cacheArtifactPathForNodeId(params.nodeId),
  );
  try {
    const parsed = JSON.parse(await fs.readFile(artifactPath, 'utf8')) as CachedNodeRefinementEntry;
    return parsed.version === NODE_REFINEMENT_CACHE_VERSION ? parsed : undefined;
  } catch (error) {
    if (
      (error instanceof Error &&
        'code' in error &&
        (error as { code?: unknown }).code === 'ENOENT') ||
      error instanceof SyntaxError
    ) {
      return undefined;
    }
    throw error;
  }
}

export async function writeCachedNodeRefinementEntry(params: {
  workspace: PreparedWorkspace;
  entry: CachedNodeRefinementEntry;
}): Promise<string> {
  const artifactPath = path.join(
    params.workspace.workspaceOutputDir,
    cacheArtifactPathForNodeId(params.entry.nodeId),
  );
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFileAtomic(artifactPath, `${JSON.stringify(params.entry, null, 2)}\n`);
  return artifactPath;
}
