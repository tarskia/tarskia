import { describe, expect, it } from 'vitest';

import type { Diagnostic } from '../model/diagnostics';
import {
  extractDiagnosticPath,
  formatDiagnosticMessage,
  formatDiagnosticPath,
  locateSchemaDiagnostic,
} from './schema-diagnostic-location';

const raw = [
  'owner: user',
  'name: test',
  'version: "1.0"',
  'types:',
  '  - label: Missing id',
  '    properties:',
  '      - id: name',
  '        type: string',
  'invalid_outer_key: true',
].join('\n');

const baseDiagnostic = (overrides: Partial<Diagnostic>): Diagnostic => ({
  domain: 'schema',
  phase: 'shape',
  severity: 'error',
  code: 'schema.shape.test',
  message: 'test',
  ...overrides,
});

describe('schema-diagnostic-location', () => {
  it('extracts display paths from messages', () => {
    expect(
      extractDiagnosticPath(
        baseDiagnostic({
          message: '$.invalid_outer_key: is not allowed',
          path: '$',
        }),
      ),
    ).toBe('$.invalid_outer_key');
    expect(formatDiagnosticPath('$.types[0].id')).toBe('types[0].id');
    expect(formatDiagnosticPath('$')).toBe('root');
    expect(formatDiagnosticMessage('$.invalid_outer_key: is not allowed')).toBe(
      'invalid_outer_key: is not allowed',
    );
    expect(formatDiagnosticMessage('$: schema is invalid')).toBe('root: schema is invalid');
  });

  it('locates an invalid key line', () => {
    const location = locateSchemaDiagnostic(
      raw,
      baseDiagnostic({
        message: '$.invalid_outer_key: is not allowed',
        path: '$',
      }),
    );
    expect(location?.startLine).toBe(9);
    expect(location?.endLine).toBe(9);
    expect(location?.displayPath).toBe('invalid_outer_key');
  });

  it('falls back to the containing block for missing required keys', () => {
    const location = locateSchemaDiagnostic(
      raw,
      baseDiagnostic({
        message: '$.types[0].id: is required',
        path: '$.types[0]',
      }),
    );
    expect(location?.startLine).toBe(5);
    expect(location?.endLine).toBe(8);
    expect(location?.displayPath).toBe('types[0]');
  });
});
