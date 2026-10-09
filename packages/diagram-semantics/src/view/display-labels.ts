import { FREEFORM_RELATION_TYPE, getSchemaObjectLocalId } from '../model/schema-ids';
import type { Relation, SchemaModule } from '../model/types';
export const resolveRelationDisplayLabel = (
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

export const pluralize = (label: string, count: number) => {
  const base = label.toLowerCase();
  return count === 1 || base.endsWith('s') ? base : `${base}s`;
};
