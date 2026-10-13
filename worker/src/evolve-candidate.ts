import { isDeepStrictEqual } from 'node:util';
import {
  buildEntityTree,
  buildSchemaId,
  buildSchemaRuntimeFromCatalog,
  buildSchemaVersionCatalogFromRegistry,
  completeSemanticDiagramDiff,
  type Entity,
  evolveSemanticDiagramDiffUnion,
  ingestSemanticDiagramDiff,
  parseSchemaRef,
  type Relation,
  resolveTypeDef,
  type SchemaModule,
  type SemanticDiagramEntityDiff,
  type SemanticDiagramRelationDiff,
  type SemanticDocument,
  serializeSemanticDiagramDiff,
} from '@tarskia/diagram-semantics';
import { parseYamlText } from './untrusted-yaml';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Complete sparse after-only changes using the shared diff's snapshot and field rules. */
export function completeEvolveCandidate(base: SemanticDocument, response: string) {
  const candidate = parseYamlText(response);
  if (!record(candidate) || !record(candidate.diff))
    throw new Error('Expected an object with diff and optional schema.');
  const draft = candidate.diff;
  if (draft.kind !== 'semantic-diagram-diff' || draft.version !== 1)
    throw new Error('Expected semantic-diagram-diff version 1.');
  if (candidate.schema != null && typeof candidate.schema !== 'string')
    throw new Error('schema must be YAML text or null.');
  const tree = buildEntityTree(base);
  const entities = [...tree.byId.values()]
    .filter((node) => node.id !== tree.rootId)
    .map((node) => {
      const { children: _children, parent: _parent, ...entity } = node.entity;
      return { ...entity, ...(node.parentId !== tree.rootId ? { parent: node.parentId } : {}) };
    });
  function validateEntries(items: Array<Entity | Relation>, raw: unknown, idKey: string): void {
    if (!Array.isArray(raw)) throw new Error(`Expected ${idKey} changes array.`);
    const map = new Map(items.map((item) => [item.id, item]));
    const seen = new Set<string>();
    for (const entry of raw) {
      if (!record(entry) || typeof entry[idKey] !== 'string') throw new Error(`Expected ${idKey}.`);
      const id = entry[idKey] as string;
      if (seen.has(id)) throw new Error(`Duplicate change for ${id}.`);
      seen.add(id);
      if ('before' in entry || 'changedFields' in entry)
        throw new Error(`Do not supply before or changedFields for ${id}.`);
      const exists = map.has(id);
      if (entry.change === 'added' ? exists : !exists)
        throw new Error(
          `${entry.change} ID ${id} ${exists ? 'already exists' : 'does not exist'} in the base.`,
        );
      if (entry.change === 'removed') {
        if ('after' in entry) throw new Error(`Removed ${id} must not have after.`);
      } else if (entry.change === 'added' || entry.change === 'changed') {
        if (!record(entry.after) || entry.after.id !== id || 'children' in entry.after)
          throw new Error(`Expected flat after snapshot with ID ${id}.`);
        if (!record(entry.after.provenance))
          throw new Error(`Added or changed ${id} needs provenance.`);
      } else throw new Error(`Invalid change for ${id}: ${entry.change}.`);
    }
  }
  validateEntries(entities, draft.entities, 'entityId');
  validateEntries(base.relations, draft.relations, 'relationId');
  const completed = completeSemanticDiagramDiff({
    before: base,
    entities: draft.entities as SemanticDiagramEntityDiff[],
    relations: draft.relations as SemanticDiagramRelationDiff[],
  });
  const rawDiff = serializeSemanticDiagramDiff(completed);
  const ingested = ingestSemanticDiagramDiff(rawDiff);
  if (!ingested.ok || !ingested.value)
    throw new Error(ingested.diagnostics.map((item) => item.message).join('\n'));
  const evolved = evolveSemanticDiagramDiffUnion({ before: base, diff: ingested.value });
  if (!evolved.ok || !evolved.value)
    throw new Error(evolved.diagnostics.map((item) => item.message).join('\n'));
  return {
    diff: ingested.value,
    rawDiff,
    document: evolved.value.afterDocument,
    schema: candidate.schema as string | null | undefined,
  };
}

export function assertAdditiveSchema(base: SchemaModule, next: SchemaModule): string[] {
  const { types: baseTypes, relations: baseRelations, use: baseUse = [], ...baseRest } = base;
  const { types: nextTypes, relations: nextRelations, use: nextUse = [], ...nextRest } = next;
  if (base.owner !== 'repo' || base.version !== '0.1' || !isDeepStrictEqual(baseRest, nextRest))
    throw new Error('Only additive changes to repo schema types at version 0.1 are allowed.');
  for (const relation of baseRelations) {
    if (
      !isDeepStrictEqual(
        relation,
        nextRelations.find((item) => item.id === relation.id),
      )
    )
      throw new Error(`Cannot change existing relation type ${relation.id}.`);
  }
  for (const imported of baseUse) {
    if (!nextUse.some((item) => isDeepStrictEqual(item, imported)))
      throw new Error(`Cannot remove or remap existing import ${imported.schema}.`);
  }
  const addedEntities = nextTypes.filter((type) => !baseTypes.some((old) => old.id === type.id));
  const addedRelations = nextRelations.filter(
    (type) => !baseRelations.some((old) => old.id === type.id),
  );
  // Only schema-reference fields count as a reason for adding an import.
  const references = [
    ...addedEntities.flatMap((type) => [
      type.extends,
      ...(type.traits ?? []),
      ...(type.defaultTags ?? []),
      ...(type.containment?.allowedChildTypes ?? []),
      ...(type.containment?.allowedChildTraits ?? []),
      type.display?.primaryTag,
      ...(type.display?.count?.childTypes ?? []),
    ]),
    ...addedRelations.flatMap((type) => type.defaultTags ?? []),
  ];
  for (const imported of nextUse.filter(
    (item) => !baseUse.some((old) => isDeepStrictEqual(old, item)),
  )) {
    const schemaId = buildSchemaId(parseSchemaRef(imported.schema));
    if (
      baseUse.some(
        (old) =>
          buildSchemaId(parseSchemaRef(old.schema)) === schemaId ||
          (imported.alias && old.alias === imported.alias),
      )
    )
      throw new Error(`Cannot remap existing import ${imported.schema}.`);
    const prefixes = [schemaId, imported.alias].filter((value): value is string => Boolean(value));
    if (!references.some((ref) => ref && prefixes.some((prefix) => ref.startsWith(`${prefix}.`))))
      throw new Error(`Import ${imported.schema} must be needed by an added type.`);
  }
  for (const type of baseTypes) {
    const replacement = nextTypes.find((item) => item.id === type.id);
    if (!replacement) throw new Error(`Cannot remove existing type ${type.id}.`);
    const { properties: oldProps = [], ...oldType } = type;
    const { properties: newProps = [], ...newType } = replacement;
    if (!isDeepStrictEqual(oldType, newType))
      throw new Error(`Cannot change existing type ${type.id}.`);
    for (const prop of oldProps) {
      if (
        !isDeepStrictEqual(
          prop,
          newProps.find((item) => item.id === prop.id),
        )
      )
        throw new Error(`Cannot change existing property ${type.id}.${prop.id}.`);
    }
  }
  return [...addedEntities, ...addedRelations].map((type) => type.id);
}

export function assertInheritedPropertiesUnchanged(
  base: SchemaModule,
  next: SchemaModule,
  modules: Map<string, SchemaModule>,
): void {
  const schemaId = `${base.owner}/${base.name}`;
  const resolve = (module: SchemaModule) => {
    const registry = new Map(modules).set(schemaId, module);
    const result = buildSchemaRuntimeFromCatalog({
      catalog: buildSchemaVersionCatalogFromRegistry(registry),
      activations: [{ schema: `${schemaId}@${base.version}`, layer: 0 }],
    });
    const errors = result.diagnostics.filter((item) => item.severity === 'error');
    if (errors.length) throw new Error(errors.map((item) => item.message).join('\n'));
    return result.runtime.resolved.effectiveSchema;
  };
  const before = resolve(base);
  const after = resolve(next);
  for (const type of base.types) {
    const id = `${schemaId}.types.${type.id}`;
    const previous = resolveTypeDef(before, id);
    const replacement = resolveTypeDef(after, id);
    if (!previous || !replacement) throw new Error(`Cannot resolve existing type ${id}.`);
    for (const property of previous.properties ?? []) {
      if (
        !isDeepStrictEqual(
          property,
          replacement.properties?.find((item) => item.id === property.id),
        )
      )
        throw new Error(`Cannot change inherited property ${id}.${property.id}.`);
    }
  }
}
