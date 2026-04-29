import { areSchemaActivationListsEqual } from '@tarskia/diagram-semantics';
import { parseDocument } from '../util/serialization';
import { buildEntityIndex } from './entity-tree';
import type { Relation, SemanticDocument } from './types';

export const buildInitialDiagramSummary = (doc: SemanticDocument): string[] => {
  const entityCount = buildEntityIndex(doc.entities).entries.length;
  const relationCount = doc.relations.length;
  const schemaActivationCount = doc.schemaRefs.length;
  const name = doc.metadata?.name?.trim() || 'Untitled diagram';
  return [
    `Initial checkpoint for ${name}`,
    `${schemaActivationCount} schema activation${schemaActivationCount === 1 ? '' : 's'}`,
    `${entityCount} entit${entityCount === 1 ? 'y' : 'ies'}, ${relationCount} relation${
      relationCount === 1 ? '' : 's'
    }`,
  ];
};

const stableStringify = (value: unknown) => JSON.stringify(value);

const countChangedRecords = <T extends { id: string }>(
  previous: T[],
  next: T[],
  serialize: (record: T) => string,
) => {
  const previousById = new Map(previous.map((record) => [record.id, record] as const));
  const nextById = new Map(next.map((record) => [record.id, record] as const));

  let added = 0;
  let removed = 0;
  let updated = 0;

  for (const [id, record] of nextById) {
    const previousRecord = previousById.get(id);
    if (!previousRecord) {
      added += 1;
      continue;
    }
    if (serialize(previousRecord) !== serialize(record)) {
      updated += 1;
    }
  }

  for (const id of previousById.keys()) {
    if (!nextById.has(id)) {
      removed += 1;
    }
  }

  return { added, removed, updated };
};

const serializeEntity = (entity: SemanticDocument['entities'][number]) => stableStringify(entity);
const serializeRelation = (relation: Relation) => stableStringify(relation);

const buildSemanticSummary = (previous: SemanticDocument, next: SemanticDocument): string[] => {
  const summaryLines: string[] = [];
  const previousEntities = buildEntityIndex(previous.entities).entries.map((entry) => entry.entity);
  const nextEntities = buildEntityIndex(next.entities).entries.map((entry) => entry.entity);
  const entityChanges = countChangedRecords(previousEntities, nextEntities, serializeEntity);
  const relationChanges = countChangedRecords(
    previous.relations,
    next.relations,
    serializeRelation,
  );

  if (!areSchemaActivationListsEqual(previous.schemaRefs, next.schemaRefs)) {
    summaryLines.push('Updated schema activations');
  }
  if (previous.metadata?.name !== next.metadata?.name) {
    summaryLines.push('Renamed diagram');
  } else if (stableStringify(previous.metadata) !== stableStringify(next.metadata)) {
    summaryLines.push('Updated diagram metadata');
  }
  if (entityChanges.added > 0) {
    summaryLines.push(
      `Added ${entityChanges.added} entit${entityChanges.added === 1 ? 'y' : 'ies'}`,
    );
  }
  if (entityChanges.removed > 0) {
    summaryLines.push(
      `Removed ${entityChanges.removed} entit${entityChanges.removed === 1 ? 'y' : 'ies'}`,
    );
  }
  if (entityChanges.updated > 0) {
    summaryLines.push(
      `Updated ${entityChanges.updated} entit${entityChanges.updated === 1 ? 'y' : 'ies'}`,
    );
  }
  if (relationChanges.added > 0) {
    summaryLines.push(
      `Added ${relationChanges.added} relation${relationChanges.added === 1 ? '' : 's'}`,
    );
  }
  if (relationChanges.removed > 0) {
    summaryLines.push(
      `Removed ${relationChanges.removed} relation${relationChanges.removed === 1 ? '' : 's'}`,
    );
  }
  if (relationChanges.updated > 0) {
    summaryLines.push(
      `Updated ${relationChanges.updated} relation${relationChanges.updated === 1 ? '' : 's'}`,
    );
  }

  return summaryLines;
};

export const buildDiagramCheckpointSummary = (params: {
  previousRaw?: string;
  nextRaw: string;
}): string[] => {
  const next = parseDocument(params.nextRaw);
  if (!params.previousRaw) {
    return buildInitialDiagramSummary(next);
  }

  const previous = parseDocument(params.previousRaw);
  const semanticSummary = buildSemanticSummary(previous, next);
  const viewChanged = stableStringify(previous.view) !== stableStringify(next.view);
  const presentationChanged = viewChanged;

  if (semanticSummary.length === 0 && presentationChanged) {
    return ['Updated view state'];
  }

  if (presentationChanged) {
    semanticSummary.push('Updated view state');
  }

  return semanticSummary.length > 0 ? semanticSummary : ['No effective changes'];
};

export const hasMeaningfulDiagramCheckpointChanges = (summaryLines: string[]): boolean =>
  summaryLines.some((line) => line !== 'Updated view state' && line !== 'No effective changes');
