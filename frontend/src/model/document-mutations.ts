import { buildEntityIndex, removeEntitiesWithDescendants } from './entity-tree';
import type { SemanticDocument } from './types';

export function removeEntitiesFromDocument(
  doc: SemanticDocument,
  idsToRemove: Iterable<string>,
): SemanticDocument {
  const removedSet = new Set(idsToRemove);
  const { entities, removedIds } = removeEntitiesWithDescendants(doc.entities, removedSet);
  const remainingIds = new Set(buildEntityIndex(entities).byId.keys());
  const relations = doc.relations.filter(
    (relation) =>
      !removedIds.has(relation.from) &&
      !removedIds.has(relation.to) &&
      remainingIds.has(relation.from) &&
      remainingIds.has(relation.to),
  );

  if (entities === doc.entities && relations.length === doc.relations.length) {
    return doc;
  }
  return {
    ...doc,
    entities,
    relations,
  };
}
