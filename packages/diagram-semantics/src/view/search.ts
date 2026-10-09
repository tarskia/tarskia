import { resolveTypeDef } from '../model/schema';
import { getSchemaObjectLocalId } from '../model/schema-ids';
import type { DiagramView, SchemaModule, SemanticDocument } from '../model/types';
import { buildEntityTree } from '../tree/entity-tree';
import { resolveRelationDisplayLabel } from './display-labels';
import { normalizeDiagramView } from './normalize-diagram-view';
import { applyDiagramViewOperation } from './view-operations';

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

export function buildDiagramViewForSearchReveal(params: {
  doc: SemanticDocument;
  matchingEntityIds: Set<string>;
  matchingRelationIds: Set<string>;
}): DiagramView {
  return (
    applyDiagramViewOperation(buildEntityTree(params.doc), params.doc.view, {
      kind: 'search-reveal',
      entityIds: params.matchingEntityIds,
      relationIds: params.matchingRelationIds,
      relations: params.doc.relations,
    }) ?? normalizeDiagramView(params.doc.view)
  );
}
