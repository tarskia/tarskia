import type { Diagnostic } from '../model/diagnostics';
import { schemaDiagnostic } from '../model/diagnostics';
import { getSchemaModuleRef } from '../model/schema-ref';
import type { SchemaModule } from '../model/types';
import schemaModuleSchema from '../schemas/schema-module.schema.json';
import { validateWithSchema } from '../util/schema-validator';
import { parseSchema } from '../util/serialization';
import type { ValidationResult } from '../validation/types';
import { parseYamlText, parseYamlTextResult, serializeYamlText } from './yaml';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asSchemaModule = (value: Record<string, unknown>): SchemaModule =>
  value as unknown as SchemaModule;

const toInvalidRootResult = (): ValidationResult<SchemaModule> => ({
  ok: false,
  diagnostics: [
    schemaDiagnostic({
      phase: 'shape',
      severity: 'error',
      code: 'schema.shape.invalid_root',
      message: 'Invalid schema',
      path: '$',
    }),
  ],
});

const parseSelectorAlias = (selector: string) => {
  const [alias] = selector.split('.');
  return alias;
};

function validateSchemaModuleSemantics(module: SchemaModule): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const moduleRef = getSchemaModuleRef(module);
  const aliasSet = new Set<string>();
  for (const entry of module.use ?? []) {
    if (!entry.alias) continue;
    if (aliasSet.has(entry.alias)) {
      diagnostics.push(
        schemaDiagnostic({
          phase: 'semantic',
          severity: 'error',
          code: 'schema.semantic.duplicate_use_alias',
          moduleId: moduleRef,
          message: `Duplicate use alias: ${entry.alias}`,
        }),
      );
      continue;
    }
    aliasSet.add(entry.alias);
  }

  const checkSectionDuplicates = (
    sectionName: 'tags' | 'traits' | 'types' | 'relations',
    items: { id: string }[],
  ) => {
    const seenIds = new Set<string>();
    for (const item of items) {
      if (seenIds.has(item.id)) {
        diagnostics.push(
          schemaDiagnostic({
            phase: 'semantic',
            severity: 'error',
            code: 'schema.semantic.duplicate_section_id',
            moduleId: moduleRef,
            targetId: item.id,
            message: `Duplicate id in ${sectionName}: ${item.id}`,
          }),
        );
      }
      seenIds.add(item.id);
    }
  };

  checkSectionDuplicates('tags', module.tags ?? []);
  checkSectionDuplicates('traits', module.traits ?? []);
  checkSectionDuplicates('types', module.types);
  checkSectionDuplicates('relations', module.relations);

  const knownAliases = new Set((module.use ?? []).map((entry) => entry.alias).filter(Boolean));
  if (module.update) {
    for (const selector of Object.keys(module.update)) {
      const alias = parseSelectorAlias(selector);
      if (alias && !knownAliases.has(alias)) {
        diagnostics.push(
          schemaDiagnostic({
            phase: 'semantic',
            severity: 'error',
            code: 'schema.semantic.unknown_update_selector_alias',
            moduleId: moduleRef,
            selector,
            message: `Unknown selector alias in update: ${alias}`,
          }),
        );
      }
    }
  }
  if (module.remove) {
    for (const selector of Object.keys(module.remove)) {
      const alias = parseSelectorAlias(selector);
      if (alias && !knownAliases.has(alias)) {
        diagnostics.push(
          schemaDiagnostic({
            phase: 'semantic',
            severity: 'error',
            code: 'schema.semantic.unknown_remove_selector_alias',
            moduleId: moduleRef,
            selector,
            message: `Unknown selector alias in remove: ${alias}`,
          }),
        );
      }
    }
  }

  return diagnostics;
}

export const parseSchemaModule = parseSchema;

export const serializeSchemaModule = (module: SchemaModule): string => serializeYamlText(module);

export function parseSchemaModuleYaml(raw: string): ValidationResult<unknown> {
  return parseYamlTextResult({
    raw,
    domain: 'schema',
  });
}

export function parseTrustedSchemaModule(raw: string): SchemaModule {
  const parsed = parseYamlText(raw);
  if (!isRecord(parsed)) {
    throw new Error('Invalid schema');
  }
  return asSchemaModule(parsed);
}

export function validateSchemaModuleObject(candidate: unknown): ValidationResult<SchemaModule> {
  if (!isRecord(candidate)) {
    return toInvalidRootResult();
  }
  const shapeDiagnostics = validateWithSchema(candidate, schemaModuleSchema);
  if (shapeDiagnostics.length > 0) {
    return { ok: false, diagnostics: shapeDiagnostics };
  }
  const semanticDiagnostics = validateSchemaModuleSemantics(asSchemaModule(candidate));
  if (semanticDiagnostics.length > 0) {
    return { ok: false, diagnostics: semanticDiagnostics };
  }
  return { ok: true, value: asSchemaModule(candidate), diagnostics: [] };
}

export function ingestSchemaModule(raw: string): ValidationResult<SchemaModule> {
  return parseAndValidateSchemaModule(raw);
}

export function ingestTrustedSchemaModule(raw: string): ValidationResult<SchemaModule> {
  const parsed = parseSchemaModuleYaml(raw);
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostics: parsed.diagnostics,
    };
  }
  if (!isRecord(parsed.value)) {
    return toInvalidRootResult();
  }
  return {
    ok: true,
    value: asSchemaModule(parsed.value),
    diagnostics: [],
  };
}

export function parseAndValidateSchemaModule(raw: string): ValidationResult<SchemaModule> {
  const parsed = parseSchemaModuleYaml(raw);
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostics: parsed.diagnostics,
    };
  }
  return validateSchemaModuleObject(parsed.value);
}
