import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { buildSchemaActivation } from '../model/schema-ref';
import type { SemanticDocument, SemanticSourceDocument } from '../model/types';
import {
  parseDocument,
  parseSourceDocument,
  serializeDocument,
  serializeSourceDocument,
} from './serialization';

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

describe('document serialization', () => {
  it('parses nested entity YAML into nested entities', () => {
    const raw = `
version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app-1
    type: application
    name: Checkout
    children:
      - id: api-1
        type: api
        name: API
        children:
          - id: endpoint-1
            type: api-endpoint
            name: Create order
relations: []
`;
    const doc = parseDocument(raw);
    expect(doc.entities).toHaveLength(1);
    expect(doc.entities[0]?.id).toBe('app-1');
    expect(doc.entities[0]?.name).toBe('Checkout');
    expect(doc.entities[0]?.children?.[0]?.id).toBe('api-1');
    expect(doc.entities[0]?.children?.[0]?.children?.[0]?.id).toBe('endpoint-1');
  });

  it('trims surrounding whitespace from parsed names', () => {
    const raw = `
version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app-1
    type: application
    name: "  Checkout  "
relations: []
`;
    const doc = parseDocument(raw);
    expect(doc.entities[0]?.name).toBe('Checkout');
  });

  it('serializes nested entities into nested YAML children', () => {
    const doc: SemanticDocument = {
      version: '0.1.0',
      schemaRefs: [act('core/web-app@0.3')],
      entities: [
        {
          id: 'app-1',
          type: 'application',
          name: 'Checkout',
          children: [
            {
              id: 'api-1',
              type: 'api',
              name: 'API',
              children: [{ id: 'endpoint-1', type: 'api-endpoint', name: 'Create order' }],
            },
          ],
        },
      ],
      relations: [],
    };

    const serialized = serializeDocument(doc);
    const parsed = load(serialized) as {
      entities: Array<Record<string, unknown>>;
    };
    expect(parsed.entities.length).toBe(1);
    const root = parsed.entities[0] as {
      id: string;
      children?: Array<{ id: string; children?: Array<{ id: string }> }>;
    };
    expect(root.id).toBe('app-1');
    expect(root.children?.[0]?.id).toBe('api-1');
    expect(root.children?.[0]?.children?.[0]?.id).toBe('endpoint-1');
  });

  it('round-trips nameless entities without injecting fallback names', () => {
    const doc: SemanticDocument = {
      version: '0.1.0',
      schemaRefs: [act('core/web-app@0.3')],
      entities: [
        {
          id: 'app-1',
          type: 'application',
          children: [
            {
              id: 'api-1',
              type: 'api',
            },
          ],
        },
      ],
      relations: [],
    };

    const serialized = serializeDocument(doc);
    expect(serialized).not.toContain('name: Unnamed');
    expect(serialized).not.toContain('name: API');

    const parsed = parseDocument(serialized);
    expect(parsed.entities[0]?.name).toBeUndefined();
    expect(parsed.entities[0]?.children?.[0]?.name).toBeUndefined();
  });

  it('generates opaque ids for entities and relations when missing', () => {
    const raw = `
version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - type: application
    name: Checkout
  - id: db-1
    type: relational-db
relations:
  - from: db-1
    to: db-1
`;
    const doc = parseDocument(raw);
    expect(doc.entities).toHaveLength(2);
    expect(doc.relations).toHaveLength(1);
    const entityIds = new Set(doc.entities.map((entity) => entity.id));
    expect(entityIds.size).toBe(2);
    for (const entity of doc.entities) {
      expect(entity.id.length).toBeGreaterThan(0);
    }
    expect(doc.relations[0]?.id.length).toBeGreaterThan(0);
  });

  it('round-trips absolute git provenance', () => {
    const doc: SemanticDocument = {
      version: '0.1.0',
      schemaRefs: [act('core/web-app@0.3')],
      entities: [
        {
          id: 'service-1',
          type: 'application',
          provenance: {
            confidence: 0.9,
            locations: [
              {
                repo: 'https://github.com/example/repo',
                commit: '0123456789abcdef0123456789abcdef01234567',
                path: 'src/service.ts',
                symbol: 'service',
              },
            ],
          },
        },
      ],
      relations: [
        {
          id: 'rel-1',
          from: 'service-1',
          to: 'service-1',
          provenance: {
            locations: [
              {
                repo: 'https://github.com/example/repo',
                commit: '0123456789abcdef0123456789abcdef01234567',
                path: 'src/service.ts',
                note: 'derived from call graph',
              },
            ],
          },
        },
      ],
    };

    const parsed = parseDocument(serializeDocument(doc));
    expect(parsed.entities[0]?.provenance).toEqual(doc.entities[0]?.provenance);
    expect(parsed.relations[0]?.provenance).toEqual(doc.relations[0]?.provenance);
  });

  it('round-trips entity and relation descriptions', () => {
    const doc: SemanticDocument = {
      version: '0.1.0',
      schemaRefs: [act('core/web-app@0.3')],
      entities: [
        {
          id: 'service-1',
          type: 'application',
          description: 'Primary request-handling runtime.',
        },
      ],
      relations: [
        {
          id: 'rel-1',
          from: 'service-1',
          to: 'service-1',
          description: 'Internal feedback path.',
        },
      ],
    };

    const parsed = parseDocument(serializeDocument(doc));
    expect(parsed.entities[0]?.description).toBe('Primary request-handling runtime.');
    expect(parsed.relations[0]?.description).toBe('Internal feedback path.');
  });

  it('parses and serializes source imports separately from compiled documents', () => {
    const doc: SemanticSourceDocument = {
      version: '0.1.0',
      schemaRefs: [act('core/web-app@0.3')],
      imports: [{ slug: 'billing', namespace: 'billing' }],
      entities: [],
      relations: [],
      metadata: { name: 'Platform' },
    };

    const parsed = parseSourceDocument(serializeSourceDocument(doc));
    expect(parsed.imports).toEqual(doc.imports);
    expect(() => parseDocument(serializeSourceDocument(doc))).toThrow(
      /require source compilation/i,
    );
  });
});
