import {
  createYamlParseDiagnostic,
  type Diagnostic,
  diagramDiagnostic,
  parseYamlText as parseSharedYamlText,
} from '@tarskia/diagram-semantics';

export const MAX_YAML_INPUT_BYTES = 50 * 1024 * 1024;

export class YamlInputError extends Error {
  constructor(
    readonly code: 'diagram.parse.too_large' | 'diagram.parse.alias_not_allowed',
    message: string,
  ) {
    super(message);
    this.name = 'YamlInputError';
  }
}

export function assertYamlInputSize(raw: string): void {
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes > MAX_YAML_INPUT_BYTES) {
    throw new YamlInputError(
      'diagram.parse.too_large',
      `Input is ${Number((bytes / (1024 * 1024)).toFixed(2))} MB; the limit is 50 MB.`,
    );
  }
}

export function yamlInputDiagnostic(error: YamlInputError, path?: string): Diagnostic {
  return diagramDiagnostic({
    phase: 'parse',
    severity: 'error',
    code: error.code,
    message: error.message,
    path,
  });
}

// Inspect the raw graph before normalization can recurse into it or discard keys.
// Visit each object once, so cyclic and exponentially expanding aliases fail cheaply.
export function parseYamlText(raw: string): unknown {
  assertYamlInputSize(raw);
  const value = parseSharedYamlText(raw);
  const seen = new WeakSet<object>();
  const pending: unknown[] = [value];
  while (pending.length) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object') continue;
    if (seen.has(current)) {
      throw new YamlInputError(
        'diagram.parse.alias_not_allowed',
        "YAML anchors and aliases aren't allowed.",
      );
    }
    seen.add(current);
    for (const child of Object.values(current)) pending.push(child);
  }
  return value;
}

export function parseSchemaModuleYaml(raw: string) {
  try {
    return { ok: true, value: parseYamlText(raw), diagnostics: [] };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        error instanceof YamlInputError
          ? yamlInputDiagnostic(error)
          : createYamlParseDiagnostic({ domain: 'schema', error }),
      ],
    };
  }
}
