import {
  buildSchemaVersionCatalogFromRegistry as buildCatalogFromRegistry,
  buildRawSchemaSet,
  buildSchemaVersionCatalog,
  type Diagnostic,
  diagnosticFingerprint,
  getSchemaModuleRef,
  materializeSchemaClosure,
  type RawSchemaSet,
  resolveSchemaClosureFromCatalog,
  type SchemaModule,
  type SchemaRuntime,
  type SchemaVersionCatalog,
  schemaDiagnostic,
  sortDiagnostics,
  validateSchemaModuleObject,
} from '@tarskia/diagram-semantics';
import { parseSchemaModuleYaml } from '../untrusted-yaml';
import type { SchemaRegistry } from './schema-loader';

export interface SchemaValidationAssessment {
  ok: boolean;
  draftModule?: SchemaModule;
  runtime?: SchemaRuntime;
  dependencyRefs: string[];
  diagnostics: Diagnostic[];
}

const dedupeDiagnostics = (diagnostics: Diagnostic[]) =>
  sortDiagnostics(
    diagnostics.filter(
      (diagnostic, index, list) =>
        list.findIndex(
          (candidate) => diagnosticFingerprint(candidate) === diagnosticFingerprint(diagnostic),
        ) === index,
    ),
  );

// Retain the worker's asynchronous registry adapter for existing callers. Catalog
// identity, version resolution and materialization are owned by the shared package.
export async function buildSchemaVersionCatalogFromRegistry(
  registry: SchemaRegistry,
): Promise<SchemaVersionCatalog> {
  return buildCatalogFromRegistry(registry.modulesById);
}

const validateResolvedSchema = (schema: SchemaModule): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const typeIds = new Set(schema.types.map((type) => type.id));
  const traitIds = new Set((schema.traits ?? []).map((trait) => trait.id));
  const relationIds = new Set(schema.relations.map((relation) => relation.id));
  const tagIds = new Set((schema.tags ?? []).map((tag) => tag.id));

  const validateRefList = (
    ownerLabel: string,
    refs: string[] | undefined,
    known: Set<string>,
    code: string,
  ) => {
    for (const ref of refs ?? []) {
      if (known.has(ref)) continue;
      diagnostics.push(
        schemaDiagnostic({
          phase: 'semantic',
          severity: 'error',
          code: `schema.resolved.unknown_${code}`,
          targetId: ref,
          message: `${ownerLabel} references unknown ${code} ${ref}`,
        }),
      );
    }
  };

  for (const trait of schema.traits ?? []) {
    if (trait.extends && !traitIds.has(trait.extends)) {
      diagnostics.push(
        schemaDiagnostic({
          phase: 'semantic',
          severity: 'error',
          code: 'schema.resolved.unknown_trait_extends',
          targetId: trait.extends,
          message: `Trait ${trait.id} extends unknown trait ${trait.extends}`,
        }),
      );
    }
    validateRefList(
      `Trait ${trait.id}`,
      trait.analysis?.expectedRelationIds,
      relationIds,
      'relation',
    );
    for (const entry of trait.relationParticipation ?? []) {
      if (relationIds.has(entry.relation)) continue;
      diagnostics.push(
        schemaDiagnostic({
          phase: 'semantic',
          severity: 'error',
          code: 'schema.resolved.unknown_relation',
          targetId: entry.relation,
          message: `Trait ${trait.id} references unknown relation ${entry.relation}`,
        }),
      );
    }
  }

  for (const type of schema.types) {
    if (type.extends && !typeIds.has(type.extends)) {
      diagnostics.push(
        schemaDiagnostic({
          phase: 'semantic',
          severity: 'error',
          code: 'schema.resolved.unknown_type_extends',
          targetId: type.extends,
          message: `Type ${type.id} extends unknown type ${type.extends}`,
        }),
      );
    }
    validateRefList(`Type ${type.id}`, type.traits, traitIds, 'trait');
    validateRefList(`Type ${type.id}`, type.defaultTags, tagIds, 'tag');
    validateRefList(
      `Type ${type.id} containment`,
      type.containment?.allowedChildTypes,
      typeIds,
      'type',
    );
    validateRefList(
      `Type ${type.id} containment`,
      type.containment?.allowedChildTraits,
      traitIds,
      'trait',
    );
    if (type.display?.primaryTag && !tagIds.has(type.display.primaryTag)) {
      diagnostics.push(
        schemaDiagnostic({
          phase: 'semantic',
          severity: 'error',
          code: 'schema.resolved.unknown_primary_tag',
          targetId: type.display.primaryTag,
          message: `Type ${type.id} display.primaryTag references unknown tag ${type.display.primaryTag}`,
        }),
      );
    }
    validateRefList(
      `Type ${type.id} display.count`,
      type.display?.count?.childTypes,
      typeIds,
      'type',
    );
  }

  for (const relation of schema.relations) {
    validateRefList(`Relation ${relation.id}`, relation.defaultTags, tagIds, 'tag');
  }

  return dedupeDiagnostics(diagnostics);
};

export function assessSchemaValidation(params: {
  raw: string;
  catalog?: SchemaVersionCatalog;
  rawSchemaSet?: RawSchemaSet;
  draftSchemaId?: string;
  draftVersion?: string;
}): SchemaValidationAssessment {
  const parseResult = parseSchemaModuleYaml(params.raw);
  if (!parseResult.ok) {
    return {
      ok: false,
      dependencyRefs: [],
      diagnostics: parseResult.diagnostics,
    };
  }

  const authoredResult = validateSchemaModuleObject(parseResult.value);
  if (!authoredResult.ok || !authoredResult.value) {
    return {
      ok: false,
      dependencyRefs: [],
      diagnostics: authoredResult.diagnostics,
    };
  }

  const draftModule = authoredResult.value;
  const closure = resolveSchemaClosureFromCatalog({
    root: {
      schemaId: params.draftSchemaId ?? getSchemaModuleRef(draftModule),
      version: params.draftVersion ?? draftModule.version,
      raw: params.raw,
      module: draftModule,
    },
    catalog:
      params.catalog ??
      buildCatalogFromRegistry((params.rawSchemaSet ?? buildRawSchemaSet([])).modulesById),
  });
  if (!closure.ok) {
    return {
      ok: false,
      draftModule,
      dependencyRefs: closure.dependencyRefs,
      diagnostics: closure.diagnostics,
    };
  }

  const materialized = materializeSchemaClosure({ closure });
  if (!materialized.ok || !materialized.runtime) {
    return {
      ok: false,
      draftModule,
      dependencyRefs: closure.dependencyRefs,
      diagnostics: materialized.diagnostics,
    };
  }

  const resolvedDiagnostics = validateResolvedSchema(materialized.runtime.resolved.effectiveSchema);
  const diagnostics = dedupeDiagnostics([...closure.diagnostics, ...resolvedDiagnostics]);
  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
    draftModule,
    runtime: materialized.runtime,
    dependencyRefs: closure.dependencyRefs,
    diagnostics,
  };
}

export function omitSchemaVersionCatalogEntry(
  catalog: SchemaVersionCatalog,
  schemaId: string,
): SchemaVersionCatalog {
  return buildSchemaVersionCatalog(catalog.entries.filter((entry) => entry.schemaId !== schemaId));
}
