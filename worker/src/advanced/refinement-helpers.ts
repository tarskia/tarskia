import { getResolvedTypeSemantics, type SchemaSemantics } from '../semantic';
import type { AreaPlanEvidence, InheritedEdgeProposal, RefinableEdgeContract } from './types';
export function isGroupLikeType(semantics: SchemaSemantics, typeId: string): boolean {
  return (
    getResolvedTypeSemantics(semantics, typeId)?.traitClosure.some((id) =>
      id.endsWith('.traits.group-like'),
    ) ?? false
  );
}
export function dedupeEvidence(evidence: AreaPlanEvidence[]): AreaPlanEvidence[] {
  const deduped = new Map<string, AreaPlanEvidence>();
  for (const item of evidence) {
    deduped.set(JSON.stringify([item.path, item.reason]), item);
  }
  return [...deduped.values()];
}

export function dedupeEdgeContracts(
  edgeContracts: RefinableEdgeContract[],
): RefinableEdgeContract[] {
  const dedupedByKey = new Map<string, RefinableEdgeContract>();
  for (const edgeContract of edgeContracts) {
    const key = [
      edgeContract.relationTypeId ?? '',
      edgeContract.sourceId,
      edgeContract.targetId,
    ].join('::');
    const existing = dedupedByKey.get(key);
    if (!existing) {
      dedupedByKey.set(key, {
        ...edgeContract,
        evidence: dedupeEvidence(edgeContract.evidence),
      });
      continue;
    }
    dedupedByKey.set(key, {
      ...existing,
      evidence: dedupeEvidence([...existing.evidence, ...edgeContract.evidence]),
    });
  }
  return [...dedupedByKey.values()];
}

export function dedupeEdgeProposals<T extends InheritedEdgeProposal>(edgeProposals: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const edgeProposal of edgeProposals) {
    const key = [
      edgeProposal.edgeId,
      edgeProposal.endpoint,
      edgeProposal.childLocalId,
      edgeProposal.relationTypeId ?? '',
    ].join('::');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(edgeProposal);
  }
  return deduped;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => isNonEmptyString(item)).map((item) => item.trim());
}

export function normalizeEvidence(value: unknown): AreaPlanEvidence[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const record = item as Record<string, unknown>;
      if (!isNonEmptyString(record.path) || !isNonEmptyString(record.reason)) {
        return null;
      }
      return {
        path: record.path.trim(),
        reason: record.reason.trim(),
      };
    })
    .filter((item): item is AreaPlanEvidence => item !== null);
}

export function extractJsonResponse(response: string): string {
  const trimmed = response.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  return trimmed;
}
