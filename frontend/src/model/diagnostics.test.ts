import { describe, expect, it } from 'vitest';
import { groupDiagnostics, schemaDiagnostic, sortDiagnostics } from './diagnostics';

describe('diagnostics helpers', () => {
  it('sorts by phase and severity first', () => {
    const diagnostics = [
      schemaDiagnostic({
        phase: 'resolution',
        severity: 'warning',
        code: 'schema.resolution.warning',
        message: 'resolution warning',
      }),
      schemaDiagnostic({
        phase: 'shape',
        severity: 'error',
        code: 'schema.shape.required',
        message: 'shape error',
      }),
      schemaDiagnostic({
        phase: 'resolution',
        severity: 'error',
        code: 'schema.resolution.error',
        message: 'resolution error',
      }),
    ];

    const sorted = sortDiagnostics(diagnostics);
    expect(sorted.map((diagnostic) => diagnostic.message)).toEqual([
      'shape error',
      'resolution error',
      'resolution warning',
    ]);
  });

  it('groups by phase+severity on sorted order', () => {
    const diagnostics = [
      schemaDiagnostic({
        phase: 'resolution',
        severity: 'error',
        code: 'schema.resolution.alpha',
        message: 'a',
      }),
      schemaDiagnostic({
        phase: 'resolution',
        severity: 'warning',
        code: 'schema.resolution.warning',
        message: 'w',
      }),
      schemaDiagnostic({
        phase: 'resolution',
        severity: 'error',
        code: 'schema.resolution.beta',
        message: 'b',
      }),
      schemaDiagnostic({
        phase: 'semantic',
        severity: 'error',
        code: 'schema.semantic.error',
        message: 's',
      }),
    ];

    const groups = groupDiagnostics(diagnostics);
    expect(
      groups.map((group) => `${group.phase}:${group.severity}:${group.diagnostics.length}`),
    ).toEqual(['semantic:error:1', 'resolution:error:2', 'resolution:warning:1']);
  });
});
