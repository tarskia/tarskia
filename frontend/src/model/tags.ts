import { resolveTypeDef } from './schema';
import { CORE_GROUP_TYPE_ID, FREEFORM_RELATION_TYPE } from './schema-ids';
import type { Entity, Relation, RelationTypeDef, SchemaModule } from './types';

export function normalizeTagList(tags?: string[]) {
  return Array.from(new Set((tags ?? []).map((tag) => tag.trim()).filter((tag) => tag.length > 0)));
}

const relationTypeMapCache = new WeakMap<SchemaModule, Map<string, RelationTypeDef>>();
const relationTypeMap = (schema: SchemaModule) => {
  const cached = relationTypeMapCache.get(schema);
  if (cached) return cached;
  const map = new Map<string, RelationTypeDef>(
    schema.relations.map((relation) => [relation.id, relation]),
  );
  relationTypeMapCache.set(schema, map);
  return map;
};

const buildEffectiveTags = (params: {
  defaults?: string[];
  tags?: string[];
  removeDefaultTags?: string[];
  replaceDefaultTags?: boolean;
}) => {
  const { defaults, tags, removeDefaultTags, replaceDefaultTags } = params;
  const baseDefaults = replaceDefaultTags ? [] : normalizeTagList(defaults);
  const removed = new Set(normalizeTagList(removeDefaultTags));
  const explicit = normalizeTagList(tags);
  return Array.from(new Set(baseDefaults.filter((tag) => !removed.has(tag)).concat(explicit)));
};

export function resolveEntityEffectiveTags(schema: SchemaModule, entity: Entity): string[] {
  const typeDefaults = resolveTypeDef(schema, entity.type)?.defaultTags;
  return buildEffectiveTags({
    defaults: typeDefaults,
    tags: entity.tags,
    removeDefaultTags: entity.removeDefaultTags,
    replaceDefaultTags: entity.replaceDefaultTags,
  });
}

export function resolveDerivedGroupTags(
  schema: SchemaModule,
  entity: Entity,
  options?: { childrenByParent?: Map<string, Entity[]> },
): string[] {
  if (entity.type !== CORE_GROUP_TYPE_ID) return [];
  const props = entity.props as Record<string, unknown> | undefined;
  const mode = typeof props?.mode === 'string' ? props.mode : undefined;
  const groupType = typeof props?.groupType === 'string' ? props.groupType : undefined;

  if (mode === 'typed' && groupType) {
    const childTypeDefaults = resolveTypeDef(schema, groupType)?.defaultTags;
    return normalizeTagList(childTypeDefaults);
  }

  if (mode === 'mixed') {
    const children = options?.childrenByParent?.get(entity.id) ?? entity.children ?? [];
    const counts = new Map<string, number>();
    const firstSeen: string[] = [];
    for (const child of children) {
      const childTags = resolveEntityEffectiveTags(schema, child);
      for (const tag of childTags) {
        const next = (counts.get(tag) ?? 0) + 1;
        counts.set(tag, next);
        if (next === 1) firstSeen.push(tag);
      }
    }
    if (firstSeen.length === 0) return [];
    return [...firstSeen].sort((a, b) => {
      const byCount = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
      if (byCount !== 0) return byCount;
      return firstSeen.indexOf(a) - firstSeen.indexOf(b);
    });
  }

  return [];
}

export function resolveEntityEffectiveAndDerivedTags(
  schema: SchemaModule,
  entity: Entity,
  options?: { childrenByParent?: Map<string, Entity[]> },
): string[] {
  const effective = resolveEntityEffectiveTags(schema, entity);
  const derived = resolveDerivedGroupTags(schema, entity, options);
  return Array.from(new Set([...effective, ...derived]));
}

export function resolveRelationEffectiveTags(schema: SchemaModule, relation: Relation): string[] {
  const typeDefaults =
    relation.type && relation.type !== FREEFORM_RELATION_TYPE
      ? relationTypeMap(schema).get(relation.type)?.defaultTags
      : undefined;
  return buildEffectiveTags({
    defaults: typeDefaults,
    tags: relation.tags,
    removeDefaultTags: relation.removeDefaultTags,
    replaceDefaultTags: relation.replaceDefaultTags,
  });
}
