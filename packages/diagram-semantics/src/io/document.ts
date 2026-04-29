import type { SchemaModule, SemanticDocument, SemanticSourceDocument } from '../model/types';
import type { DiagramValidationOptions } from '../model/validate';
import {
  parseDocument,
  parseSourceDocument,
  serializeDocument,
  serializeSourceDocument,
} from '../util/serialization';
import { parseAndValidateDiagramDoc } from '../validation/diagram';
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

const ingestWithParse = <T>(params: {
  raw: string;
  parser: (raw: string) => T;
  path?: string;
  messagePrefix?: string;
}): ValidationResult<T> => {
  try {
    return {
      ok: true,
      value: params.parser(params.raw),
      diagnostics: [],
    };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        createYamlParseDiagnostic({
          domain: 'diagram',
          error,
          path: params.path,
          messagePrefix: params.messagePrefix,
        }),
      ],
    };
  }
};

export function ingestSemanticDocument(
  params: IngestSemanticDocumentParams,
): ValidationResult<SemanticDocument> {
  return parseAndValidateDiagramDoc(params.raw, params.schema, params.validationOptions);
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
