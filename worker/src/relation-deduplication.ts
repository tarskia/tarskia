import type { Provenance, ProvenanceLocation, Relation, SemanticDocument } from './semantic';

function buildEndpointPairKey(relation: Relation, isUndirected: (type: string) => boolean): string {
  if (!isUndirected(relation.type ?? '')) {
    return JSON.stringify([relation.type ?? '', relation.from, relation.to]);
  }
  const [left, right] =
    relation.from.localeCompare(relation.to) <= 0
      ? [relation.from, relation.to]
      : [relation.to, relation.from];
  return JSON.stringify([relation.type ?? '', left, right]);
}

function buildProvenanceLocationKey(location: ProvenanceLocation): string {
  return [
    location.input ?? '',
    location.path,
    location.repo ?? '',
    location.commit ?? '',
    location.symbol ?? '',
    location.note ?? '',
  ].join('::');
}

function mergeProvenance(
  left: Provenance | undefined,
  right: Provenance | undefined,
): Provenance | undefined {
  if (!left && !right) {
    return undefined;
  }

  const mergedLocations: ProvenanceLocation[] = [];
  const seen = new Set<string>();
  for (const provenance of [left, right]) {
    for (const location of provenance?.locations ?? []) {
      const key = buildProvenanceLocationKey(location);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      mergedLocations.push(location);
    }
  }

  return mergedLocations.length > 0
    ? {
        confidence: left?.confidence ?? right?.confidence,
        locations: mergedLocations,
      }
    : undefined;
}

export function dedupeDocumentRelations(
  document: SemanticDocument,
  isUndirected: (type: string) => boolean = () => false,
): SemanticDocument {
  const relationsByKey = new Map<string, Relation>();

  for (const relation of document.relations) {
    const key = buildEndpointPairKey(relation, isUndirected);
    const existing = relationsByKey.get(key);
    if (!existing) {
      relationsByKey.set(key, relation);
      continue;
    }

    relationsByKey.set(key, {
      ...existing,
      provenance: mergeProvenance(existing.provenance, relation.provenance),
    });
  }

  return {
    ...document,
    relations: [...relationsByKey.values()],
  };
}
