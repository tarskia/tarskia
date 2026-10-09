import {
  buildEntityIndex,
  type Entity,
  type SchemaModule,
  type SemanticDocument,
} from '@tarskia/diagram-semantics';

export interface GraphModel {
  doc: SemanticDocument;
  schema: SchemaModule;
  entities: Entity[];
  childrenByParent: Map<string, Entity[]>;
}

export function buildGraphModel(doc: SemanticDocument, schema: SchemaModule): GraphModel {
  const index = buildEntityIndex(doc.entities);
  const entities = index.entries.map((entry) => entry.entity);

  return {
    doc,
    schema,
    entities,
    childrenByParent: index.childrenByParent,
  };
}
