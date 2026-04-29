import { describe, expect, it } from 'vitest';
import { serializeDocument } from '../util/serialization';
import {
  buildDiagramCheckpointSummary,
  hasMeaningfulDiagramCheckpointChanges,
} from './diagram-changelog';
import { buildSchemaActivation } from './schema-ref';
import type { SemanticDocument } from './types';

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

const baseDoc: SemanticDocument = {
  version: '0.1.0',
  schemaRefs: [act('core/web-app@0.3')],
  metadata: { name: 'Payments' },
  entities: [{ id: 'service-payments', type: 'core/web-app.types.application', name: 'Payments' }],
  relations: [],
};

describe('diagram changelog', () => {
  it('builds an initial checkpoint summary', () => {
    const summary = buildDiagramCheckpointSummary({
      nextRaw: serializeDocument(baseDoc),
    });

    expect(summary).toEqual([
      'Initial checkpoint for Payments',
      '1 schema activation',
      '1 entity, 0 relations',
    ]);
  });

  it('reports semantic changes between revisions', () => {
    const nextDoc: SemanticDocument = {
      ...baseDoc,
      entities: [
        ...baseDoc.entities,
        { id: 'api-payments', type: 'core/web-app.types.api', name: 'Payments API' },
      ],
      relations: [
        {
          id: 'rel-1',
          type: 'core/software.relations.calls',
          from: 'service-payments',
          to: 'api-payments',
        },
      ],
    };
    const summary = buildDiagramCheckpointSummary({
      previousRaw: serializeDocument(baseDoc),
      nextRaw: serializeDocument(nextDoc),
    });

    expect(summary).toContain('Added 1 entity');
    expect(summary).toContain('Added 1 relation');
  });

  it('reports view-only changes distinctly', () => {
    const previous = serializeDocument(baseDoc);
    const next = serializeDocument({
      ...baseDoc,
      view: {
        kind: 'semantic-diagram-view',
        version: 2,
        layout: {
          viewport: { x: 10, y: 20, zoom: 0.9 },
        },
      },
    });

    expect(
      buildDiagramCheckpointSummary({
        previousRaw: previous,
        nextRaw: next,
      }),
    ).toEqual(['Updated view state']);
  });

  it('treats view-only summaries as non-meaningful for checkpoint gating', () => {
    expect(hasMeaningfulDiagramCheckpointChanges(['Updated view state'])).toBe(false);
    expect(hasMeaningfulDiagramCheckpointChanges(['No effective changes'])).toBe(false);
    expect(hasMeaningfulDiagramCheckpointChanges(['Added 1 entity', 'Updated view state'])).toBe(
      true,
    );
  });
});
