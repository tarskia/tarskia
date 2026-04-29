import {
  type Diagnostic,
  diagnosticFingerprint,
  schemaDiagnostic,
  sortDiagnostics,
} from '../diagnostics';
import { resolveTypeDisplayOptions } from '../display-contract';
import { isQualifiedSchemaObjectId } from '../schema-ids';
import type { SchemaModule } from '../types';

export const dedupeDiagnostics = (diagnostics: Diagnostic[]) =>
  sortDiagnostics(
    diagnostics.filter(
      (diagnostic, index, list) =>
        list.findIndex(
          (candidate) => diagnosticFingerprint(candidate) === diagnosticFingerprint(diagnostic),
        ) === index,
    ),
  );

const pushResolvedError = (
  diagnostics: Diagnostic[],
  message: string,
  context?: Partial<Diagnostic>,
) => {
  diagnostics.push(
    schemaDiagnostic({
      phase: 'semantic',
      severity: 'error',
      code: 'schema.resolved.invalid_reference',
      message,
      ...context,
    }),
  );
};

const pushQualifiedIdError = (
  diagnostics: Diagnostic[],
  section: 'types' | 'traits' | 'relations' | 'tags',
  id: string,
) => {
  diagnostics.push(
    schemaDiagnostic({
      phase: 'semantic',
      severity: 'error',
      code: 'schema.resolved.unqualified_id',
      targetId: id,
      message: `Resolved ${section.slice(0, -1)} id is not qualified: ${id}`,
    }),
  );
};

const validateQualifiedSectionIds = (
  diagnostics: Diagnostic[],
  section: 'types' | 'traits' | 'relations' | 'tags',
  ids: string[],
) => {
  for (const id of ids) {
    if (!isQualifiedSchemaObjectId(id)) {
      pushQualifiedIdError(diagnostics, section, id);
    }
  }
};

const validateRefList = (
  diagnostics: Diagnostic[],
  ownerLabel: string,
  refs: string[] | undefined,
  known: Set<string>,
  code: string,
) => {
  for (const ref of refs ?? []) {
    if (!known.has(ref)) {
      pushResolvedError(diagnostics, `${ownerLabel} references unknown ${code} ${ref}`, {
        code: `schema.resolved.unknown_${code}`,
        targetId: ref,
      });
    }
  }
};

export function validateResolvedSchema(schema: SchemaModule): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const typeIds = new Set(schema.types.map((type) => type.id));
  const traitIds = new Set((schema.traits ?? []).map((trait) => trait.id));
  const relationIds = new Set(schema.relations.map((relation) => relation.id));
  const tagIds = new Set((schema.tags ?? []).map((tag) => tag.id));

  validateQualifiedSectionIds(diagnostics, 'types', [...typeIds]);
  validateQualifiedSectionIds(diagnostics, 'traits', [...traitIds]);
  validateQualifiedSectionIds(diagnostics, 'relations', [...relationIds]);
  validateQualifiedSectionIds(diagnostics, 'tags', [...tagIds]);

  for (const trait of schema.traits ?? []) {
    if (trait.extends && !traitIds.has(trait.extends)) {
      pushResolvedError(diagnostics, `Trait ${trait.id} extends unknown trait ${trait.extends}`, {
        code: 'schema.resolved.unknown_trait_extends',
        targetId: trait.extends,
      });
    }
    validateRefList(
      diagnostics,
      `Trait ${trait.id}`,
      trait.analysis?.expectedRelationIds,
      relationIds,
      'relation',
    );
    for (const entry of trait.relationParticipation ?? []) {
      if (!relationIds.has(entry.relation)) {
        pushResolvedError(
          diagnostics,
          `Trait ${trait.id} references unknown relation ${entry.relation}`,
          {
            code: 'schema.resolved.unknown_relation',
            targetId: entry.relation,
          },
        );
      }
    }
  }

  for (const type of schema.types) {
    const typeDisplay = resolveTypeDisplayOptions(type);
    if (type.extends && !typeIds.has(type.extends)) {
      pushResolvedError(diagnostics, `Type ${type.id} extends unknown type ${type.extends}`, {
        code: 'schema.resolved.unknown_type_extends',
        targetId: type.extends,
      });
    }
    validateRefList(diagnostics, `Type ${type.id}`, type.traits, traitIds, 'trait');
    validateRefList(diagnostics, `Type ${type.id}`, type.defaultTags, tagIds, 'tag');
    validateRefList(
      diagnostics,
      `Type ${type.id} containment`,
      type.containment?.allowedChildTypes,
      typeIds,
      'type',
    );
    validateRefList(
      diagnostics,
      `Type ${type.id} containment`,
      type.containment?.allowedChildTraits,
      traitIds,
      'trait',
    );
    if (typeDisplay.primaryTag && !tagIds.has(typeDisplay.primaryTag)) {
      pushResolvedError(
        diagnostics,
        `Type ${type.id} display.primaryTag references unknown tag ${typeDisplay.primaryTag}`,
        {
          code: 'schema.resolved.unknown_primary_tag',
          targetId: typeDisplay.primaryTag,
        },
      );
    }
    validateRefList(
      diagnostics,
      `Type ${type.id} display.count`,
      typeDisplay.count?.childTypes,
      typeIds,
      'type',
    );
  }

  for (const relation of schema.relations) {
    validateRefList(diagnostics, `Relation ${relation.id}`, relation.defaultTags, tagIds, 'tag');
  }

  return dedupeDiagnostics(diagnostics);
}
