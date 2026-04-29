import { type Diagnostic, diagnosticFingerprint, schemaDiagnostic } from './diagnostics';
import { buildEntityIndex, type EntityIndex } from './entity-tree';
import { FREEFORM_RELATION_TYPE, getSchemaObjectOwnerId } from './schema-ids';
import { buildDefaultSchemaActivation, buildSchemaId, parseSchemaRef } from './schema-ref';
import type {
  Relation,
  SchemaActivation,
  SchemaModule,
  SchemaOwner,
  SemanticDocument,
} from './types';
import { validateDocument } from './validate';

export interface SchemaCatalogEntry {
  id: string;
  label: string;
  version?: string;
  owner?: SchemaOwner;
}

export const parseSchemaId = (ref: string) => buildSchemaId(parseSchemaRef(ref));

export const getSchemaDependencyIds = (module: SchemaModule): string[] =>
  Array.from(
    new Set(
      (module.use ?? [])
        .map((entry) => parseSchemaId(entry.schema))
        .filter((dependencyId) => dependencyId.length > 0),
    ),
  );

export function resolveSchemaModules(params: {
  schemaRegistry: Map<string, SchemaModule>;
  selectedSchemaIds: string[];
}): { orderedModules: SchemaModule[]; resolvedSchemaIds: string[]; diagnostics: Diagnostic[] } {
  const { schemaRegistry, selectedSchemaIds } = params;
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const orderedSchemaIds: string[] = [];
  const diagnostics: Diagnostic[] = [];

  const visit = (schemaId: string, stack: string[]) => {
    if (visited.has(schemaId)) return;
    if (visiting.has(schemaId)) {
      const cycleStart = stack.indexOf(schemaId);
      const cyclePath = cycleStart >= 0 ? stack.slice(cycleStart) : [...stack, schemaId];
      diagnostics.push(
        schemaDiagnostic({
          phase: 'resolution',
          severity: 'error',
          code: 'schema.resolution.dependency_cycle',
          moduleId: schemaId,
          message: `Schema dependency cycle detected: ${[...cyclePath, schemaId].join(' -> ')}`,
        }),
      );
      return;
    }
    const module = schemaRegistry.get(schemaId);
    if (!module) {
      diagnostics.push(
        schemaDiagnostic({
          phase: 'resolution',
          severity: 'error',
          code: 'schema.resolution.missing_dependency',
          moduleId: schemaId,
          message: `Missing schema dependency: ${schemaId}`,
        }),
      );
      return;
    }
    visiting.add(schemaId);
    for (const dependencyId of getSchemaDependencyIds(module)) {
      visit(dependencyId, [...stack, schemaId]);
    }
    visiting.delete(schemaId);
    visited.add(schemaId);
    orderedSchemaIds.push(schemaId);
  };

  for (const schemaId of selectedSchemaIds) {
    visit(schemaId, []);
  }

  return {
    orderedModules: orderedSchemaIds
      .map((schemaId) => schemaRegistry.get(schemaId))
      .filter((module): module is SchemaModule => Boolean(module)),
    resolvedSchemaIds: orderedSchemaIds,
    diagnostics,
  };
}

const previewList = (values: string[]) => {
  const first = values.slice(0, 4);
  const overflow = values.length - first.length;
  if (overflow <= 0) return first.join(', ');
  return `${first.join(', ')}, +${overflow} more`;
};

export function buildNextSchemaActivations({
  currentActivations,
  selectedSchemaIds,
  schemaCatalog,
}: {
  currentActivations: SchemaActivation[] | undefined;
  selectedSchemaIds: string[];
  schemaCatalog: SchemaCatalogEntry[];
}): SchemaActivation[] {
  const selected = new Set(selectedSchemaIds);
  const activations = currentActivations ?? [];
  const catalogIds = new Set(schemaCatalog.map((entry) => entry.id));
  const existingKnownRefById = new Map(
    activations
      .map((activation) => [parseSchemaId(activation.schema), activation] as const)
      .filter(([id]) => catalogIds.has(id)),
  );
  const unknownRefs = activations.filter(
    (activation) => !catalogIds.has(parseSchemaId(activation.schema)),
  );
  const nextKnownRefs = schemaCatalog
    .filter((entry) => selected.has(entry.id))
    .map(
      (entry) =>
        existingKnownRefById.get(entry.id) ??
        buildDefaultSchemaActivation(entry.version ? `${entry.id}@${entry.version}` : entry.id),
    );
  return [...nextKnownRefs, ...unknownRefs];
}

export function buildSchemaLockReasons({
  schemaCatalog,
  schemaRegistry,
  selectedSchemaIds,
  entityIndex,
  relations,
}: {
  schemaCatalog: SchemaCatalogEntry[];
  schemaRegistry: Map<string, SchemaModule>;
  selectedSchemaIds: string[];
  entityIndex: EntityIndex;
  relations: Relation[];
}): Record<string, string> {
  const selectedSet = new Set(selectedSchemaIds);

  const requiredEntitiesBySchema = new Map<string, Set<string>>();
  const requiredRelationsBySchema = new Map<string, Set<string>>();
  const addEntityUsage = (schemaId: string, entityId: string) => {
    const entity = entityIndex.byId.get(entityId);
    if (!entity) return;
    const label = entity.name?.trim() || entity.id;
    const users = requiredEntitiesBySchema.get(schemaId) ?? new Set<string>();
    users.add(label);
    requiredEntitiesBySchema.set(schemaId, users);
  };
  const addRelationUsage = (schemaId: string, relationId: string) => {
    const users = requiredRelationsBySchema.get(schemaId) ?? new Set<string>();
    users.add(relationId);
    requiredRelationsBySchema.set(schemaId, users);
  };

  for (const { entity } of entityIndex.entries) {
    const owner = getSchemaObjectOwnerId(entity.type);
    if (!owner || !selectedSet.has(owner)) continue;
    if (!owner) continue;
    addEntityUsage(owner, entity.id);
  }

  for (const relation of relations) {
    if (!relation.type || relation.type === FREEFORM_RELATION_TYPE) continue;
    const owner = getSchemaObjectOwnerId(relation.type);
    if (!owner || !selectedSet.has(owner)) continue;
    if (!owner) continue;
    addRelationUsage(owner, relation.id);
    addEntityUsage(owner, relation.from);
    addEntityUsage(owner, relation.to);
  }

  const dependentBySchema = new Map<string, Set<string>>();
  for (const entry of schemaCatalog) {
    if (!selectedSet.has(entry.id)) continue;
    const module = schemaRegistry.get(entry.id);
    if (!module) continue;
    for (const dependencyId of getSchemaDependencyIds(module)) {
      if (!selectedSet.has(dependencyId)) continue;
      const dependents = dependentBySchema.get(dependencyId) ?? new Set<string>();
      dependents.add(entry.id);
      dependentBySchema.set(dependencyId, dependents);
    }
  }

  const reasons: Record<string, string> = {};
  for (const schemaId of selectedSchemaIds) {
    const entityUsers = [...(requiredEntitiesBySchema.get(schemaId) ?? new Set<string>())].sort(
      (a, b) => a.localeCompare(b),
    );
    const relationUsers = [...(requiredRelationsBySchema.get(schemaId) ?? new Set<string>())].sort(
      (a, b) => a.localeCompare(b),
    );
    const dependents = [...(dependentBySchema.get(schemaId) ?? new Set<string>())]
      .map((id) => schemaCatalog.find((entry) => entry.id === id)?.label ?? id)
      .sort((a, b) => a.localeCompare(b));
    const parts: string[] = [];
    if (entityUsers.length > 0) {
      parts.push(`Entities: ${previewList(entityUsers)}`);
    }
    if (relationUsers.length > 0) {
      parts.push(`Relations: ${previewList(relationUsers)}`);
    }
    if (dependents.length > 0) {
      parts.push(`Schemas: ${previewList(dependents)}`);
    }
    if (parts.length > 0) {
      reasons[schemaId] = parts.join('\n');
    }
  }
  return reasons;
}

export function sanitizeDanglingRelations(doc: SemanticDocument): SemanticDocument {
  const ids = new Set(buildEntityIndex(doc.entities).byId.keys());
  const filtered = doc.relations.filter(
    (relation) => ids.has(relation.from) && ids.has(relation.to),
  );
  if (filtered.length === doc.relations.length) {
    return doc;
  }
  return {
    ...doc,
    relations: filtered,
  };
}

export function collectIntroducedValidationErrors({
  currentDoc,
  candidateDoc,
  currentSchema,
  candidateSchema,
}: {
  currentDoc: SemanticDocument;
  candidateDoc: SemanticDocument;
  currentSchema: SchemaModule;
  candidateSchema: SchemaModule;
}): { sanitizedCandidateDoc: SemanticDocument; introducedDiagnostics: Diagnostic[] } {
  const sanitizedCurrentDoc = sanitizeDanglingRelations(currentDoc);
  const sanitizedCandidateDoc = sanitizeDanglingRelations(candidateDoc);
  const currentDiagnostics = new Set(
    validateDocument(sanitizedCurrentDoc, currentSchema).map(diagnosticFingerprint),
  );
  const candidateDiagnostics = validateDocument(sanitizedCandidateDoc, candidateSchema);
  return {
    sanitizedCandidateDoc,
    introducedDiagnostics: candidateDiagnostics.filter(
      (diagnostic) => !currentDiagnostics.has(diagnosticFingerprint(diagnostic)),
    ),
  };
}
