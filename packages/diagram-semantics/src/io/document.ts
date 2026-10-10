import type { Diagnostic } from '../model/diagnostics';
import { normalizeDocumentHierarchy } from '../model/normalize-hierarchy';
import type { SchemaModule, SemanticDocument, SemanticSourceDocument } from '../model/types';
import type { DiagramValidationOptions } from '../model/validate';
import {
  DocumentStructureError,
  type ParseDocumentOptions,
  parseDocument,
  parseSourceDocument,
  serializeDocument,
  serializeSourceDocument,
} from '../util/serialization';
import { validateDiagramDoc } from '../validation/diagram';
import type { ValidationResult } from '../validation/types';
import { createYamlParseDiagnostic } from './yaml';

export interface IngestSemanticDocumentParams {
  raw: string;
  schema: SchemaModule;
  validationOptions?: DiagramValidationOptions;
}

export interface IngestSemanticSourceDocumentParams {
  raw: string;
  path?: string;
  messagePrefix?: string;
}

export const parseSemanticDocument = parseDocument;
export const parseTrustedSemanticDocument = parseSemanticDocument;
export const parseSemanticSourceDocument = parseSourceDocument;
export const parseTrustedSemanticSourceDocument = parseSemanticSourceDocument;
export const serializeSemanticDocument = serializeDocument;
export const serializeSemanticSourceDocument = serializeSourceDocument;

const ingestWithParse = <T extends SemanticDocument>(params: {
  raw: string;
  parser: (raw: string, options?: ParseDocumentOptions) => T;
  path?: string;
  messagePrefix?: string;
}): ValidationResult<T> => {
  try {
    const parseDiagnostics: Diagnostic[] = [];
    const parsed = params.parser(params.raw, {
      onDiagnostic: (diagnostic) =>
        parseDiagnostics.push({
          ...diagnostic,
          path: params.path,
          message: params.messagePrefix
            ? `${params.messagePrefix}: ${diagnostic.message}`
            : diagnostic.message,
        }),
    });
    // Imported parent references cannot be resolved until all source namespaces
    // have been compiled. Normalize those documents at the source-graph boundary.
    if ('imports' in parsed && Array.isArray(parsed.imports) && parsed.imports.length > 0) {
      return { ok: true, value: parsed, diagnostics: parseDiagnostics };
    }
    const normalized = normalizeDocumentHierarchy(parsed);
    const diagnostics = [...parseDiagnostics, ...normalized.diagnostics];
    return {
      ok: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
      value: normalized.doc,
      diagnostics,
    };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        {
          ...createYamlParseDiagnostic({
            domain: 'diagram',
            error,
            path: params.path,
            messagePrefix: params.messagePrefix,
          }),
          ...(error instanceof DocumentStructureError ? { code: error.code } : {}),
        },
      ],
    };
  }
};

export function ingestSemanticDocument(
  params: IngestSemanticDocumentParams,
): ValidationResult<SemanticDocument> {
  const parsed = ingestTrustedSemanticDocument({ raw: params.raw });
  if (!parsed.value) return parsed;
  const validation = validateDiagramDoc(parsed.value, params.schema, params.validationOptions);
  const diagnostics = [...parsed.diagnostics, ...validation.diagnostics];
  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
    value: parsed.value,
    diagnostics,
  };
}

export function ingestTrustedSemanticDocument(params: {
  raw: string;
  path?: string;
  messagePrefix?: string;
}): ValidationResult<SemanticDocument> {
  return ingestWithParse({
    raw: params.raw,
    parser: parseTrustedSemanticDocument,
    path: params.path,
    messagePrefix: params.messagePrefix,
  });
}

export function ingestSemanticSourceDocument(
  params: IngestSemanticSourceDocumentParams,
): ValidationResult<SemanticSourceDocument> {
  return ingestWithParse({
    raw: params.raw,
    parser: parseSemanticSourceDocument,
    path: params.path,
    messagePrefix: params.messagePrefix,
  });
}

export function ingestTrustedSemanticSourceDocument(
  params: IngestSemanticSourceDocumentParams,
): ValidationResult<SemanticSourceDocument> {
  return ingestWithParse({
    raw: params.raw,
    parser: parseTrustedSemanticSourceDocument,
    path: params.path,
    messagePrefix: params.messagePrefix,
  });
}
