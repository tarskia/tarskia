import { describe, expect, it } from 'vitest';
import type { DiagramStoreSnapshot } from '../semantic';
import {
  buildSchemaActivation,
  buildSchemaVersionCatalog,
  serializeSourceDocument,
} from '../semantic';
import { semanticBootstrap } from '../semantic/bootstrap';
import { formatDiagramImportFailureNotice, prepareImportedDiagram } from './imported-diagram';

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

const schemaVersionCatalog = buildSchemaVersionCatalog(
  semanticBootstrap.builtInSchemaCatalogEntries,
);

describe('prepareImportedDiagram', () => {
  it('accepts canonical diagram documents', () => {
    const result = prepareImportedDiagram({
      raw: `
version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
metadata:
  name: Payments
entities:
  - id: app
    type: core/web-app.types.application
relations: []
`,
      schemaVersionCatalog,
      sourceLabel: 'payments.yaml',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected canonical import to succeed');
    }

    expect(result.loaded.doc.metadata?.name).toBe('Payments');
    expect(result.loaded.sourceDiagnostics).toEqual([]);
  });

  it('accepts source diagrams that import other diagram files', () => {
    const billingRaw = serializeSourceDocument({
      version: '0.1.0',
      schemaRefs: [act('core/web-app@0.3')],
      entities: [{ id: 'api', type: 'core/web-app.types.service' }],
      relations: [],
      metadata: { name: 'Billing' },
    });
    const snapshot: DiagramStoreSnapshot = {
      streams: [
        {
          id: 'billing-stream',
          name: 'Billing',
          slug: 'billing',
          scope: { kind: 'personal', id: 'local', label: 'Personal' },
          createdAt: '2026-04-20T09:00:00.000Z',
          updatedAt: '2026-04-20T09:00:00.000Z',
          streamVersion: 1,
          headRevisionId: 'billing-rev-1',
          revisions: [
            {
              id: 'billing-rev-1',
              name: 'Billing',
              raw: billingRaw,
              checkpointedAt: '2026-04-20T09:00:00.000Z',
              valid: true,
              summaryLines: [],
            },
          ],
        },
      ],
    };

    const rootRaw = serializeSourceDocument({
      version: '0.1.0',
      schemaRefs: [act('core/web-app@0.3')],
      imports: [{ slug: 'billing', namespace: 'billing' }],
      entities: [{ id: 'web', type: 'core/web-app.types.application' }],
      relations: [],
      metadata: { name: 'Storefront' },
    });

    const result = prepareImportedDiagram({
      raw: rootRaw,
      schemaVersionCatalog,
      snapshot,
      sourceLabel: 'storefront.yaml',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected source import to succeed');
    }

    expect(result.loaded.doc.entities.map((entity) => entity.id)).toEqual(['web', 'billing/api']);
    expect(result.loaded.doc.metadata?.name).toBe('Storefront');
    expect(result.loaded.sourceDiagnostics).toEqual([]);
  });

  it('returns readable diagnostic notice lines for invalid imports', () => {
    const result = prepareImportedDiagram({
      raw: `
version: 0.1.0
schemaRefs: []
entities:
  - id: broken
relations: []
`,
      schemaVersionCatalog,
      sourceLabel: 'broken.yaml',
    });

    expect(result.ok).toBe(false);
    if (result.ok !== false) {
      throw new Error('Expected invalid import to fail');
    }

    expect(result.noticeLines[0]).toBe('Import failed.');
    expect(result.noticeLines.some((line) => line.includes('type'))).toBe(true);
  });

  it('formats import notices with the file name and truncates long diagnostics', () => {
    expect(
      formatDiagramImportFailureNotice('outline.diagram.yaml', [
        'Import failed.',
        'First issue.',
        'Second issue.',
        'Third issue.',
        'Fourth issue.',
        'Fifth issue.',
      ]),
    ).toBe(
      [
        'Failed to import outline.diagram.yaml.',
        'First issue.',
        'Second issue.',
        'Third issue.',
        'Fourth issue.',
        '...and 1 more issue.',
      ].join('\n'),
    );
  });
});
