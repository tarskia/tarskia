import { dump, JSON_SCHEMA, load } from 'js-yaml';
import {
  type Diagnostic,
  type DiagnosticDomain,
  diagramDiagnostic,
  schemaDiagnostic,
} from '../model/diagnostics';
import type { ValidationResult } from '../validation/types';

export const SEMANTIC_INVALID_YAML_CODE = 'semantic.parse.invalid_yaml';

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
};

const withOptionalPrefix = (message: string, prefix?: string) =>
  prefix && prefix.trim().length > 0 ? `${prefix}: ${message}` : message;

export const createYamlParseDiagnostic = (params: {
  domain: DiagnosticDomain;
  error: unknown;
  path?: string;
  messagePrefix?: string;
}): Diagnostic => {
  const createDiagnostic = params.domain === 'schema' ? schemaDiagnostic : diagramDiagnostic;
  return createDiagnostic({
    phase: 'parse',
    severity: 'error',
    code: SEMANTIC_INVALID_YAML_CODE,
    path: params.path,
    message: withOptionalPrefix(toErrorMessage(params.error), params.messagePrefix),
  });
};

export const parseYamlText = (raw: string): unknown => load(raw, { schema: JSON_SCHEMA });

export const parseYamlTextResult = (params: {
  raw: string;
  domain: DiagnosticDomain;
  path?: string;
  messagePrefix?: string;
}): ValidationResult<unknown> => {
  try {
    return {
      ok: true,
      value: parseYamlText(params.raw),
      diagnostics: [],
    };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        createYamlParseDiagnostic({
          domain: params.domain,
          error,
          path: params.path,
          messagePrefix: params.messagePrefix,
        }),
      ],
    };
  }
};

export const serializeYamlText = (value: unknown): string =>
  dump(value, {
    noRefs: true,
    lineWidth: 100,
    quotingType: '"',
  });
