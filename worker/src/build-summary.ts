import { resolveReasoningEffort } from './reasoning-effort';
import type { SemanticDocument } from './semantic';
import type { SourceRepositoryMetadata } from './source-repository';
import { addTokenUsageTotals, type TokenUsageTotals } from './token-usage';

export interface WorkerBuildSummary extends TokenUsageTotals {
  model: string;
  reasoningEffort?: string;
  builtAt: string;
  durationMs: number;
  turns: number;
  nodes: number;
  edges: number;
}

function countDocumentEntities(entities: SemanticDocument['entities']): number {
  let total = 0;
  for (const entity of entities) {
    total += 1;
    total += countDocumentEntities(entity.children ?? []);
  }
  return total;
}

export function summarizeWorkerBuild(params: {
  document: SemanticDocument;
  model: string;
  reasoningEffort?: string;
  builtAt: string;
  durationMs: number;
  turns: number;
  tokenUsage: TokenUsageTotals;
}): WorkerBuildSummary {
  return {
    ...addTokenUsageTotals(params.tokenUsage),
    model: params.model,
    reasoningEffort: params.reasoningEffort ?? resolveReasoningEffort(undefined),
    builtAt: params.builtAt,
    durationMs: params.durationMs,
    turns: params.turns,
    nodes: countDocumentEntities(params.document.entities),
    edges: params.document.relations.length,
  };
}

export function applyWorkerBuildSummaryToDocument(
  document: SemanticDocument,
  summary: WorkerBuildSummary,
): SemanticDocument {
  return applyBuildMetadataToDocument(document, {
    workerBuild: summary,
  });
}

export function applyBuildMetadataToDocument(
  document: SemanticDocument,
  metadata: {
    workerBuild: WorkerBuildSummary;
    sourceRepository?: SourceRepositoryMetadata | null;
    appDescription?: string | null;
  },
): SemanticDocument {
  return {
    ...document,
    metadata: {
      ...(document.metadata ?? {}),
      workerBuild: metadata.workerBuild,
      ...(metadata.sourceRepository ? { sourceRepository: metadata.sourceRepository } : {}),
      ...(metadata.appDescription ? { description: metadata.appDescription } : {}),
    },
  };
}
