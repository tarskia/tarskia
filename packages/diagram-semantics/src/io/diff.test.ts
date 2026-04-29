import { describe, expect, it } from 'vitest';
import { diffSemanticDiagramDocuments, type SemanticDiagramDiff } from '../diff/diagram-diff';
import type { SemanticDocument } from '../model/types';
import { ingestSemanticDiagramDiff, serializeSemanticDiagramDiff } from './diff';

const beforeDoc: SemanticDocument = {
  version: '1',
  schemaRefs: [],
  entities: [
    { id: 'stable', type: 'service', name: 'Stable' },
    { id: 'removed', type: 'service', name: 'Removed' },
  ],
  relations: [{ id: 'rel-removed', type: 'calls', from: 'stable', to: 'removed' }],
};

const afterDoc: SemanticDocument = {
  version: '1',
  schemaRefs: [],
  entities: [
    { id: 'stable', type: 'service', name: 'Stable v2' },
    { id: 'added', type: 'service', name: 'Added' },
  ],
  relations: [{ id: 'rel-added', type: 'calls', from: 'stable', to: 'added' }],
};

describe('diff io', () => {
  it('serializes sparse diff documents and ingests them back into typed diffs', () => {
    const fullDiff = diffSemanticDiagramDocuments({ before: beforeDoc, after: afterDoc });
    const serialized = serializeSemanticDiagramDiff(fullDiff);

    expect(serialized).not.toMatch(/unchanged/);

    const ingested = ingestSemanticDiagramDiff(serialized);
    expect(ingested.ok).toBe(true);
    expect(ingested.value).toMatchObject({
      kind: 'semantic-diagram-diff',
      version: 1,
      entities: [
        expect.objectContaining({ entityId: 'added', change: 'added' }),
        expect.objectContaining({ entityId: 'removed', change: 'removed' }),
        expect.objectContaining({
          entityId: 'stable',
          change: 'changed',
          changedFields: ['name'],
        }),
      ],
      relations: [
        expect.objectContaining({ relationId: 'rel-added', change: 'added' }),
        expect.objectContaining({ relationId: 'rel-removed', change: 'removed' }),
      ],
    });
  });

  it('returns the shared yaml parse diagnostic for malformed diff yaml', () => {
    const result = ingestSemanticDiagramDiff('kind: semantic-diagram-diff\nversion: [broken');

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        domain: 'diagram',
        phase: 'parse',
        code: 'semantic.parse.invalid_yaml',
      }),
    ]);
  });

  it('rejects invalid diff root shape and unsupported metadata', () => {
    const result = ingestSemanticDiagramDiff(`kind: wrong-kind
version: 2
entities: []
relations: []
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'diagram.diff.invalid_kind' }),
        expect.objectContaining({ code: 'diagram.diff.unsupported_version' }),
      ]),
    );
  });

  it('rejects duplicate ids', () => {
    const invalidDiff: SemanticDiagramDiff = {
      kind: 'semantic-diagram-diff',
      version: 1,
      entities: [
        {
          entityId: 'stable',
          change: 'changed',
          before: beforeDoc.entities[0],
          after: afterDoc.entities[0],
          changedFields: ['name'],
        },
        {
          entityId: 'stable',
          change: 'changed',
          before: beforeDoc.entities[0],
          after: afterDoc.entities[0],
          changedFields: ['name'],
        },
      ],
      relations: [],
    };

    const result = ingestSemanticDiagramDiff(serializeSemanticDiagramDiff(invalidDiff));

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'diagram.diff.duplicate_entity_id' }),
      ]),
    );
  });

  it('rejects unchanged entries in serialized diff documents', () => {
    const result = ingestSemanticDiagramDiff(`kind: semantic-diagram-diff
version: 1
entities: []
relations:
  - relationId: rel-removed
    change: unchanged
    before:
      id: rel-removed
      type: calls
      from: stable
      to: removed
    after:
      id: rel-removed
      type: calls
      from: stable
      to: removed
    changedFields: []
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'diagram.diff.invalid_change' })]),
    );
  });

  it('rejects invalid change shapes', () => {
    const result = ingestSemanticDiagramDiff(`kind: semantic-diagram-diff
version: 1
entities:
  - entityId: broken
    change: added
    before:
      id: broken
      type: service
    changedFields:
      - name
relations: []
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'diagram.diff.invalid_change_shape' }),
        expect.objectContaining({ code: 'diagram.diff.invalid_changed_fields' }),
      ]),
    );
  });
});
