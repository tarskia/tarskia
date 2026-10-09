import {
  CORE_GROUP_TYPE_ID,
  createEntityDisplayTypeResolver,
  type Entity,
  type EntityIndex,
  getSchemaObjectLocalId,
  resolveTypeDef,
  resolveTypeDisplayOptions,
  type SchemaModule,
} from '../semantic';
import type { CanvasSemanticBindings } from './view-models';

const getEntityTypeLabel = (schema: SchemaModule, entity: Entity) => {
  if (entity.type !== CORE_GROUP_TYPE_ID) {
    return resolveTypeDef(schema, entity.type)?.label ?? getSchemaObjectLocalId(entity.type);
  }
  const props = entity.props as Record<string, unknown> | undefined;
  const groupType = typeof props?.groupType === 'string' ? props.groupType : undefined;
  const typeLabel =
    (groupType ? resolveTypeDef(schema, groupType)?.label : undefined) ??
    (groupType ? getSchemaObjectLocalId(groupType) : undefined);
  return typeLabel ? `${typeLabel} Group` : 'Group';
};

const getEntityDisplayName = (schema: SchemaModule, entity: Entity) =>
  entity.name?.trim() ||
  resolveTypeDef(schema, entity.type)?.label ||
  getSchemaObjectLocalId(entity.type);

export const buildCanvasSemanticBindings = (params: {
  schema: SchemaModule;
  entityIndex: Pick<EntityIndex, 'byId' | 'parentById' | 'childrenByParent'>;
}): CanvasSemanticBindings => {
  const { schema, entityIndex } = params;
  const resolveEntityDisplayTypeId = createEntityDisplayTypeResolver({
    byId: entityIndex.byId,
    parentById: entityIndex.parentById,
    childrenByParent: entityIndex.childrenByParent,
  });

  return {
    getEntityDisplayName: (entityId) => {
      const entity = entityIndex.byId.get(entityId);
      return entity ? getEntityDisplayName(schema, entity) : entityId;
    },
    getEntityTypeLabel: (entityId) => {
      const entity = entityIndex.byId.get(entityId);
      return entity ? getEntityTypeLabel(schema, entity) : entityId;
    },
    getEntityFocusHue: (entityId) => {
      const entity = entityIndex.byId.get(entityId);
      if (!entity) return undefined;
      const typeHue = resolveTypeDisplayOptions(
        resolveTypeDef(schema, resolveEntityDisplayTypeId(entity)),
      ).hue;
      return typeof typeHue === 'number' ? typeHue : undefined;
    },
  };
};
