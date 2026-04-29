import { CORE_GROUP_TYPE_ID } from './schema-ids';
import type { Entity } from './types';

export interface EntityDisplayTypeResolverContext {
  byId?: Map<string, Entity>;
  parentById?: Map<string, string | undefined>;
  childrenByParent?: Map<string, Entity[]>;
}

const getGroupMode = (entity: Entity) => {
  const props = entity.props as Record<string, unknown> | undefined;
  return typeof props?.mode === 'string' ? props.mode : undefined;
};

const getGroupType = (entity: Entity) => {
  const props = entity.props as Record<string, unknown> | undefined;
  return typeof props?.groupType === 'string' ? props.groupType : undefined;
};

const getConfiguredDisplayTypeId = (entity: Entity) => {
  if (entity.type !== CORE_GROUP_TYPE_ID) {
    return entity.type;
  }
  const mode = getGroupMode(entity);
  const groupType = getGroupType(entity);
  if (mode === 'typed' && groupType) {
    return groupType;
  }
  return entity.type;
};

const getImmediateChildren = (entity: Entity, context: EntityDisplayTypeResolverContext) =>
  context.childrenByParent?.get(entity.id) ?? entity.children ?? [];

const getParentEntity = (entity: Entity, context: EntityDisplayTypeResolverContext) => {
  const parentId = context.parentById?.get(entity.id);
  if (!parentId) return undefined;
  return context.byId?.get(parentId);
};

export const createEntityDisplayTypeResolver = (context: EntityDisplayTypeResolverContext = {}) => {
  const resolvedByEntityId = new Map<string, string>();

  const resolveMixedGroupMemberType = (entity: Entity, visiting: Set<string>) => {
    const candidateChildren = getImmediateChildren(entity, context);
    if (candidateChildren.length === 0) return undefined;

    const typeCounts = new Map<string, number>();
    const typeOrder: string[] = [];

    for (const child of candidateChildren) {
      const typeId = resolveEntityDisplayTypeId(child, visiting);
      if (!typeCounts.has(typeId)) {
        typeOrder.push(typeId);
      }
      typeCounts.set(typeId, (typeCounts.get(typeId) ?? 0) + 1);
    }

    let bestTypeId: string | undefined;
    let bestCount = -1;
    for (const typeId of typeOrder) {
      const count = typeCounts.get(typeId) ?? 0;
      if (count > bestCount) {
        bestTypeId = typeId;
        bestCount = count;
      }
    }

    return bestTypeId;
  };

  const resolveEntityDisplayTypeId = (entity: Entity, visiting = new Set<string>()): string => {
    const cached = resolvedByEntityId.get(entity.id);
    if (cached) {
      return cached;
    }

    const configuredDisplayTypeId = getConfiguredDisplayTypeId(entity);
    if (visiting.has(entity.id)) {
      return configuredDisplayTypeId;
    }

    if (entity.type !== CORE_GROUP_TYPE_ID) {
      resolvedByEntityId.set(entity.id, entity.type);
      return entity.type;
    }

    visiting.add(entity.id);
    const mode = getGroupMode(entity);
    let displayTypeId = configuredDisplayTypeId;

    if (mode === 'mixed') {
      displayTypeId = resolveMixedGroupMemberType(entity, visiting) ?? displayTypeId;
      if (displayTypeId === entity.type) {
        const parentEntity = getParentEntity(entity, context);
        if (parentEntity) {
          displayTypeId = resolveEntityDisplayTypeId(parentEntity, visiting);
        }
      }
    }

    visiting.delete(entity.id);
    resolvedByEntityId.set(entity.id, displayTypeId);
    return displayTypeId;
  };

  return resolveEntityDisplayTypeId;
};
