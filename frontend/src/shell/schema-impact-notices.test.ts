import { describe, expect, it } from 'vitest';

import { diagramDiagnostic } from '../model/diagnostics';
import { buildDiagramImpactNoticeLines } from './schema-impact-notices';

describe('buildDiagramImpactNoticeLines', () => {
  it('returns an empty list when there are no error diagnostics', () => {
    const lines = buildDiagramImpactNoticeLines([], 'The current diagram would not validate.');
    expect(lines).toEqual([]);
  });

  it('summarizes the first error and remaining count', () => {
    const lines = buildDiagramImpactNoticeLines(
      [
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.missing_type',
          message: 'Entity Orders has unknown type deploy-target.',
        }),
        diagramDiagnostic({
          phase: 'document',
          severity: 'error',
          code: 'diagram.missing_relation_type',
          message: 'Relation rel-1 has unknown relation type read-writes.',
        }),
      ],
      'This schema selection would invalidate the current diagram.',
    );

    expect(lines).toEqual([
      'This schema selection would invalidate the current diagram.',
      'Entity Orders has unknown type deploy-target.',
      '1 more issue.',
    ]);
  });
});
