import type {
  DisplayConfig,
  EntityTypeDef,
  PropertySchema,
  RelationTypeDef,
  SchemaModule,
  SchemaOwner,
  TagDef,
  TraitDef,
} from './types';

const propertyKey = (property: PropertySchema) => property.id;

export function mergeSchemas(modules: SchemaModule[]): SchemaModule {
  const traitMap = new Map<string, TraitDef>();
  const tagMap = new Map<string, TagDef>();
  const typeMap = new Map<string, EntityTypeDef>();
  const relationMap = new Map<string, RelationTypeDef>();
  const versions = new Set<string>();

  for (const module of modules) {
    versions.add(module.version);
    for (const trait of module.traits ?? []) {
      traitMap.set(trait.id, trait);
    }
    for (const tag of module.tags ?? []) {
      tagMap.set(tag.id, tag);
    }
    for (const type of module.types ?? []) {
      typeMap.set(type.id, type);
    }
    for (const relation of module.relations ?? []) {
      relationMap.set(relation.id, relation);
    }
  }

  return {
    owner: 'core' as SchemaOwner,
    name: 'combined',
    version: Array.from(versions).join('+') || '0.0.0',
    traits: Array.from(traitMap.values()),
    tags: Array.from(tagMap.values()),
    types: Array.from(typeMap.values()),
    relations: Array.from(relationMap.values()),
  };
}

function mergeProperties(
  parentProps?: PropertySchema[],
  childProps?: PropertySchema[],
): PropertySchema[] | undefined {
  if (!parentProps && !childProps) return undefined;
  const map = new Map<string, PropertySchema>();
  for (const prop of parentProps ?? []) {
    map.set(propertyKey(prop), prop);
  }
  for (const prop of childProps ?? []) {
    map.set(propertyKey(prop), prop);
  }
  return Array.from(map.values());
}

function mergeDisplay(parent?: DisplayConfig, child?: DisplayConfig): DisplayConfig | undefined {
  if (!parent && !child) return undefined;
  return {
    primaryTag: child?.primaryTag ?? parent?.primaryTag,
    count: child?.count ?? parent?.count,
    defaultSize: child?.defaultSize ?? parent?.defaultSize,
    style: {
      ...parent?.style,
      ...child?.style,
    },
  };
}

function mergeAnalysis(
  parent?: EntityTypeDef['analysis'],
  child?: EntityTypeDef['analysis'],
): EntityTypeDef['analysis'] | undefined {
  if (!parent && !child) return undefined;
  return {
    topLevelBias: child?.topLevelBias ?? parent?.topLevelBias,
  };
}

function mergeContainment(
  parent?: EntityTypeDef['containment'],
  child?: EntityTypeDef['containment'],
): EntityTypeDef['containment'] | undefined {
  if (!parent && !child) return undefined;
  return child ?? parent;
}

function mergeDefaultTags(parent?: string[], child?: string[]): string[] | undefined {
  if (!parent && !child) return undefined;
  return Array.from(new Set([...(parent ?? []), ...(child ?? [])]));
}

function mergeNaming(
  parent?: EntityTypeDef['naming'],
  child?: EntityTypeDef['naming'],
): EntityTypeDef['naming'] | undefined {
  if (!parent && !child) return undefined;
  return {
    required: child?.required ?? parent?.required,
  };
}

export function resolveTypeDef(
  schema: SchemaModule,
  typeId: string,
  cache = new Map<string, EntityTypeDef>(),
): EntityTypeDef | undefined {
  if (cache.has(typeId)) return cache.get(typeId);
  const typeMap = new Map(schema.types.map((type) => [type.id, type]));
  const current = typeMap.get(typeId);
  if (!current) return undefined;

  let resolved: EntityTypeDef = { ...current };
  if (current.extends) {
    const parent = resolveTypeDef(schema, current.extends, cache);
    if (parent) {
      resolved = {
        ...parent,
        ...current,
        traits: Array.from(new Set([...(parent.traits ?? []), ...(current.traits ?? [])])),
        defaultTags: mergeDefaultTags(parent.defaultTags, current.defaultTags),
        analysis: mergeAnalysis(parent.analysis, current.analysis),
        naming: mergeNaming(parent.naming, current.naming),
        containment: mergeContainment(parent.containment, current.containment),
        display: mergeDisplay(parent.display, current.display),
        properties: mergeProperties(parent.properties, current.properties),
      };
    }
  }
  cache.set(typeId, resolved);
  return resolved;
}

export function getTypeAncestors(schema: SchemaModule, typeId: string): string[] {
  const typeMap = new Map(schema.types.map((type) => [type.id, type]));
  const ancestors: string[] = [];
  let current = typeMap.get(typeId);
  while (current) {
    ancestors.push(current.id);
    if (!current.extends) break;
    current = typeMap.get(current.extends);
  }
  return ancestors;
}

export function getTraitAncestors(schema: SchemaModule, traitId: string): string[] {
  const traitMap = new Map((schema.traits ?? []).map((trait) => [trait.id, trait] as const));
  const ancestors: string[] = [];
  let current: TraitDef | undefined = traitMap.get(traitId);
  while (current) {
    ancestors.push(current.id);
    if (!current.extends) break;
    current = traitMap.get(current.extends);
  }
  return ancestors;
}

export function getTypeTraitClosure(schema: SchemaModule, typeId: string): Set<string> {
  const traitSet = new Set<string>();
  const typeMap = new Map(schema.types.map((type) => [type.id, type]));
  let current = typeMap.get(typeId);
  while (current) {
    for (const traitId of current.traits ?? []) {
      for (const ancestor of getTraitAncestors(schema, traitId)) {
        traitSet.add(ancestor);
      }
    }
    if (!current.extends) break;
    current = typeMap.get(current.extends);
  }
  return traitSet;
}

export function typeMatches(schema: SchemaModule, typeId: string, allowed?: string[]): boolean {
  if (!allowed || allowed.length === 0) return true;
  const ancestors = new Set(getTypeAncestors(schema, typeId));
  return allowed.some((allowedType) => ancestors.has(allowedType));
}

export function traitMatches(schema: SchemaModule, typeId: string, allowed?: string[]): boolean {
  if (!allowed || allowed.length === 0) return true;
  const traitClosure = getTypeTraitClosure(schema, typeId);
  return allowed.some((allowedTrait) => traitClosure.has(allowedTrait));
}
