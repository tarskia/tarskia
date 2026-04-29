import { normalizeDiagramView, normalizeDiagramViewNodesById } from '@tarskia/diagram-semantics';
import { resolveTypeDef } from '../../model/schema';
import { FREEFORM_RELATION_TYPE, getSchemaObjectLocalId } from '../../model/schema-ids';
import type { DiagramView, Relation, SchemaModule, SemanticDocument } from '../../model/types';
import { getAncestors } from '../tree/canonical-tree';
import { buildEntityTree } from '../tree/entity-tree';

export interface DiagramSearchMatches {
  query: string;
  matchingEntityIds: Set<string>;
  matchingRelationIds: Set<string>;
  matchingRelationEndpointIds: Set<string>;
}

const normalizeQuery = (query: string) => query.trim().toLowerCase();

const buildEntitySearchText = (
  entity: SemanticDocument['entities'][number],
  schema: SchemaModule,
) =>
  [
    entity.name,
    resolveTypeDef(schema, entity.type)?.label,
    getSchemaObjectLocalId(entity.type),
    entity.type,
    entity.id,
  ]
    .filter((value): value is string => Boolean(value && value.trim().length > 0))
    .join(' ')
    .toLowerCase();

const resolveRelationDisplayLabel = (
  relation: Relation,
  relationTypeById: Map<string, SchemaModule['relations'][number]>,
) => {
  if (!relation.type) {
    return relation.label;
  }
  if (relation.type === FREEFORM_RELATION_TYPE) {
    return relation.label ?? FREEFORM_RELATION_TYPE;
  }
  const relationType = relationTypeById.get(relation.type);
  return (
    relation.label ??
    relationType?.shortLabel ??
    relationType?.label ??
    getSchemaObjectLocalId(relation.type)
  );
};

export function searchDiagramText(params: {
  doc: SemanticDocument;
  schema: SchemaModule;
  query: string;
}): DiagramSearchMatches {
  const { doc, schema } = params;
  const query = normalizeQuery(params.query);
  const entityTree = buildEntityTree(doc);
  const allEntities = [...entityTree.byId.values()]
    .filter((node) => node.id !== entityTree.rootId)
    .map((node) => node.entity);
  const matchingEntityIds = new Set<string>();
  const matchingRelationIds = new Set<string>();
  const matchingRelationEndpointIds = new Set<string>();
  if (!query) {
    return {
      query,
      matchingEntityIds,
      matchingRelationIds,
      matchingRelationEndpointIds,
    };
  }

  const entityById = new Map(allEntities.map((entity) => [entity.id, entity]));
  const entityLabelById = new Map(
    allEntities.map((entity) => [
      entity.id,
      entity.name?.trim() ||
        resolveTypeDef(schema, entity.type)?.label ||
        getSchemaObjectLocalId(entity.type),
    ]),
  );
  const relationTypeById = new Map(schema.relations.map((relation) => [relation.id, relation]));

  for (const entity of allEntities) {
    if (buildEntitySearchText(entity, schema).includes(query)) {
      matchingEntityIds.add(entity.id);
    }
  }

  for (const relation of doc.relations) {
    const sourceLabel = entityLabelById.get(relation.from) ?? relation.from;
    const targetLabel = entityLabelById.get(relation.to) ?? relation.to;
    const sourceEntity = entityById.get(relation.from);
    const targetEntity = entityById.get(relation.to);
    const relationLabel = resolveRelationDisplayLabel(relation, relationTypeById);
    const relationSearchText = [
      relation.id,
      relation.type,
      relation.type ? getSchemaObjectLocalId(relation.type) : undefined,
      relationLabel,
      sourceLabel,
      targetLabel,
      sourceEntity ? buildEntitySearchText(sourceEntity, schema) : undefined,
      targetEntity ? buildEntitySearchText(targetEntity, schema) : undefined,
      relation.from,
      relation.to,
    ]
      .filter((value): value is string => Boolean(value && value.trim().length > 0))
      .join(' ')
      .toLowerCase();
    if (!relationSearchText.includes(query)) {
      continue;
    }
    matchingRelationIds.add(relation.id);
    if (entityById.has(relation.from)) {
      matchingRelationEndpointIds.add(relation.from);
    }
    if (entityById.has(relation.to)) {
      matchingRelationEndpointIds.add(relation.to);
    }
  }

  return {
    query,
    matchingEntityIds,
    matchingRelationIds,
    matchingRelationEndpointIds,
  };
}

/**
 * Search reveal is a view operation, not a document mutation.
 * We clear scoped focus here so a whole-diagram search can reveal hidden matches.
 */
export function buildDiagramViewForSearchReveal(params: {
  doc: SemanticDocument;
  matchingEntityIds: Set<string>;
  matchingRelationIds: Set<string>;
}): DiagramView {
  const { doc, matchingEntityIds, matchingRelationIds } = params;
  const entityTree = buildEntityTree(doc);
  const view = normalizeDiagramView(doc.view);
  const nextNodesById = { ...(view.nodesById ?? {}) };
  const revealEntityIds = new Set<string>(matchingEntityIds);

  if (matchingRelationIds.size > 0) {
    for (const relation of doc.relations) {
      if (!matchingRelationIds.has(relation.id)) continue;
      if (entityTree.byId.has(relation.from)) {
        revealEntityIds.add(relation.from);
      }
      if (entityTree.byId.has(relation.to)) {
        revealEntityIds.add(relation.to);
      }
    }
  }

  for (const entityId of revealEntityIds) {
    if (!entityTree.byId.has(entityId)) continue;
    const ancestorIds = getAncestors(entityTree, entityId);
    for (const ancestorId of ancestorIds) {
      if (ancestorId === entityTree.rootId) continue;
      const ancestor = entityTree.byId.get(ancestorId);
      if (!ancestor || ancestor.children.length === 0) continue;
      nextNodesById[ancestorId] = {
        ...(nextNodesById[ancestorId] ?? {}),
        expanded: true,
        hidden: false,
      };
    }
  }

  return {
    ...view,
    scopeRootId: undefined,
    nodesById: normalizeDiagramViewNodesById(nextNodesById),
  };
}
