import type { Diagnostic } from '../diagnostics';
import type { RawSchemaSet, SchemaRuntime } from '../schema-runtime';
import type { SchemaModule } from '../types';
import { assessSchemaValidation } from './schema-assessment';
import type { SchemaVersionCatalog } from './schema-closure';

export interface SchemaDraftValidationResult {
  ok: boolean;
  draftModule?: SchemaModule;
  runtime?: SchemaRuntime;
  diagnostics: Diagnostic[];
}

export function validateSchemaDraft(params: {
  raw: string;
  baseRawSchemaSet?: RawSchemaSet;
  versionCatalog?: SchemaVersionCatalog;
  draftSchemaId?: string;
  draftVersion?: string;
}): SchemaDraftValidationResult {
  const assessment = assessSchemaValidation({
    raw: params.raw,
    baseRawSchemaSet: params.baseRawSchemaSet,
    versionCatalog: params.versionCatalog,
    draftSchemaId: params.draftSchemaId,
    draftVersion: params.draftVersion,
  });
  return {
    ok: assessment.ok,
    draftModule: assessment.draftModule,
    runtime: assessment.runtime,
    diagnostics: assessment.diagnostics,
  };
}
