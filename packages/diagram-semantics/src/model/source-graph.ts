import { createYamlParseDiagnostic } from '../io/yaml';
import { parseSourceDocument } from '../util/serialization';
import { type Diagnostic, diagramDiagnostic } from './diagnostics';
import { buildSchemaId, parseSchemaRef } from './schema-ref';
import type {
  Entity,
  Relation,
  SchemaActivation,
  SemanticDocument,
  SemanticSourceDocument,
  SemanticSourceImport,
} from './types';

const NAMESPACE_SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export interface SourceGraphResolver {
  resolveImport: (slug: string) => { slug: string; raw: string } | undefined;
}

export interface SourceGraphCompileResult {
  doc: SemanticDocument;
  source: SemanticSourceDocument;
  hasImports: boolean;
}

export const createMapSourceGraphResolver = (
  sourcesBySlug: Readonly<Record<string, string>>,
): SourceGraphResolver => ({
  resolveImport: (slug) => {
    const normalizedSlug = slug.trim().toLowerCase();
    const raw = sourcesBySlug[normalizedSlug];
    return raw ? { slug: normalizedSlug, raw } : undefined;
  },
});

type SourceNodeContext = {
  sourceLabel: string;
  doc: SemanticSourceDocument;
  prefix: string[];
};

const createSourceLabel = (slug: string, prefix: string[]) =>
  prefix.length > 0 ? `${slug} (${prefix.join('/')})` : slug;

const pushDiagnostic = (diagnostics: Diagnostic[], input: Omit<Diagnostic, 'domain'>) => {
  diagnostics.push(diagramDiagnostic(input));
};

const qualifyLocalId = (prefix: string[], localId: string) =>
  prefix.length > 0 ? `${prefix.join('/')}/${localId}` : localId;

const qualifyReference = (
  value: string,
  prefix: string[],
  localImportNamespaces: Set<string>,
): string => {
  if (prefix.length === 0) return value;
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (!trimmed.includes('/')) {
    return qualifyLocalId(prefix, trimmed);
  }
  const [head] = trimmed.split('/', 1);
  if (head && localImportNamespaces.has(head)) {
    return `${prefix.join('/')}/${trimmed}`;
  }
  return trimmed;
};

const compileEntity = (
  entity: Entity,
  prefix: string[],
  localImportNamespaces: Set<string>,
): Entity => {
  return {
    ...entity,
    id: qualifyLocalId(prefix, entity.id),
    parent: entity.parent
      ? qualifyReference(entity.parent, prefix, localImportNamespaces)
      : undefined,
    children:
      entity.children?.map((child) => compileEntity(child, prefix, localImportNamespaces)) ??
      undefined,
  };
};

const compileRelation = (
  relation: Relation,
  prefix: string[],
  localImportNamespaces: Set<string>,
): Relation => {
  return {
    ...relation,
    id: qualifyLocalId(prefix, relation.id),
    from: qualifyReference(relation.from, prefix, localImportNamespaces),
    to: qualifyReference(relation.to, prefix, localImportNamespaces),
  };
};

const validateNamespace = (
  diagnostics: Diagnostic[],
  sourceLabel: string,
  importSpec: SemanticSourceImport,
) => {
  if (!importSpec.slug.trim()) {
    pushDiagnostic(diagnostics, {
      phase: 'resolution',
      severity: 'error',
      code: 'diagram.source.import_slug_required',
      path: sourceLabel,
      message: `${sourceLabel}: import is missing a slug`,
    });
  }
  if (!NAMESPACE_SEGMENT_PATTERN.test(importSpec.namespace.trim())) {
    pushDiagnostic(diagnostics, {
      phase: 'resolution',
      severity: 'error',
      code: 'diagram.source.invalid_import_namespace',
      targetId: importSpec.namespace,
      path: sourceLabel,
      message: `${sourceLabel}: import namespace "${importSpec.namespace}" must be a lowercase slug`,
    });
  }
};

const validateLocalId = (
  diagnostics: Diagnostic[],
  sourceLabel: string,
  kind: 'entity' | 'relation',
  id: string,
) => {
  if (!id.includes('/')) return;
  pushDiagnostic(diagnostics, {
    phase: 'resolution',
    severity: 'error',
    code: 'diagram.source.invalid_local_id',
    targetId: id,
    path: sourceLabel,
    message: `${sourceLabel}: ${kind} id "${id}" must not contain /`,
  });
};

const dedupeSchemaRefs = (
  diagnostics: Diagnostic[],
  sourceLabel: string,
  schemaRefs: SchemaActivation[],
  schemaRefsById: Map<string, { activation: SchemaActivation; sourceLabel: string }>,
  orderedRefs: SchemaActivation[],
) => {
  for (const activation of schemaRefs) {
    const parsedRef = parseSchemaRef(activation.schema);
    const schemaId = buildSchemaId(parsedRef);
    const existing = schemaRefsById.get(schemaId);
    if (
      existing &&
      (existing.activation.schema !== activation.schema ||
        existing.activation.layer !== activation.layer)
    ) {
      pushDiagnostic(diagnostics, {
        phase: 'resolution',
        severity: 'error',
        code: 'diagram.source.conflicting_schema_ref',
        targetId: schemaId,
        path: sourceLabel,
        message: `${sourceLabel}: schema ${schemaId} is activated inconsistently (${existing.activation.schema} @ layer ${existing.activation.layer} vs ${activation.schema} @ layer ${activation.layer})`,
      });
      continue;
    }
    if (!existing) {
      schemaRefsById.set(schemaId, { activation, sourceLabel });
      orderedRefs.push(activation);
    }
  }
};

const parseSourceOrDiagnostic = (
  raw: string,
  sourceLabel: string,
  diagnostics: Diagnostic[],
): SemanticSourceDocument | undefined => {
  try {
    return parseSourceDocument(raw);
  } catch (error) {
    diagnostics.push(
      createYamlParseDiagnostic({
        domain: 'diagram',
        error,
        path: sourceLabel,
        messagePrefix: sourceLabel,
      }),
    );
    return undefined;
  }
};

export const compileSourceGraph = (params: {
  raw: string;
  sourceLabel: string;
  resolver?: SourceGraphResolver;
}): { result?: SourceGraphCompileResult; diagnostics: Diagnostic[] } => {
  const diagnostics: Diagnostic[] = [];
  const rootSource = parseSourceOrDiagnostic(params.raw, params.sourceLabel, diagnostics);
  if (!rootSource) {
    return { diagnostics };
  }

  const compiledEntities: Entity[] = [];
  const compiledRelations: Relation[] = [];
  const orderedSchemaRefs: SchemaActivation[] = [];
  const schemaRefsById = new Map<string, { activation: SchemaActivation; sourceLabel: string }>();
  const seenEntityIds = new Map<string, string>();
  const seenRelationIds = new Map<string, string>();

  const visit = (context: SourceNodeContext, ancestry: string[]) => {
    const localImportNamespaces = new Set(
      (context.doc.imports ?? []).map((importSpec) => importSpec.namespace.trim()),
    );

    dedupeSchemaRefs(
      diagnostics,
      context.sourceLabel,
      context.doc.schemaRefs,
      schemaRefsById,
      orderedSchemaRefs,
    );

    for (const entity of context.doc.entities) {
      validateLocalId(diagnostics, context.sourceLabel, 'entity', entity.id);
      const compiledEntity = compileEntity(entity, context.prefix, localImportNamespaces);
      const previousSource = seenEntityIds.get(compiledEntity.id);
      if (previousSource) {
        pushDiagnostic(diagnostics, {
          phase: 'resolution',
          severity: 'error',
          code: 'diagram.source.duplicate_entity_id',
          entityId: compiledEntity.id,
          path: context.sourceLabel,
          message: `${context.sourceLabel}: entity ${compiledEntity.id} collides with ${previousSource}`,
        });
      } else {
        seenEntityIds.set(compiledEntity.id, context.sourceLabel);
      }
      compiledEntities.push(compiledEntity);
    }

    for (const relation of context.doc.relations) {
      validateLocalId(diagnostics, context.sourceLabel, 'relation', relation.id);
      const compiledRelation = compileRelation(relation, context.prefix, localImportNamespaces);
      const previousSource = seenRelationIds.get(compiledRelation.id);
      if (previousSource) {
        pushDiagnostic(diagnostics, {
          phase: 'resolution',
          severity: 'error',
          code: 'diagram.source.duplicate_relation_id',
          relationId: compiledRelation.id,
          path: context.sourceLabel,
          message: `${context.sourceLabel}: relation ${compiledRelation.id} collides with ${previousSource}`,
        });
      } else {
        seenRelationIds.set(compiledRelation.id, context.sourceLabel);
      }
      compiledRelations.push(compiledRelation);
    }

    for (const importSpec of context.doc.imports ?? []) {
      validateNamespace(diagnostics, context.sourceLabel, importSpec);
      if (!importSpec.slug.trim() || !importSpec.namespace.trim()) {
        continue;
      }
      if (ancestry.includes(importSpec.slug)) {
        pushDiagnostic(diagnostics, {
          phase: 'resolution',
          severity: 'error',
          code: 'diagram.source.import_cycle',
          targetId: importSpec.slug,
          path: context.sourceLabel,
          message: `${context.sourceLabel}: import cycle detected through ${importSpec.slug}`,
        });
        continue;
      }
      const resolved = params.resolver?.resolveImport(importSpec.slug.trim());
      if (!resolved) {
        pushDiagnostic(diagnostics, {
          phase: 'resolution',
          severity: 'error',
          code: 'diagram.source.import_not_found',
          targetId: importSpec.slug,
          path: context.sourceLabel,
          message: `${context.sourceLabel}: could not resolve imported diagram ${importSpec.slug}`,
        });
        continue;
      }
      const childPrefix = [...context.prefix, importSpec.namespace.trim()];
      const childSourceLabel = createSourceLabel(resolved.slug, childPrefix);
      const childSource = parseSourceOrDiagnostic(resolved.raw, childSourceLabel, diagnostics);
      if (!childSource) {
        continue;
      }
      visit(
        {
          sourceLabel: childSourceLabel,
          doc: childSource,
          prefix: childPrefix,
        },
        [...ancestry, importSpec.slug.trim()],
      );
    }
  };

  visit(
    {
      sourceLabel: params.sourceLabel,
      doc: rootSource,
      prefix: [],
    },
    [params.sourceLabel],
  );

  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return { diagnostics };
  }

  return {
    result: {
      source: rootSource,
      hasImports: (rootSource.imports?.length ?? 0) > 0,
      doc: {
        version: rootSource.version,
        schemaRefs: orderedSchemaRefs,
        entities: compiledEntities,
        relations: compiledRelations,
        inputs: rootSource.inputs,
        metadata: rootSource.metadata,
        view: rootSource.view,
      },
    },
    diagnostics,
  };
};
