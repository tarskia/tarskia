import { type Diagnostic, diagnosticFingerprint, schemaDiagnostic } from './diagnostics';
import { mergeSchemas } from './schema';
import {
  buildQualifiedSchemaObjectId,
  isQualifiedSchemaObjectId,
  type SchemaObjectSection,
} from './schema-ids';
import {
  buildDefaultSchemaActivation,
  buildSchemaActivationMap,
  buildSchemaId,
  getSchemaModuleRef,
  parseSchemaRef,
} from './schema-ref';
import { parseSchemaId, resolveSchemaModules } from './schema-selection';
import { compileSchemaSemantics, type SchemaSemantics } from './schema-semantics';
import type {
  EntityTypeDef,
  RelationTypeDef,
  SchemaActivation,
  SchemaModule,
  SchemaUpdate,
  TagDef,
  TraitDef,
} from './types';

export interface RawSchemaSet {
  moduleIds: string[];
  modulesById: Map<string, SchemaModule>;
}

export interface SchemaSelection {
  rootModuleIds: string[];
  activationsByModuleId: Map<string, SchemaActivation>;
  rootActivations: SchemaActivation[];
}

export interface ResolvedSchemaSet {
  rootModuleIds: string[];
  rootActivations: SchemaActivation[];
  resolvedModuleIds: string[];
  resolvedModules: SchemaModule[];
  effectiveSchema: SchemaModule;
  diagnostics: Diagnostic[];
}

export interface SchemaIndexes {
  typesById: Map<string, EntityTypeDef>;
  relationsById: Map<string, RelationTypeDef>;
  traitsById: Map<string, TraitDef>;
  tagsById: Map<string, TagDef>;
}

export interface SchemaRuntime {
  raw: RawSchemaSet;
  selection: SchemaSelection;
  resolved: ResolvedSchemaSet;
  indexes: SchemaIndexes;
  semantics: SchemaSemantics;
}

type TopLevelSection = SchemaObjectSection;
type TopLevelItem = EntityTypeDef | RelationTypeDef | TraitDef | TagDef;

type UpdateSelectorKind = 'object' | 'properties' | 'property';

interface ParsedUpdateSelector {
  alias: string;
  section: TopLevelSection;
  id: string;
  kind: UpdateSelectorKind;
  propertyId?: string;
}

interface ParsedRemoveSelectorCollection {
  alias: string;
  kind: 'collection';
  section: TopLevelSection;
}

interface ParsedRemoveSelectorProperties {
  alias: string;
  kind: 'properties';
  section: 'types' | 'relations';
  id: string;
}

type ParsedRemoveSelector = ParsedRemoveSelectorCollection | ParsedRemoveSelectorProperties;

const REFERENCE_LIST_PATHS = new Set([
  'traits',
  'defaultTags',
  'analysis.expectedRelationIds',
  'containment.allowedChildTypes',
  'containment.allowedChildTraits',
  'display.count.childTypes',
]);

const isReferencePath = (path: string) => path === 'extends' || path === 'display.primaryTag';
const isReferenceListPath = (path: string) => REFERENCE_LIST_PATHS.has(path);

const deepClone = <T>(value: T): T => {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const asMutableRecord = (value: unknown): Record<string, unknown> =>
  value as unknown as Record<string, unknown>;
const getItemProperties = (value: EntityTypeDef | RelationTypeDef) => value.properties;

const asArray = <T>(value: T | T[]) => (Array.isArray(value) ? value : [value]);

const parseAliasRef = (value: string): { alias: string; localId: string } | null => {
  if (isQualifiedSchemaObjectId(value)) return null;
  const dot = value.indexOf('.');
  if (dot <= 0 || dot === value.length - 1) return null;
  return {
    alias: value.slice(0, dot),
    localId: value.slice(dot + 1),
  };
};

const getModuleId = (module: SchemaModule) => getSchemaModuleRef(module);

const qualifyLocalRef = (schemaId: string, section: TopLevelSection, value: string) =>
  isQualifiedSchemaObjectId(value) ? value : buildQualifiedSchemaObjectId(schemaId, section, value);

const qualifyLocalRefList = (
  schemaId: string,
  section: TopLevelSection,
  refs?: string[],
): string[] | undefined => refs?.map((ref) => qualifyLocalRef(schemaId, section, ref));

const splitPath = (path: string) => path.split('.').filter((segment) => segment.length > 0);

const immutableFieldError = (
  section: TopLevelSection,
  selectorKind: UpdateSelectorKind,
  path: string,
): string | undefined => {
  const first = splitPath(path)[0];
  if (!first) return undefined;
  if (first === 'id') {
    return `Cannot update immutable field "id" (${section})`;
  }
  if (
    selectorKind !== 'property' &&
    first === 'extends' &&
    (section === 'types' || section === 'traits')
  ) {
    return `Cannot update immutable field "extends" (${section})`;
  }
  return undefined;
};

const pushResolutionError = (
  diagnostics: Diagnostic[],
  message: string,
  context?: Partial<Diagnostic>,
) => {
  diagnostics.push(
    schemaDiagnostic({
      phase: 'resolution',
      severity: 'error',
      code: 'schema.resolution.patch_error',
      message,
      ...context,
    }),
  );
};

const isTopLevelSection = (value: string): value is TopLevelSection =>
  value === 'types' || value === 'relations' || value === 'traits' || value === 'tags';

const getCollection = (module: SchemaModule, section: TopLevelSection) => {
  if (section === 'types') return module.types;
  if (section === 'relations') return module.relations;
  if (section === 'traits') return module.traits ?? [];
  return module.tags ?? [];
};

const setCollection = (
  module: SchemaModule,
  section: TopLevelSection,
  values: TopLevelItem[],
): void => {
  if (section === 'types') {
    module.types = values as EntityTypeDef[];
    return;
  }
  if (section === 'relations') {
    module.relations = values as RelationTypeDef[];
    return;
  }
  if (section === 'traits') {
    module.traits = values as TraitDef[];
    return;
  }
  module.tags = values as TagDef[];
};

const parseUpdateSelector = (selector: string): ParsedUpdateSelector | undefined => {
  const parts = selector.split('.');
  if (parts.length === 3 && parts[0] && isTopLevelSection(parts[1]) && parts[2]) {
    return { alias: parts[0], section: parts[1], id: parts[2], kind: 'object' };
  }
  if (
    parts.length === 4 &&
    parts[0] &&
    isTopLevelSection(parts[1]) &&
    parts[2] &&
    parts[3] === 'properties'
  ) {
    return { alias: parts[0], section: parts[1], id: parts[2], kind: 'properties' };
  }
  if (
    parts.length === 5 &&
    parts[0] &&
    isTopLevelSection(parts[1]) &&
    parts[2] &&
    parts[3] === 'properties' &&
    parts[4]
  ) {
    return {
      alias: parts[0],
      section: parts[1],
      id: parts[2],
      kind: 'property',
      propertyId: parts[4],
    };
  }
  return undefined;
};

const parseRemoveSelector = (selector: string): ParsedRemoveSelector | undefined => {
  const parts = selector.split('.');
  if (parts.length === 2 && parts[0] && isTopLevelSection(parts[1])) {
    return { alias: parts[0], kind: 'collection', section: parts[1] };
  }
  if (
    parts.length === 4 &&
    parts[0] &&
    (parts[1] === 'types' || parts[1] === 'relations') &&
    parts[2] &&
    parts[3] === 'properties'
  ) {
    return { alias: parts[0], kind: 'properties', section: parts[1], id: parts[2] };
  }
  return undefined;
};

const getPathValue = (target: unknown, path: string): unknown => {
  let current: unknown = target;
  for (const segment of splitPath(path)) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
};

const setPathValue = (target: unknown, path: string, value: unknown): boolean => {
  const segments = splitPath(path);
  if (segments.length === 0 || !isRecord(target)) return false;
  let current: Record<string, unknown> = target;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (!isRecord(next)) {
      current[segment] = {};
    }
    const resolved = current[segment];
    if (!isRecord(resolved)) return false;
    current = resolved;
  }
  current[segments[segments.length - 1] as string] = deepClone(value);
  return true;
};

const arrayHasIdObjects = (values: unknown[]) =>
  values.some((entry) => isRecord(entry) && typeof entry.id === 'string');

const patchValueEquals = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => patchValueEquals(value, right[index]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] && patchValueEquals(left[key], right[key as keyof typeof right]),
      )
    );
  }
  return false;
};

const addToArray = (targetArray: unknown[], values: unknown[]): unknown[] => {
  const next = [...targetArray];
  const hasIdObjects =
    arrayHasIdObjects(next) ||
    values.some((value) => isRecord(value) && typeof value.id === 'string');
  if (hasIdObjects) {
    for (const value of values) {
      if (!isRecord(value) || typeof value.id !== 'string') continue;
      const index = next.findIndex(
        (candidate) =>
          isRecord(candidate) && typeof candidate.id === 'string' && candidate.id === value.id,
      );
      const cloned = deepClone(value);
      if (index >= 0) {
        next[index] = cloned;
      } else {
        next.push(cloned);
      }
    }
    return next;
  }
  for (const value of values) {
    if (!next.some((candidate) => Object.is(candidate, value))) {
      next.push(deepClone(value));
    }
  }
  return next;
};

const removeFromArray = (targetArray: unknown[], values: unknown[]): unknown[] => {
  if (values.length === 0) return targetArray;
  return targetArray.filter((entry) => {
    for (const value of values) {
      if (isRecord(entry) && typeof entry.id === 'string' && typeof value === 'string') {
        if (entry.id === value) return false;
      } else if (patchValueEquals(entry, value)) {
        return false;
      }
    }
    return true;
  });
};

const resolveAliasMap = (sourceModule: SchemaModule): Map<string, string> => {
  const aliasMap = new Map<string, string>();
  for (const entry of sourceModule.use ?? []) {
    if (!entry.alias) continue;
    aliasMap.set(entry.alias, parseSchemaId(entry.schema));
  }
  return aliasMap;
};

const resolveAliasedRef = ({
  sourceModule,
  targetModulesById,
  aliases,
  value,
  expectedSection,
  errors,
}: {
  sourceModule: SchemaModule;
  targetModulesById: Map<string, SchemaModule>;
  aliases: Map<string, string>;
  value: string;
  expectedSection: TopLevelSection;
  errors: Diagnostic[];
}): string => {
  const parsed = parseAliasRef(value);
  if (!parsed) return value;
  const targetModuleId = aliases.get(parsed.alias);
  if (!targetModuleId) return value;
  const targetModule = targetModulesById.get(targetModuleId);
  if (!targetModule) {
    pushResolutionError(
      errors,
      `Schema ${getModuleId(sourceModule)} references unknown module alias target: ${parsed.alias} (${targetModuleId})`,
      {
        moduleId: getModuleId(sourceModule),
      },
    );
    return value;
  }
  const hasId = getCollection(targetModule, expectedSection).some(
    (item) => item.id === parsed.localId,
  );
  if (!hasId) {
    pushResolutionError(
      errors,
      `Schema ${getModuleId(sourceModule)} references missing ${expectedSection.slice(0, -1)} "${parsed.localId}" via ${parsed.alias}`,
      {
        moduleId: getModuleId(sourceModule),
      },
    );
    return value;
  }
  return buildQualifiedSchemaObjectId(targetModuleId, expectedSection, parsed.localId);
};

const resolveModuleReference = ({
  sourceModule,
  targetModulesById,
  aliases,
  value,
  expectedSection,
  errors,
}: {
  sourceModule: SchemaModule;
  targetModulesById: Map<string, SchemaModule>;
  aliases: Map<string, string>;
  value: string;
  expectedSection: TopLevelSection;
  errors: Diagnostic[];
}): string => {
  if (isQualifiedSchemaObjectId(value)) return value;
  const aliased = resolveAliasedRef({
    sourceModule,
    targetModulesById,
    aliases,
    value,
    expectedSection,
    errors,
  });
  if (aliased !== value) {
    return aliased;
  }
  if (getCollection(sourceModule, expectedSection).some((item) => item.id === value)) {
    return value;
  }
  const matches = Array.from(targetModulesById.entries())
    .filter(([moduleId]) => moduleId !== getModuleId(sourceModule))
    .filter(([, module]) =>
      getCollection(module, expectedSection).some((item) => item.id === value),
    )
    .map(([moduleId]) => moduleId);
  if (matches.length === 1) {
    return buildQualifiedSchemaObjectId(matches[0] as string, expectedSection, value);
  }
  if (matches.length > 1) {
    pushResolutionError(
      errors,
      `Schema ${getModuleId(sourceModule)} references ambiguous ${expectedSection.slice(0, -1)} "${value}"`,
      {
        moduleId: getModuleId(sourceModule),
      },
    );
  }
  return value;
};

const normalizeRefList = ({
  sourceModule,
  targetModulesById,
  aliases,
  refs,
  expectedSection,
  errors,
}: {
  sourceModule: SchemaModule;
  targetModulesById: Map<string, SchemaModule>;
  aliases: Map<string, string>;
  refs?: string[];
  expectedSection: TopLevelSection;
  errors: Diagnostic[];
}) =>
  refs?.map((ref) =>
    resolveModuleReference({
      sourceModule,
      targetModulesById,
      aliases,
      value: ref,
      expectedSection,
      errors,
    }),
  );

const normalizeModuleReferences = ({
  sourceModule,
  module,
  targetModulesById,
  aliases,
  errors,
}: {
  sourceModule: SchemaModule;
  module: SchemaModule;
  targetModulesById: Map<string, SchemaModule>;
  aliases: Map<string, string>;
  errors: Diagnostic[];
}) => {
  for (const trait of module.traits ?? []) {
    if (trait.extends) {
      trait.extends = resolveModuleReference({
        sourceModule,
        targetModulesById,
        aliases,
        value: trait.extends,
        expectedSection: 'traits',
        errors,
      });
    }
    if (trait.analysis?.expectedRelationIds) {
      trait.analysis.expectedRelationIds = normalizeRefList({
        sourceModule,
        targetModulesById,
        aliases,
        refs: trait.analysis.expectedRelationIds,
        expectedSection: 'relations',
        errors,
      });
    }
    trait.relationParticipation = trait.relationParticipation?.map((entry) => ({
      ...entry,
      relation: resolveModuleReference({
        sourceModule,
        targetModulesById,
        aliases,
        value: entry.relation,
        expectedSection: 'relations',
        errors,
      }),
    }));
  }
  for (const type of module.types) {
    if (type.extends) {
      type.extends = resolveModuleReference({
        sourceModule,
        targetModulesById,
        aliases,
        value: type.extends,
        expectedSection: 'types',
        errors,
      });
    }
    type.traits = normalizeRefList({
      sourceModule,
      targetModulesById,
      aliases,
      refs: type.traits,
      expectedSection: 'traits',
      errors,
    });
    type.defaultTags = normalizeRefList({
      sourceModule,
      targetModulesById,
      aliases,
      refs: type.defaultTags,
      expectedSection: 'tags',
      errors,
    });
    if (type.containment) {
      type.containment.allowedChildTypes = normalizeRefList({
        sourceModule,
        targetModulesById,
        aliases,
        refs: type.containment.allowedChildTypes,
        expectedSection: 'types',
        errors,
      });
      type.containment.allowedChildTraits = normalizeRefList({
        sourceModule,
        targetModulesById,
        aliases,
        refs: type.containment.allowedChildTraits,
        expectedSection: 'traits',
        errors,
      });
    }
    if (type.display?.count) {
      type.display.count.childTypes =
        normalizeRefList({
          sourceModule,
          targetModulesById,
          aliases,
          refs: type.display.count.childTypes,
          expectedSection: 'types',
          errors,
        }) ?? [];
    }
    if (type.display?.primaryTag) {
      type.display.primaryTag = resolveModuleReference({
        sourceModule,
        targetModulesById,
        aliases,
        value: type.display.primaryTag,
        expectedSection: 'tags',
        errors,
      });
    }
  }
  for (const relation of module.relations) {
    relation.defaultTags = normalizeRefList({
      sourceModule,
      targetModulesById,
      aliases,
      refs: relation.defaultTags,
      expectedSection: 'tags',
      errors,
    });
  }
};

const resolveRefValueForPath = ({
  sourceModule,
  targetModulesById,
  aliases,
  path,
  value,
  section,
  errors,
}: {
  sourceModule: SchemaModule;
  targetModulesById: Map<string, SchemaModule>;
  aliases: Map<string, string>;
  path: string;
  value: unknown;
  section: TopLevelSection;
  errors: Diagnostic[];
}) => {
  const expectedSection =
    path === 'display.primaryTag'
      ? 'tags'
      : path === 'extends'
        ? section === 'traits'
          ? 'traits'
          : 'types'
        : path.includes('Trait')
          ? 'traits'
          : path.includes('Tag')
            ? 'tags'
            : 'types';
  if (typeof value === 'string') {
    return resolveAliasedRef({
      sourceModule,
      targetModulesById,
      aliases,
      value,
      expectedSection,
      errors,
    });
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      typeof entry === 'string'
        ? resolveAliasedRef({
            sourceModule,
            targetModulesById,
            aliases,
            value: entry,
            expectedSection,
            errors,
          })
        : entry,
    );
  }
  return value;
};

const applyPathArrayMutation = ({
  sourceModule,
  targetModulesById,
  aliases,
  target,
  path,
  value,
  mode,
  section,
  errors,
}: {
  sourceModule: SchemaModule;
  targetModulesById: Map<string, SchemaModule>;
  aliases: Map<string, string>;
  target: Record<string, unknown>;
  path: string;
  value: unknown;
  mode: 'add' | 'remove';
  section: TopLevelSection;
  errors: Diagnostic[];
}) => {
  const resolvedPath = splitPath(path).join('.');
  const existing = getPathValue(target, resolvedPath);
  if (existing !== undefined && !Array.isArray(existing)) {
    pushResolutionError(errors, `Cannot ${mode} non-array path "${resolvedPath}"`);
    return;
  }
  const normalizedInput = isReferenceListPath(resolvedPath)
    ? resolveRefValueForPath({
        sourceModule,
        targetModulesById,
        aliases,
        path: resolvedPath,
        value,
        section,
        errors,
      })
    : resolvedPath.endsWith('relationParticipation')
      ? asArray(value).map((entry) => {
          if (!isRecord(entry) || typeof entry.relation !== 'string') {
            return entry;
          }
          return {
            ...entry,
            relation: resolveAliasedRef({
              sourceModule,
              targetModulesById,
              aliases,
              value: entry.relation,
              expectedSection: 'relations',
              errors,
            }),
          };
        })
      : value;
  const values = asArray(normalizedInput);
  const next =
    mode === 'add'
      ? addToArray((existing as unknown[]) ?? [], values)
      : removeFromArray((existing as unknown[]) ?? [], values);
  setPathValue(target, resolvedPath, next);
};

const applyUpdateOperations = ({
  sourceModule,
  targetModulesById,
  aliases,
  selector,
  section,
  target,
  operation,
  errors,
}: {
  sourceModule: SchemaModule;
  targetModulesById: Map<string, SchemaModule>;
  aliases: Map<string, string>;
  selector: ParsedUpdateSelector;
  section: TopLevelSection;
  target: Record<string, unknown>;
  operation: SchemaUpdate;
  errors: Diagnostic[];
}) => {
  const mapSelectorPath = (path: string) => {
    if (selector.kind !== 'properties') return path;
    if (path === 'properties' || path.startsWith('properties.')) return path;
    return `properties.${path}`;
  };

  for (const [path, value] of Object.entries(operation.set ?? {})) {
    const actualPath = mapSelectorPath(path);
    const immutableError = immutableFieldError(section, selector.kind, actualPath);
    if (immutableError) {
      pushResolutionError(errors, immutableError);
      continue;
    }
    const normalizedValue =
      isReferenceListPath(actualPath) || isReferencePath(actualPath)
        ? resolveRefValueForPath({
            sourceModule,
            targetModulesById,
            aliases,
            path: actualPath,
            value,
            section,
            errors,
          })
        : value;
    if (!setPathValue(target, actualPath, normalizedValue)) {
      pushResolutionError(
        errors,
        `Cannot set path "${actualPath}" on selector ${selector.alias}.${selector.id}`,
      );
    }
  }

  for (const [path, value] of Object.entries(operation.add ?? {})) {
    const actualPath = mapSelectorPath(path);
    applyPathArrayMutation({
      sourceModule,
      targetModulesById,
      aliases,
      target,
      path: actualPath,
      value,
      mode: 'add',
      section,
      errors,
    });
  }

  for (const [path, value] of Object.entries(operation.remove ?? {})) {
    const actualPath = mapSelectorPath(path);
    applyPathArrayMutation({
      sourceModule,
      targetModulesById,
      aliases,
      target,
      path: actualPath,
      value,
      mode: 'remove',
      section,
      errors,
    });
  }
};

const applySchemaUpdate = ({
  sourceModule,
  targetModulesById,
  aliases,
  selectorKey,
  operation,
  errors,
}: {
  sourceModule: SchemaModule;
  targetModulesById: Map<string, SchemaModule>;
  aliases: Map<string, string>;
  selectorKey: string;
  operation: SchemaUpdate;
  errors: Diagnostic[];
}) => {
  const parsed = parseUpdateSelector(selectorKey);
  if (!parsed) {
    pushResolutionError(errors, `Invalid update selector: ${selectorKey}`, {
      moduleId: getModuleId(sourceModule),
      selector: selectorKey,
    });
    return;
  }
  const targetModuleId = aliases.get(parsed.alias);
  if (!targetModuleId) {
    pushResolutionError(
      errors,
      `Unknown update selector alias "${parsed.alias}" in ${getModuleId(sourceModule)}`,
      {
        moduleId: getModuleId(sourceModule),
        selector: selectorKey,
      },
    );
    return;
  }
  const targetModule = targetModulesById.get(targetModuleId);
  if (!targetModule) {
    pushResolutionError(
      errors,
      `Selector alias "${parsed.alias}" resolved to missing module ${targetModuleId}`,
      {
        moduleId: getModuleId(sourceModule),
        selector: selectorKey,
      },
    );
    return;
  }

  const collection = getCollection(targetModule, parsed.section);
  const targetItem = collection.find((item) => item.id === parsed.id);
  if (!targetItem) {
    pushResolutionError(errors, `Update selector target not found: ${selectorKey}`, {
      moduleId: getModuleId(sourceModule),
      selector: selectorKey,
    });
    return;
  }

  if (
    (parsed.kind === 'properties' || parsed.kind === 'property') &&
    parsed.section !== 'types' &&
    parsed.section !== 'relations'
  ) {
    pushResolutionError(
      errors,
      `Properties selector only applies to types or relations: ${selectorKey}`,
      {
        moduleId: getModuleId(sourceModule),
        selector: selectorKey,
      },
    );
    return;
  }

  if (parsed.kind === 'property') {
    const properties = getItemProperties(targetItem as EntityTypeDef | RelationTypeDef);
    const property = properties?.find((entry) => entry.id === parsed.propertyId);
    if (!property) {
      pushResolutionError(errors, `Property selector target not found: ${selectorKey}`, {
        moduleId: getModuleId(sourceModule),
        selector: selectorKey,
      });
      return;
    }
    applyUpdateOperations({
      sourceModule,
      targetModulesById,
      aliases,
      selector: parsed,
      section: parsed.section,
      target: asMutableRecord(property),
      operation,
      errors,
    });
    return;
  }

  applyUpdateOperations({
    sourceModule,
    targetModulesById,
    aliases,
    selector: parsed,
    section: parsed.section,
    target: asMutableRecord(targetItem),
    operation,
    errors,
  });
};

const applySchemaRemoval = ({
  sourceModule,
  targetModulesById,
  aliases,
  selectorKey,
  ids,
  errors,
}: {
  sourceModule: SchemaModule;
  targetModulesById: Map<string, SchemaModule>;
  aliases: Map<string, string>;
  selectorKey: string;
  ids: string[];
  errors: Diagnostic[];
}) => {
  const parsed = parseRemoveSelector(selectorKey);
  if (!parsed) {
    pushResolutionError(errors, `Invalid remove selector: ${selectorKey}`, {
      moduleId: getModuleId(sourceModule),
      selector: selectorKey,
    });
    return;
  }
  const targetModuleId = aliases.get(parsed.alias);
  if (!targetModuleId) {
    pushResolutionError(
      errors,
      `Unknown remove selector alias "${parsed.alias}" in ${getModuleId(sourceModule)}`,
      {
        moduleId: getModuleId(sourceModule),
        selector: selectorKey,
      },
    );
    return;
  }
  const targetModule = targetModulesById.get(targetModuleId);
  if (!targetModule) {
    pushResolutionError(
      errors,
      `Selector alias "${parsed.alias}" resolved to missing module ${targetModuleId}`,
      {
        moduleId: getModuleId(sourceModule),
        selector: selectorKey,
      },
    );
    return;
  }

  if (parsed.kind === 'collection') {
    const collection = getCollection(targetModule, parsed.section);
    setCollection(
      targetModule,
      parsed.section,
      collection.filter((item) => !ids.includes(item.id)),
    );
    return;
  }

  const collection = getCollection(targetModule, parsed.section);
  const target = collection.find((item) => item.id === parsed.id);
  if (!target || (parsed.section !== 'types' && parsed.section !== 'relations')) {
    pushResolutionError(errors, `Remove selector target not found: ${selectorKey}`, {
      moduleId: getModuleId(sourceModule),
      selector: selectorKey,
    });
    return;
  }
  const properties = getItemProperties(target as EntityTypeDef | RelationTypeDef);
  if (!properties) {
    return;
  }
  (target as EntityTypeDef | RelationTypeDef).properties = properties.filter(
    (property) => !ids.includes(property.id),
  );
};

const applyModuleSchemaOperations = ({
  sourceModule,
  targetModulesById,
  errors,
}: {
  sourceModule: SchemaModule;
  targetModulesById: Map<string, SchemaModule>;
  errors: Diagnostic[];
}) => {
  const aliases = resolveAliasMap(sourceModule);
  normalizeModuleReferences({
    sourceModule,
    module: sourceModule,
    targetModulesById,
    aliases,
    errors,
  });
  for (const [selectorKey, operation] of Object.entries(sourceModule.update ?? {})) {
    applySchemaUpdate({
      sourceModule,
      targetModulesById,
      aliases,
      selectorKey,
      operation,
      errors,
    });
  }
  for (const [selectorKey, ids] of Object.entries(sourceModule.remove ?? {})) {
    applySchemaRemoval({
      sourceModule,
      targetModulesById,
      aliases,
      selectorKey,
      ids,
      errors,
    });
  }
};

const qualifyResolvedModule = (module: SchemaModule): SchemaModule => {
  const schemaId = getModuleId(module);

  module.tags = (module.tags ?? []).map((tag) => {
    const localId = tag.localId ?? tag.id;
    const qualifiedId = tag.qualifiedId ?? buildQualifiedSchemaObjectId(schemaId, 'tags', localId);
    return {
      ...tag,
      id: qualifiedId,
      localId,
      qualifiedId,
      originSchemaId: tag.originSchemaId ?? schemaId,
    };
  });

  module.traits = (module.traits ?? []).map((trait) => {
    const localId = trait.localId ?? trait.id;
    const qualifiedId =
      trait.qualifiedId ?? buildQualifiedSchemaObjectId(schemaId, 'traits', localId);
    return {
      ...trait,
      id: qualifiedId,
      localId,
      qualifiedId,
      originSchemaId: trait.originSchemaId ?? schemaId,
      extends: trait.extends ? qualifyLocalRef(schemaId, 'traits', trait.extends) : undefined,
      analysis: trait.analysis
        ? {
            ...trait.analysis,
            expectedRelationIds: qualifyLocalRefList(
              schemaId,
              'relations',
              trait.analysis.expectedRelationIds,
            ),
          }
        : undefined,
      relationParticipation: trait.relationParticipation?.map((entry) => ({
        ...entry,
        relation: qualifyLocalRef(schemaId, 'relations', entry.relation),
      })),
    };
  });

  module.types = module.types.map((type) => {
    const localId = type.localId ?? type.id;
    const qualifiedId =
      type.qualifiedId ?? buildQualifiedSchemaObjectId(schemaId, 'types', localId);
    return {
      ...type,
      id: qualifiedId,
      localId,
      qualifiedId,
      originSchemaId: type.originSchemaId ?? schemaId,
      extends: type.extends ? qualifyLocalRef(schemaId, 'types', type.extends) : undefined,
      analysis: type.analysis ? { ...type.analysis } : undefined,
      traits: qualifyLocalRefList(schemaId, 'traits', type.traits),
      defaultTags: qualifyLocalRefList(schemaId, 'tags', type.defaultTags),
      containment: type.containment
        ? {
            ...type.containment,
            allowedChildTypes: qualifyLocalRefList(
              schemaId,
              'types',
              type.containment.allowedChildTypes,
            ),
            allowedChildTraits: qualifyLocalRefList(
              schemaId,
              'traits',
              type.containment.allowedChildTraits,
            ),
          }
        : undefined,
      display: type.display
        ? {
            ...type.display,
            primaryTag: type.display.primaryTag
              ? qualifyLocalRef(schemaId, 'tags', type.display.primaryTag)
              : undefined,
            count: type.display.count
              ? {
                  ...type.display.count,
                  childTypes:
                    qualifyLocalRefList(schemaId, 'types', type.display.count.childTypes) ?? [],
                }
              : undefined,
          }
        : undefined,
    };
  });

  module.relations = module.relations.map((relation) => {
    const localId = relation.localId ?? relation.id;
    const qualifiedId =
      relation.qualifiedId ?? buildQualifiedSchemaObjectId(schemaId, 'relations', localId);
    return {
      ...relation,
      id: qualifiedId,
      localId,
      qualifiedId,
      originSchemaId: relation.originSchemaId ?? schemaId,
      analysis: relation.analysis ? { ...relation.analysis } : undefined,
      defaultTags: qualifyLocalRefList(schemaId, 'tags', relation.defaultTags),
    };
  });

  return module;
};

export function buildRawSchemaSet(modules: SchemaModule[]): RawSchemaSet {
  const modulesById = new Map<string, SchemaModule>();
  for (const module of modules) {
    modulesById.set(getModuleId(module), module);
  }
  return {
    moduleIds: Array.from(modulesById.keys()),
    modulesById,
  };
}

export function buildSchemaSelection(params: {
  raw: RawSchemaSet;
  activations?: SchemaActivation[];
}): SchemaSelection {
  const { raw, activations } = params;
  if (activations === undefined) {
    const rootActivations = raw.moduleIds.map((moduleId) => buildDefaultSchemaActivation(moduleId));
    return {
      rootModuleIds: raw.moduleIds,
      rootActivations,
      activationsByModuleId: buildSchemaActivationMap(rootActivations),
    };
  }
  const activationsByModuleId = buildSchemaActivationMap(activations);
  const selected = new Set(
    activations.map((activation) => buildSchemaId(parseSchemaRef(activation.schema))),
  );
  return {
    rootModuleIds: raw.moduleIds.filter((moduleId) => selected.has(moduleId)),
    activationsByModuleId,
    rootActivations: raw.moduleIds
      .filter((moduleId) => selected.has(moduleId))
      .map((moduleId) => {
        const activation = activationsByModuleId.get(moduleId);
        if (!activation) {
          throw new Error(`Missing schema activation for ${moduleId}`);
        }
        return activation;
      }),
  };
}

export function resolveSchemaSet(params: {
  raw: RawSchemaSet;
  selection: SchemaSelection;
}): ResolvedSchemaSet {
  const { raw, selection } = params;
  const resolution = resolveSchemaModules({
    schemaRegistry: raw.modulesById,
    selectedSchemaIds: selection.rootModuleIds,
  });
  const errors = [...resolution.diagnostics];
  const resolvedModulesById = new Map(
    resolution.orderedModules.map((module) => [getModuleId(module), deepClone(module)]),
  );
  for (const moduleId of resolution.resolvedSchemaIds) {
    const module = resolvedModulesById.get(moduleId);
    if (!module) continue;
    applyModuleSchemaOperations({
      sourceModule: module,
      targetModulesById: resolvedModulesById,
      errors,
    });
  }
  for (const moduleId of resolution.resolvedSchemaIds) {
    const module = resolvedModulesById.get(moduleId);
    if (!module) continue;
    qualifyResolvedModule(module);
  }
  const resolvedModules = resolution.resolvedSchemaIds
    .map((moduleId) => resolvedModulesById.get(moduleId))
    .filter((module): module is SchemaModule => Boolean(module));
  return {
    rootModuleIds: selection.rootModuleIds,
    rootActivations: selection.rootActivations,
    resolvedModuleIds: resolution.resolvedSchemaIds,
    resolvedModules,
    effectiveSchema: mergeSchemas(resolvedModules),
    diagnostics: errors.filter(
      (diagnostic, index, list) =>
        list.findIndex(
          (candidate) => diagnosticFingerprint(candidate) === diagnosticFingerprint(diagnostic),
        ) === index,
    ),
  };
}

export function buildSchemaIndexes(schema: SchemaModule): SchemaIndexes {
  return {
    typesById: new Map(schema.types.map((type) => [type.id, type])),
    relationsById: new Map(schema.relations.map((relation) => [relation.id, relation])),
    traitsById: new Map((schema.traits ?? []).map((trait) => [trait.id, trait])),
    tagsById: new Map((schema.tags ?? []).map((tag) => [tag.id, tag])),
  };
}

export function buildSchemaRuntime(params: {
  raw: RawSchemaSet;
  selection: SchemaSelection;
}): SchemaRuntime {
  const { raw, selection } = params;
  const resolved = resolveSchemaSet({ raw, selection });
  const semantics = compileSchemaSemantics(resolved.effectiveSchema);
  return {
    raw,
    selection,
    resolved,
    indexes: buildSchemaIndexes(resolved.effectiveSchema),
    semantics,
  };
}

export const getSchemaType = (runtime: SchemaRuntime, typeId: string) =>
  runtime.indexes.typesById.get(typeId);

export const getSchemaRelation = (runtime: SchemaRuntime, relationId: string) =>
  runtime.indexes.relationsById.get(relationId);

export const getSchemaTrait = (runtime: SchemaRuntime, traitId: string) =>
  runtime.indexes.traitsById.get(traitId);

export const getSchemaTag = (runtime: SchemaRuntime, tagId: string) =>
  runtime.indexes.tagsById.get(tagId);

export const getActivatedSchemaLayer = (runtime: SchemaRuntime, schemaId: string) =>
  runtime.selection.activationsByModuleId.get(buildSchemaId(parseSchemaRef(schemaId)))?.layer;

export const getActivatedTypeLayer = (runtime: SchemaRuntime, typeId: string) => {
  const type = getSchemaType(runtime, typeId);
  const originSchemaId = type?.originSchemaId;
  return originSchemaId ? getActivatedSchemaLayer(runtime, originSchemaId) : undefined;
};
