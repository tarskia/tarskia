import { collectDescendantIds as collectTreeDescendantIds } from '../tree/canonical-tree';
import { buildEntityTree } from '../tree/entity-tree';
import type { Entity } from './types';

const stripEntityProvenance = (entity: Entity): Entity => ({
  ...entity,
  provenance: undefined,
});

export interface EntityEntry {
  entity: Entity;
  parentId?: string;
  depth: number;
}

export interface EntityIndex {
  entries: EntityEntry[];
  byId: Map<string, Entity>;
  parentById: Map<string, string | undefined>;
  childrenByParent: Map<string, Entity[]>;
}

export function flattenEntities(entities: Entity[]): EntityEntry[] {
  const entries: EntityEntry[] = [];
  const walk = (nodes: Entity[], parentId: string | undefined, depth: number) => {
    for (const entity of nodes) {
      entries.push({ entity, parentId, depth });
      if (entity.children && entity.children.length > 0) {
        walk(entity.children, entity.id, depth + 1);
      }
    }
  };
  walk(entities, undefined, 0);
  return entries;
}

export function buildEntityIndex(entities: Entity[]): EntityIndex {
  const entries = flattenEntities(entities);
  const byId = new Map<string, Entity>();
  const parentById = new Map<string, string | undefined>();
  const childrenByParent = new Map<string, Entity[]>();

  for (const entry of entries) {
    byId.set(entry.entity.id, entry.entity);
    parentById.set(entry.entity.id, entry.parentId);
    if (entry.parentId) {
      const list = childrenByParent.get(entry.parentId) ?? [];
      list.push(entry.entity);
      childrenByParent.set(entry.parentId, list);
    }
  }

  return { entries, byId, parentById, childrenByParent };
}

export function findEntityById(entities: Entity[], id: string): Entity | undefined {
  for (const entity of entities) {
    if (entity.id === id) return entity;
    if (entity.children && entity.children.length > 0) {
      const match = findEntityById(entity.children, id);
      if (match) return match;
    }
  }
  return undefined;
}

export function updateEntityById(
  entities: Entity[],
  id: string,
  updater: (entity: Entity) => Entity,
): Entity[] {
  let changed = false;
  const walk = (nodes: Entity[]): Entity[] => {
    let branchChanged = false;
    const next = nodes.map((entity) => {
      let current = entity;
      if (entity.id === id) {
        const updated = updater(entity);
        if (updated !== entity) {
          current = updated;
          branchChanged = true;
        }
      }
      if (current.children && current.children.length > 0) {
        const nextChildren = walk(current.children);
        if (nextChildren !== current.children) {
          current = { ...current, children: nextChildren };
          branchChanged = true;
        }
      }
      return current;
    });
    if (branchChanged) {
      changed = true;
      return next;
    }
    return nodes;
  };

  const next = walk(entities);
  return changed ? next : entities;
}

export function normalizeEntityNameInput(name: string): string | undefined {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function updateEntityNameById(entities: Entity[], id: string, name: string): Entity[] {
  const normalizedName = normalizeEntityNameInput(name);
  return updateEntityById(entities, id, (entity) => {
    if (entity.name === normalizedName) return entity;
    return stripEntityProvenance({
      ...entity,
      name: normalizedName,
    });
  });
}

export function appendChildEntity(entities: Entity[], parentId: string, child: Entity): Entity[] {
  return updateEntityById(entities, parentId, (entity) => ({
    ...entity,
    children: [...(entity.children ?? []), child],
  }));
}

export function insertSiblingEntity(
  entities: Entity[],
  siblingId: string,
  newEntity: Entity,
): Entity[] {
  const index = buildEntityIndex(entities);
  const parentId = index.parentById.get(siblingId);
  if (parentId) {
    return updateEntityById(entities, parentId, (entity) => {
      const children = entity.children ?? [];
      const insertAt = children.findIndex((child) => child.id === siblingId);
      if (insertAt < 0) {
        return { ...entity, children: [...children, newEntity] };
      }
      return {
        ...entity,
        children: [...children.slice(0, insertAt + 1), newEntity, ...children.slice(insertAt + 1)],
      };
    });
  }

  const insertAt = entities.findIndex((entity) => entity.id === siblingId);
  if (insertAt < 0) return [...entities, newEntity];
  return [...entities.slice(0, insertAt + 1), newEntity, ...entities.slice(insertAt + 1)];
}

export function updateEntityPropsById(
  entities: Entity[],
  id: string,
  updater: (props: Record<string, unknown> | undefined) => Record<string, unknown> | undefined,
): Entity[] {
  return updateEntityById(entities, id, (entity) => {
    const current = entity.props as Record<string, unknown> | undefined;
    const next = updater(current);
    const normalized = next && Object.keys(next).length > 0 ? next : undefined;
    if (current === normalized) return entity;
    if (!current && !normalized) return entity;
    return stripEntityProvenance({
      ...entity,
      props: normalized,
    });
  });
}

export function setEntityPropById(
  entities: Entity[],
  id: string,
  key: string,
  value: unknown,
): Entity[] {
  const path = key
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
  if (path.length === 0) return entities;

  const setPath = (
    source: Record<string, unknown> | undefined,
    keys: string[],
    nextValue: unknown,
  ): Record<string, unknown> => {
    const next = { ...(source ?? {}) };
    const [head, ...rest] = keys;
    if (!head) return next;
    if (rest.length === 0) {
      next[head] = nextValue;
      return next;
    }
    const child =
      next[head] && typeof next[head] === 'object' && !Array.isArray(next[head])
        ? (next[head] as Record<string, unknown>)
        : undefined;
    next[head] = setPath(child, rest, nextValue);
    return next;
  };

  return updateEntityPropsById(entities, id, (props) => {
    if (value === undefined) {
      return props;
    }
    return setPath(props, path, value);
  });
}

export function removeEntityPropById(entities: Entity[], id: string, key: string): Entity[] {
  const path = key
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
  if (path.length === 0) return entities;

  const removePath = (
    source: Record<string, unknown> | undefined,
    keys: string[],
  ): Record<string, unknown> | undefined => {
    if (!source) return source;
    const [head, ...rest] = keys;
    if (!head || !(head in source)) return source;
    const next = { ...source };
    if (rest.length === 0) {
      delete next[head];
      return next;
    }
    const child = next[head];
    if (!child || typeof child !== 'object' || Array.isArray(child)) {
      return source;
    }
    const nextChild = removePath(child as Record<string, unknown>, rest);
    if (!nextChild || Object.keys(nextChild).length === 0) {
      delete next[head];
    } else {
      next[head] = nextChild;
    }
    return next;
  };

  return updateEntityPropsById(entities, id, (props) => {
    return removePath(props, path);
  });
}

export function removeEntityById(
  entities: Entity[],
  id: string,
): { entities: Entity[]; removedEntity?: Entity } {
  let removedEntity: Entity | undefined;
  let changed = false;

  const walk = (nodes: Entity[]): Entity[] => {
    let branchChanged = false;
    const next: Entity[] = [];
    for (const entity of nodes) {
      if (entity.id === id) {
        removedEntity = entity;
        branchChanged = true;
        continue;
      }
      let current = entity;
      if (entity.children && entity.children.length > 0) {
        const nextChildren = walk(entity.children);
        if (nextChildren !== entity.children) {
          current = {
            ...entity,
            children: nextChildren.length > 0 ? nextChildren : undefined,
          };
          branchChanged = true;
        }
      }
      next.push(current);
    }
    if (branchChanged) {
      changed = true;
      return next;
    }
    return nodes;
  };

  const next = walk(entities);
  return {
    entities: changed ? next : entities,
    removedEntity,
  };
}

export function moveEntityById(entities: Entity[], id: string, newParentId?: string): Entity[] {
  const initialIndex = buildEntityIndex(entities);
  if (!initialIndex.byId.has(id)) return entities;
  const currentParentId = initialIndex.parentById.get(id);
  if ((currentParentId ?? undefined) === (newParentId ?? undefined)) {
    return entities;
  }

  if (newParentId) {
    if (!initialIndex.byId.has(newParentId)) {
      // Unknown target parent should not silently re-root the node.
      return entities;
    }

    // Reject cycles (moving a node under any of its own descendants).
    let cursor: string | undefined = newParentId;
    while (cursor) {
      if (cursor === id) {
        return entities;
      }
      cursor = initialIndex.parentById.get(cursor);
    }
  }

  const { entities: withoutEntity, removedEntity } = removeEntityById(entities, id);
  if (!removedEntity) return entities;
  const movedEntity = stripEntityProvenance(removedEntity);

  if (!newParentId) {
    return [...withoutEntity, movedEntity];
  }
  return appendChildEntity(withoutEntity, newParentId, movedEntity);
}

export function duplicateEntityById(
  entities: Entity[],
  id: string,
  createEntityId: (type: string) => string,
): {
  entities: Entity[];
  duplicatedRootId?: string;
  idMap: Map<string, string>;
} {
  const index = buildEntityIndex(entities);
  const source = index.byId.get(id);
  if (!source) {
    return { entities, idMap: new Map<string, string>() };
  }

  const idMap = new Map<string, string>();
  const clone = (entity: Entity): Entity => {
    const nextId = createEntityId(entity.type);
    idMap.set(entity.id, nextId);
    return stripEntityProvenance({
      ...entity,
      id: nextId,
      children: entity.children?.map(clone),
    });
  };

  const duplicated = clone(source);
  const parentId = index.parentById.get(id);
  const nextEntities = parentId
    ? appendChildEntity(entities, parentId, duplicated)
    : [...entities, duplicated];

  return {
    entities: nextEntities,
    duplicatedRootId: duplicated.id,
    idMap,
  };
}

export function removeEntitiesWithDescendants(
  entities: Entity[],
  ids: Set<string>,
): { entities: Entity[]; removedIds: Set<string> } {
  const removedIds = new Set<string>();

  const walk = (nodes: Entity[]): Entity[] => {
    const next: Entity[] = [];
    for (const entity of nodes) {
      if (ids.has(entity.id)) {
        markRemoved(entity);
        continue;
      }
      const nextChildren = entity.children ? walk(entity.children) : undefined;
      if (nextChildren !== entity.children) {
        next.push({
          ...entity,
          children: nextChildren && nextChildren.length > 0 ? nextChildren : undefined,
        });
      } else {
        next.push(entity);
      }
    }
    return next;
  };

  const markRemoved = (node: Entity) => {
    removedIds.add(node.id);
    for (const child of node.children ?? []) {
      markRemoved(child);
    }
  };

  const next = walk(entities);
  return { entities: next, removedIds };
}

export function collectEntityDescendantIds(entities: Entity[], rootId: string): Set<string> {
  return collectTreeDescendantIds(
    buildEntityTree({
      version: '1',
      schemaRefs: [],
      entities,
      relations: [],
    }),
    rootId,
    { includeRoot: true },
  );
}
