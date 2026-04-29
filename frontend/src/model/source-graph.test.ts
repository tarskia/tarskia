import { describe, expect, it } from 'vitest';
import { serializeSourceDocument } from '../util/serialization';
import type { DiagramStoreSnapshot, DiagramStream } from './diagram-store';
import { buildSchemaActivation } from './schema-ref';
import { compileSourceGraph, createSnapshotSourceGraphResolver } from './source-graph';
import type { SemanticSourceDocument } from './types';

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

const createStream = (params: {
  id: string;
  name: string;
  slug: string;
  raw: string;
}): DiagramStream => ({
  id: params.id,
  name: params.name,
  slug: params.slug,
  scope: { kind: 'personal', id: 'local', label: 'Personal' },
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  streamVersion: 1,
  headRevisionId: `${params.id}-rev-1`,
  revisions: [
    {
      id: `${params.id}-rev-1`,
      name: params.name,
      raw: params.raw,
      checkpointedAt: new Date(0).toISOString(),
      valid: true,
      summaryLines: [],
    },
  ],
});

const toRaw = (doc: SemanticSourceDocument) => serializeSourceDocument(doc);

describe('source graph compilation', () => {
  it('leaves plain single-file diagrams unchanged', () => {
    const raw = toRaw({
      version: '0.1.0',
      schemaRefs: [act('core/web-app@0.3')],
      entities: [{ id: 'app', type: 'core/web-app.types.application' }],
      relations: [],
      metadata: { name: 'Platform' },
    });

    const compiled = compileSourceGraph({ raw, sourceLabel: 'platform' });
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.result?.hasImports).toBe(false);
    expect(compiled.result?.doc.entities[0]?.id).toBe('app');
    expect(compiled.result?.doc.metadata?.name).toBe('Platform');
  });

  it('namespaces imported ids and strips imported view/layout', () => {
    const snapshot: DiagramStoreSnapshot = {
      streams: [
        createStream({
          id: 'billing',
          name: 'Billing',
          slug: 'billing',
          raw: toRaw({
            version: '0.1.0',
            schemaRefs: [act('core/web-app@0.3')],
            entities: [{ id: 'api', type: 'core/web-app.types.service' }],
            relations: [],
            view: {
              kind: 'semantic-diagram-view',
              version: 2,
              nodesById: { api: { expanded: true } },
              layout: {
                viewport: { x: 10, y: 20, zoom: 0.8 },
              },
            },
            metadata: { name: 'Billing child' },
          }),
        }),
      ],
    };

    const rootRaw = toRaw({
      version: '0.1.0',
      schemaRefs: [act('core/web-app@0.3')],
      imports: [{ slug: 'billing', namespace: 'billing' }],
      entities: [{ id: 'web', type: 'core/web-app.types.application' }],
      relations: [
        {
          id: 'calls-billing',
          type: 'core/software.relations.calls',
          from: 'web',
          to: 'billing/api',
        },
      ],
      view: {
        kind: 'semantic-diagram-view',
        version: 2,
        nodesById: { web: { expanded: true } },
        layout: {
          viewport: { x: 1, y: 2, zoom: 1 },
        },
      },
      metadata: { name: 'Root' },
    });

    const compiled = compileSourceGraph({
      raw: rootRaw,
      sourceLabel: 'root',
      resolver: createSnapshotSourceGraphResolver(snapshot),
    });

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.result?.hasImports).toBe(true);
    expect(compiled.result?.doc.entities.map((entity) => entity.id)).toEqual([
      'web',
      'billing/api',
    ]);
    expect(compiled.result?.doc.view?.nodesById).toEqual({ web: { expanded: true } });
    expect(compiled.result?.doc.view?.layout?.viewport).toEqual({ x: 1, y: 2, zoom: 1 });
    expect(compiled.result?.doc.metadata?.name).toBe('Root');
  });

  it('stacks namespaces transitively and rewrites child-import references relatively', () => {
    const snapshot: DiagramStoreSnapshot = {
      streams: [
        createStream({
          id: 'checkout',
          name: 'Checkout',
          slug: 'checkout',
          raw: toRaw({
            version: '0.1.0',
            schemaRefs: [act('core/web-app@0.3')],
            entities: [{ id: 'button', type: 'core/web-app.types.service' }],
            relations: [],
          }),
        }),
        createStream({
          id: 'storefront',
          name: 'Storefront',
          slug: 'storefront',
          raw: toRaw({
            version: '0.1.0',
            schemaRefs: [act('core/web-app@0.3')],
            imports: [{ slug: 'checkout', namespace: 'checkout' }],
            entities: [{ id: 'app', type: 'core/web-app.types.application' }],
            relations: [
              {
                id: 'uses-button',
                type: 'core/software.relations.calls',
                from: 'app',
                to: 'checkout/button',
              },
            ],
          }),
        }),
      ],
    };

    const rootRaw = toRaw({
      version: '0.1.0',
      schemaRefs: [act('core/web-app@0.3')],
      imports: [{ slug: 'storefront', namespace: 'storefront' }],
      entities: [],
      relations: [],
    });

    const compiled = compileSourceGraph({
      raw: rootRaw,
      sourceLabel: 'root',
      resolver: createSnapshotSourceGraphResolver(snapshot),
    });

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.result?.doc.entities.map((entity) => entity.id)).toEqual([
      'storefront/app',
      'storefront/checkout/button',
    ]);
    expect(compiled.result?.doc.relations[0]).toMatchObject({
      id: 'storefront/uses-button',
      from: 'storefront/app',
      to: 'storefront/checkout/button',
    });
  });

  it('reports unresolved imports, cycles, and conflicting schema pins', () => {
    const cyclicSnapshot: DiagramStoreSnapshot = {
      streams: [
        createStream({
          id: 'cycle-a',
          name: 'Cycle A',
          slug: 'cycle-a',
          raw: toRaw({
            version: '0.1.0',
            schemaRefs: [act('core/web-app@0.3')],
            imports: [{ slug: 'cycle-b', namespace: 'b' }],
            entities: [],
            relations: [],
          }),
        }),
        createStream({
          id: 'cycle-b',
          name: 'Cycle B',
          slug: 'cycle-b',
          raw: toRaw({
            version: '0.1.0',
            schemaRefs: [act('core/web-app@0.3')],
            imports: [{ slug: 'cycle-a', namespace: 'a' }],
            entities: [],
            relations: [],
          }),
        }),
      ],
    };

    const missingImport = compileSourceGraph({
      raw: toRaw({
        version: '0.1.0',
        schemaRefs: [act('core/web-app@0.3')],
        imports: [{ slug: 'missing', namespace: 'missing' }],
        entities: [],
        relations: [],
      }),
      sourceLabel: 'root',
      resolver: createSnapshotSourceGraphResolver({ streams: [] }),
    });
    expect(missingImport.result).toBeUndefined();
    expect(
      missingImport.diagnostics.some((d) => d.code === 'diagram.source.import_not_found'),
    ).toBe(true);

    const cycle = compileSourceGraph({
      raw: toRaw({
        version: '0.1.0',
        schemaRefs: [act('core/web-app@0.3')],
        imports: [{ slug: 'cycle-a', namespace: 'a' }],
        entities: [],
        relations: [],
      }),
      sourceLabel: 'root',
      resolver: createSnapshotSourceGraphResolver(cyclicSnapshot),
    });
    expect(cycle.result).toBeUndefined();
    expect(cycle.diagnostics.some((d) => d.code === 'diagram.source.import_cycle')).toBe(true);

    const conflicting = compileSourceGraph({
      raw: toRaw({
        version: '0.1.0',
        schemaRefs: [act('core/web-app@0.3')],
        imports: [{ slug: 'storefront', namespace: 'storefront' }],
        entities: [],
        relations: [],
      }),
      sourceLabel: 'root',
      resolver: createSnapshotSourceGraphResolver({
        streams: [
          createStream({
            id: 'storefront',
            name: 'Storefront',
            slug: 'storefront',
            raw: toRaw({
              version: '0.1.0',
              schemaRefs: [act('core/web-app@0.4')],
              entities: [],
              relations: [],
            }),
          }),
        ],
      }),
    });
    expect(conflicting.result).toBeUndefined();
    expect(
      conflicting.diagnostics.some((d) => d.code === 'diagram.source.conflicting_schema_ref'),
    ).toBe(true);
  });
});
