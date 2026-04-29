import { createYamlParseDiagnostic } from '../io/yaml';
import {
  collectIntroducedValidationErrors,
  sanitizeDanglingRelations,
} from '../model/schema-selection';
import type { SchemaModule, SemanticDocument } from '../model/types';
import { validateDocument } from '../model/validate';
import { parseDocument } from '../util/serialization';
import type { DiagramValidationOptions, ValidationResult } from './types';

export function validateDiagramDoc(
  doc: SemanticDocument,
  schema: SchemaModule,
  options?: DiagramValidationOptions,
): ValidationResult<SemanticDocument> {
  const diagnostics = validateDocument(doc, schema, options);
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  return { ok: true, value: doc, diagnostics: [] };
}

export function parseAndValidateDiagramDoc(
  raw: string,
  schema: SchemaModule,
  options?: DiagramValidationOptions,
): ValidationResult<SemanticDocument> {
  let parsed: SemanticDocument;
  try {
    parsed = parseDocument(raw);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [createYamlParseDiagnostic({ domain: 'diagram', error })],
    };
  }
  return validateDiagramDoc(parsed, schema, options);
}

export function sanitizeDiagramDoc(doc: SemanticDocument): SemanticDocument {
  return sanitizeDanglingRelations(doc);
}

export function collectSchemaSwitchValidation(params: {
  currentDoc: SemanticDocument;
  candidateDoc: SemanticDocument;
  currentSchema: SchemaModule;
  candidateSchema: SchemaModule;
}) {
  return collectIntroducedValidationErrors(params);
}
