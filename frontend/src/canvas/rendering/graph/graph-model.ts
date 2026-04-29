import { buildEntityIndex } from '../../../model/entity-tree';
import type { Entity, RelationTypeDef, SchemaModule, SemanticDocument } from '../../../model/types';

export interface GraphModel {
  doc: SemanticDocument;
  schema: SchemaModule;
  entities: Entity[];
  entityMap: Map<string, Entity>;
  parentById: Map<string, string | undefined>;
  childrenByParent: Map<string, Entity[]>;
  relationTypeById: Map<string, RelationTypeDef>;
  topLevelEntities: Entity[];
  topLevelIds: Set<string>;
}

export function buildGraphModel(doc: SemanticDocument, schema: SchemaModule): GraphModel {
  const index = buildEntityIndex(doc.entities);
  const entities = index.entries.map((entry) => entry.entity);
  const entityMap = index.byId;
  const relationTypeById = new Map(schema.relations.map((relation) => [relation.id, relation]));
  const topLevelEntities = [...doc.entities];
  const topLevelIds = new Set(topLevelEntities.map((entity) => entity.id));

  return {
    doc,
    schema,
    entities,
    entityMap,
    parentById: index.parentById,
    childrenByParent: index.childrenByParent,
    relationTypeById,
    topLevelEntities,
    topLevelIds,
  };
}
