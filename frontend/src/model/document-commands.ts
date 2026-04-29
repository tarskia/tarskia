import {
  appendChildEntity,
  buildEntityIndex,
  duplicateEntityById,
  insertSiblingEntity,
  moveEntityById,
  removeEntityPropById,
  setEntityPropById,
  updateEntityById,
  updateEntityNameById,
} from './entity-tree';
import type { Entity, SemanticDocument } from './types';

const normalizeTagIds = (tags?: string[]) => {
  const normalized = Array.from(new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean)));
  return normalized.length > 0 ? normalized : undefined;
};

export function addEntityToDocument({
  doc,
  typeId,
  parentId,
  name,
  createEntityId,
  resolveEntityName,
  canContainEntity,
}: {
  doc: SemanticDocument;
  typeId: string;
  parentId?: string;
  name?: string;
  createEntityId: (typeId: string) => string;
  resolveEntityName: (
    typeId: string,
    requestedName: string | undefined,
    existingCount: number,
  ) => string | undefined;
  canContainEntity: (parent: Entity, childType: string) => boolean;
}): { doc: SemanticDocument; createdEntityId: string } {
  const id = createEntityId(typeId);
  const index = buildEntityIndex(doc.entities);
  const count = index.entries.length;
  const parentEntity = parentId ? index.byId.get(parentId) : undefined;
  const resolvedParentId =
    parentEntity && canContainEntity(parentEntity, typeId) ? parentId : undefined;
  const newEntity: Entity = {
    id,
    type: typeId,
    name: resolveEntityName(typeId, name, count),
  };

  const entities = resolvedParentId
    ? appendChildEntity(doc.entities, resolvedParentId, newEntity)
    : [...doc.entities, newEntity];

  return {
    doc: {
      ...doc,
      entities,
      relations: doc.relations,
    },
    createdEntityId: id,
  };
}

export function insertSiblingEntityInDocument({
  doc,
  siblingId,
  typeId,
  name,
  createEntityId,
  resolveEntityName,
}: {
  doc: SemanticDocument;
  siblingId: string;
  typeId: string;
  name?: string;
  createEntityId: (typeId: string) => string;
  resolveEntityName: (
    typeId: string,
    requestedName: string | undefined,
    existingCount: number,
  ) => string | undefined;
}): { doc: SemanticDocument; createdEntityId: string } {
  const id = createEntityId(typeId);
  const count = buildEntityIndex(doc.entities).entries.length;
  const newEntity: Entity = {
    id,
    type: typeId,
    name: resolveEntityName(typeId, name, count),
  };
  return {
    doc: {
      ...doc,
      entities: insertSiblingEntity(doc.entities, siblingId, newEntity),
    },
    createdEntityId: id,
  };
}

export function duplicateEntityInDocument({
  doc,
  entityId,
  createEntityId,
}: {
  doc: SemanticDocument;
  entityId: string;
  createEntityId: (typeId: string) => string;
}): { doc: SemanticDocument; duplicatedEntityId?: string } {
  const duplicated = duplicateEntityById(doc.entities, entityId, createEntityId);
  const duplicatedId = duplicated.duplicatedRootId;
  if (!duplicatedId) {
    return { doc, duplicatedEntityId: undefined };
  }
  const duplicatedRelations = doc.relations.flatMap((relation) => {
    const from = duplicated.idMap.get(relation.from);
    const to = duplicated.idMap.get(relation.to);
    if (!from || !to) return [];
    return [
      {
        ...relation,
        id: createEntityId('rel'),
        from,
        to,
        provenance: undefined,
      },
    ];
  });

  return {
    doc: {
      ...doc,
      entities: duplicated.entities,
      relations: doc.relations.concat(duplicatedRelations),
    },
    duplicatedEntityId: duplicatedId,
  };
}

export function moveEntityInDocument(
  doc: SemanticDocument,
  entityId: string,
  parentId?: string,
): SemanticDocument {
  return {
    ...doc,
    entities: moveEntityById(doc.entities, entityId, parentId),
  };
}

export function setEntityPropInDocument(
  doc: SemanticDocument,
  entityId: string,
  key: string,
  value: unknown,
): SemanticDocument {
  return {
    ...doc,
    entities: setEntityPropById(doc.entities, entityId, key, value),
  };
}

export function removeEntityPropInDocument(
  doc: SemanticDocument,
  entityId: string,
  key: string,
): SemanticDocument {
  return {
    ...doc,
    entities: removeEntityPropById(doc.entities, entityId, key),
  };
}

export function updateEntityNameInDocument(
  doc: SemanticDocument,
  entityId: string,
  name: string,
): SemanticDocument {
  return {
    ...doc,
    entities: updateEntityNameById(doc.entities, entityId, name),
  };
}

export function updateEntityTagsInDocument(
  doc: SemanticDocument,
  entityId: string,
  tags: string[] | undefined,
): SemanticDocument {
  const normalizedTags = normalizeTagIds(tags);
  return {
    ...doc,
    entities: updateEntityById(doc.entities, entityId, (entity) => {
      const current = normalizeTagIds(entity.tags);
      const unchanged = (current ?? []).join('\n') === (normalizedTags ?? []).join('\n');
      if (unchanged) return entity;
      return {
        ...entity,
        tags: normalizedTags,
        provenance: undefined,
      };
    }),
  };
}

export function addRelationToDocument({
  doc,
  relationId,
  from,
  to,
}: {
  doc: SemanticDocument;
  relationId: string;
  from: string;
  to: string;
}): SemanticDocument {
  return {
    ...doc,
    relations: doc.relations.concat({
      id: relationId,
      from,
      to,
      state: 'undecided',
    }),
  };
}
