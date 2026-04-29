import { describe, expect, it } from 'vitest';
import type { SchemaModule, SemanticDocument } from '../../model/types';
import { buildDiagramViewForSearchReveal, searchDiagramText } from './search';

const schema: SchemaModule = {
  owner: 'core',
  name: 'search-test',
  version: '1',
  types: [
    { id: 'service', label: 'Service' },
    { id: 'api', label: 'API' },
    { id: 'database', label: 'Database' },
    { id: 'table', label: 'Table' },
  ],
  relations: [{ id: 'reads', label: 'Reads', shortLabel: 'read' }],
};

const doc: SemanticDocument = {
  version: '1',
  schemaRefs: [],
  entities: [
    { id: 'orders', type: 'service', name: 'Orders Service' },
    { id: 'orders-api', type: 'api', name: 'Orders API', parent: 'orders' },
    { id: 'orders-db', type: 'database', name: 'Orders DB' },
    { id: 'orders-table', type: 'table', name: 'orders', parent: 'orders-db' },
  ],
  relations: [
    {
      id: 'rel-1',
      type: 'reads',
      from: 'orders-api',
      to: 'orders-table',
    },
  ],
};

describe('searchDiagramText', () => {
  it('matches entities by label and type text', () => {
    const entityMatch = searchDiagramText({ doc, schema, query: 'orders api' });
    const typeMatch = searchDiagramText({ doc, schema, query: 'database' });

    expect([...entityMatch.matchingEntityIds]).toEqual(['orders-api']);
    expect([...typeMatch.matchingEntityIds]).toEqual(['orders-db']);
  });

  it('matches nested child entities, not just top-level document entries', () => {
    const nestedDoc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        {
          id: 'checkout',
          type: 'service',
          name: 'Checkout Service',
          children: [
            {
              id: 'workflow',
              type: 'api',
              name: 'Create Order Flow',
            },
          ],
        },
      ],
      relations: [],
    };

    const matches = searchDiagramText({ doc: nestedDoc, schema, query: 'create order flow' });

    expect([...matches.matchingEntityIds]).toEqual(['workflow']);
  });

  it('matches relations by relation and endpoint text', () => {
    const relationByLabel = searchDiagramText({ doc, schema, query: 'read' });
    const relationByEndpoint = searchDiagramText({ doc, schema, query: 'orders table' });

    expect([...relationByLabel.matchingRelationIds]).toEqual(['rel-1']);
    expect([...relationByLabel.matchingRelationEndpointIds].sort()).toEqual([
      'orders-api',
      'orders-table',
    ]);
    expect([...relationByEndpoint.matchingRelationIds]).toEqual(['rel-1']);
  });
});

describe('buildDiagramViewForSearchReveal', () => {
  it('expands ancestor chains for matches and clears scope/filter directives', () => {
    const matches = searchDiagramText({ doc, schema, query: 'read' });
    const view = buildDiagramViewForSearchReveal({
      doc: {
        ...doc,
        view: {
          kind: 'semantic-diagram-view',
          version: 2,
          scopeRootId: 'orders',
          nodesById: {
            orders: { expanded: true },
          },
        },
      },
      matchingEntityIds: matches.matchingEntityIds,
      matchingRelationIds: matches.matchingRelationIds,
    });

    expect(view.scopeRootId).toBeUndefined();
    expect(view.nodesById?.orders?.expanded).toBe(true);
    expect(view.nodesById?.['orders-db']?.expanded).toBe(true);
  });
});
