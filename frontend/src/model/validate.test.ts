import { describe, expect, it } from 'vitest';
import baseRaw from '../schemas/base.yaml?raw';
import codeRaw from '../schemas/code.yaml?raw';
import dataModelRaw from '../schemas/data-model.yaml?raw';
import frontendRaw from '../schemas/frontend.yaml?raw';
import kubernetesRaw from '../schemas/kubernetes.yaml?raw';
import softwareRaw from '../schemas/software.yaml?raw';
import webAppRaw from '../schemas/web-app.yaml?raw';
import { sampleDiagramRaw } from '../semantic/bundled-diagrams';
import { parseDocument, parseSchema } from '../util/serialization';
import { diagnosticsToMessages } from './diagnostics';
import { buildSchemaActivation } from './schema-ref';
import { buildRawSchemaSet, buildSchemaRuntime, buildSchemaSelection } from './schema-runtime';
import type { SchemaModule, SemanticDocument } from './types';
import { validateDocument } from './validate';

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

const schema: SchemaModule = {
  owner: 'user',
  name: 'test',
  version: '1',
  types: [
    {
      id: 'table',
      label: 'Table',
      naming: { required: true },
    },
    {
      id: 'api',
      label: 'API',
      naming: { required: false },
    },
  ],
  relations: [],
};

const buildBundledSchema = (activations?: SemanticDocument['schemaRefs']) => {
  const raw = buildRawSchemaSet([
    parseSchema(baseRaw),
    parseSchema(softwareRaw),
    parseSchema(webAppRaw),
    parseSchema(codeRaw),
    parseSchema(frontendRaw),
    parseSchema(dataModelRaw),
    parseSchema(kubernetesRaw),
  ]);
  return buildSchemaRuntime({
    raw,
    selection: buildSchemaSelection({ raw, activations }),
  }).resolved.effectiveSchema;
};

describe('validateDocument naming', () => {
  it('rejects nameless entities for required-name types', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [{ id: 't1', type: 'table' }],
      relations: [],
    };
    const diagnostics = validateDocument(doc, schema);
    expect(diagnosticsToMessages(diagnostics)).toContain('Entity t1 (table) requires a name');
  });

  it('allows nameless entities for optional-name types', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [{ id: 'api-1', type: 'api' }],
      relations: [],
    };
    const diagnostics = validateDocument(doc, schema);
    expect(diagnostics).toHaveLength(0);
  });

  it('sample document satisfies naming.required constraints', () => {
    const raw = buildRawSchemaSet([
      parseSchema(baseRaw),
      parseSchema(softwareRaw),
      parseSchema(webAppRaw),
      parseSchema(codeRaw),
      parseSchema(frontendRaw),
      parseSchema(dataModelRaw),
      parseSchema(kubernetesRaw),
    ]);
    const runtime = buildSchemaRuntime({
      raw,
      selection: buildSchemaSelection({ raw }),
    });
    const sampleDoc = parseDocument(sampleDiagramRaw);
    const diagnostics = validateDocument(sampleDoc, runtime.resolved.effectiveSchema);
    const errors = diagnosticsToMessages(diagnostics);
    const namingErrors = errors.filter((error) => error.includes('requires a name'));
    expect(namingErrors).toEqual([]);
    const endpointErrors = errors.filter((error) => error.includes('invalid endpoints'));
    expect(endpointErrors).toEqual([]);
  });
});

describe('validateDocument bundled schema containment', () => {
  it('rejects frontend runtime children that are not allowed by the base frontend schema', () => {
    const bundledSchema = buildBundledSchema([act('core/web-app@0.3'), act('core/frontend@0.3')]);
    const doc: SemanticDocument = {
      version: '0.1.0',
      schemaRefs: [act('core/web-app@0.3'), act('core/frontend@0.3')],
      entities: [
        {
          id: 'frontend-app',
          type: 'core/frontend.types.frontend',
          children: [
            {
              id: 'service-shell',
              type: 'core/web-app.types.service',
            },
          ],
        },
      ],
      relations: [],
    };

    expect(diagnosticsToMessages(validateDocument(doc, bundledSchema))).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Entity service-shell has invalid parent frontend-app'),
      ]),
    );
  });

  it('allows frontends to contain code modules via adjacent-layer containment', () => {
    const bundledSchema = buildBundledSchema([
      act('core/web-app@0.3'),
      act('core/frontend@0.3'),
      act('core/code@0.1', 1),
    ]);
    const doc: SemanticDocument = {
      version: '0.1.0',
      schemaRefs: [act('core/web-app@0.3'), act('core/frontend@0.3'), act('core/code@0.1', 1)],
      entities: [
        {
          id: 'frontend-app',
          type: 'core/frontend.types.frontend',
          children: [
            {
              id: 'module-shell',
              type: 'core/code.types.module',
            },
          ],
        },
      ],
      relations: [],
    };

    expect(validateDocument(doc, bundledSchema)).toEqual([]);
  });

  it('allows neutral software systems to contain runtime boundaries and deeper code modules', () => {
    const bundledSchema = buildBundledSchema([
      act('core/software@0.1'),
      act('core/web-app@0.3'),
      act('core/code@0.1', 1),
    ]);
    const doc: SemanticDocument = {
      version: '0.1.0',
      schemaRefs: [act('core/software@0.1'), act('core/web-app@0.3'), act('core/code@0.1', 1)],
      entities: [
        {
          id: 'clickhouse',
          type: 'core/software.types.system',
          children: [
            {
              id: 'server-runtime',
              type: 'core/web-app.types.service',
            },
            {
              id: 'planner-module',
              type: 'core/code.types.module',
            },
          ],
        },
      ],
      relations: [],
    };

    expect(validateDocument(doc, bundledSchema)).toEqual([]);
  });

  it('allows code modules to contain structural groups despite the group type living on a lower layer', () => {
    const bundledSchema = buildBundledSchema([act('core/web-app@0.3'), act('core/code@0.1', 1)]);
    const doc: SemanticDocument = {
      version: '0.1.0',
      schemaRefs: [act('core/web-app@0.3'), act('core/code@0.1', 1)],
      entities: [
        {
          id: 'module-root',
          type: 'core/code.types.module',
          children: [
            {
              id: 'mixed-group',
              type: 'core/web-app.types.group',
              props: { mode: 'mixed' },
            },
          ],
        },
      ],
      relations: [],
    };

    expect(validateDocument(doc, bundledSchema)).toEqual([]);
  });

  it('allows typed groups to contain subgroup wrappers', () => {
    const bundledSchema = buildBundledSchema([act('core/web-app@0.3'), act('core/code@0.1', 1)]);
    const doc: SemanticDocument = {
      version: '0.1.0',
      schemaRefs: [act('core/web-app@0.3'), act('core/code@0.1', 1)],
      entities: [
        {
          id: 'module-family',
          type: 'core/web-app.types.group',
          props: { mode: 'typed', groupType: 'core/code.types.module' },
          children: [
            {
              id: 'read-modules',
              type: 'core/web-app.types.group',
              props: { mode: 'typed', groupType: 'core/code.types.module' },
            },
          ],
        },
      ],
      relations: [],
    };

    expect(validateDocument(doc, bundledSchema)).toEqual([]);
  });
});

describe('validateDocument relation direction', () => {
  const directedSchema: SchemaModule = {
    owner: 'user',
    name: 'direction',
    version: '1',
    traits: [
      {
        id: 'client-like',
        label: 'Client-like',
        relationParticipation: [
          { relation: 'calls', endpoint: 'from' },
          { relation: 'linked', endpoint: 'from' },
        ],
      },
      {
        id: 'service-like',
        label: 'Service-like',
        relationParticipation: [
          { relation: 'calls', endpoint: 'to' },
          { relation: 'linked', endpoint: 'to' },
        ],
      },
    ],
    types: [
      { id: 'client', label: 'Client', traits: ['client-like'] },
      { id: 'service', label: 'Service', traits: ['service-like'] },
    ],
    relations: [
      {
        id: 'calls',
        label: 'calls',
      },
      {
        id: 'linked',
        label: 'linked',
        directed: false,
      },
    ],
  };

  it('rejects reversed endpoints for directed relations', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'svc-1', type: 'service' },
        { id: 'cli-1', type: 'client' },
      ],
      relations: [{ id: 'rel-1', type: 'calls', from: 'svc-1', to: 'cli-1' }],
    };
    const diagnostics = validateDocument(doc, directedSchema);
    expect(diagnosticsToMessages(diagnostics)).toContain(
      'Relation rel-1 has invalid endpoints for calls',
    );
  });

  it('allows reversed endpoints for undirected relations', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'svc-1', type: 'service' },
        { id: 'cli-1', type: 'client' },
      ],
      relations: [{ id: 'rel-2', type: 'linked', from: 'svc-1', to: 'cli-1' }],
    };
    const diagnostics = validateDocument(doc, directedSchema);
    expect(diagnostics).toEqual([]);
  });
});

describe('validateDocument relation properties', () => {
  const relationSchema: SchemaModule = {
    owner: 'user',
    name: 'relation-props',
    version: '1',
    traits: [
      {
        id: 'client-like',
        label: 'Client-like',
        relationParticipation: [{ relation: 'calls-http', endpoint: 'from' }],
      },
      {
        id: 'service-like',
        label: 'Service-like',
        relationParticipation: [{ relation: 'calls-http', endpoint: 'to' }],
      },
    ],
    types: [
      { id: 'client', label: 'Client', traits: ['client-like'] },
      { id: 'service', label: 'Service', traits: ['service-like'] },
    ],
    relations: [
      {
        id: 'calls-http',
        label: 'calls',
        properties: [
          { id: 'method', type: 'enum', values: ['GET', 'POST'] },
          { id: 'path', type: 'string' },
          {
            id: 'response',
            type: 'object',
            properties: [{ id: 'schema', type: 'string' }],
          },
        ],
      },
    ],
  };

  it('accepts valid relation props', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'cli-1', type: 'client' },
        { id: 'svc-1', type: 'service' },
      ],
      relations: [
        {
          id: 'rel-1',
          type: 'calls-http',
          from: 'cli-1',
          to: 'svc-1',
          props: {
            method: 'POST',
            path: '/users',
            response: { schema: 'user' },
          },
        },
      ],
    };

    expect(validateDocument(doc, relationSchema)).toEqual([]);
  });

  it('rejects unknown relation props', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'cli-1', type: 'client' },
        { id: 'svc-1', type: 'service' },
      ],
      relations: [
        {
          id: 'rel-2',
          type: 'calls-http',
          from: 'cli-1',
          to: 'svc-1',
          props: { timeoutMs: 1000 },
        },
      ],
    };

    expect(diagnosticsToMessages(validateDocument(doc, relationSchema))).toContain(
      'Relation rel-2 uses unknown property timeoutMs',
    );
  });

  it('rejects invalid relation prop types and nested values', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [],
      entities: [
        { id: 'cli-1', type: 'client' },
        { id: 'svc-1', type: 'service' },
      ],
      relations: [
        {
          id: 'rel-3',
          type: 'calls-http',
          from: 'cli-1',
          to: 'svc-1',
          props: {
            method: 'PATCH',
            path: 42,
            response: { schema: false, extra: 'ignored' },
          },
        },
      ],
    };

    expect(diagnosticsToMessages(validateDocument(doc, relationSchema))).toEqual(
      expect.arrayContaining([
        'Relation rel-3 property method must be one of GET, POST',
        'Relation rel-3 property path must be a string',
        'Relation rel-3 property response.schema must be a string',
        'Relation rel-3 uses unknown property response.extra',
      ]),
    );
  });
});

describe('validateDocument bundled schema behavior', () => {
  it('allows services to contain services and apis', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [act('core/web-app@0.3')],
      entities: [
        {
          id: 'app',
          type: 'core/web-app.types.application',
          name: 'App',
          children: [
            {
              id: 'svc-parent',
              type: 'core/web-app.types.service',
              name: 'Parent Service',
              children: [
                {
                  id: 'svc-child',
                  type: 'core/web-app.types.service',
                  name: 'Child Service',
                },
                {
                  id: 'api-child',
                  type: 'core/web-app.types.api',
                  name: 'Private API',
                },
              ],
            },
          ],
        },
      ],
      relations: [],
    };

    expect(validateDocument(doc, buildBundledSchema([act('core/web-app@0.3')]))).toEqual([]);
  });

  it('allows modules under runtime nodes and nested modules with layered schema activations', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [act('core/web-app@0.3'), act('core/code@0.1', 1)],
      entities: [
        {
          id: 'app',
          type: 'core/web-app.types.application',
          name: 'App',
          children: [
            {
              id: 'app-module',
              type: 'core/code.types.module',
              name: 'Shell',
              props: { language: 'typescript' },
            },
            {
              id: 'svc',
              type: 'core/web-app.types.service',
              name: 'Diagram Service',
              children: [
                {
                  id: 'svc-module',
                  type: 'core/code.types.module',
                  name: 'Layout Engine',
                  props: { language: 'typescript' },
                  children: [
                    {
                      id: 'nested-module',
                      type: 'core/code.types.module',
                      name: 'Layout Phases',
                      props: { language: 'typescript' },
                    },
                  ],
                },
              ],
            },
            {
              id: 'api',
              type: 'core/web-app.types.api',
              name: 'Diagram API',
              children: [
                {
                  id: 'api-module',
                  type: 'core/code.types.module',
                  name: 'Endpoint Surface',
                  props: { language: 'typescript' },
                },
                {
                  id: 'endpoint',
                  type: 'core/web-app.types.api-endpoint',
                  name: 'Mutate Diagram',
                  props: {
                    http: {
                      method: 'POST',
                      path: '/mutate',
                      auth: 'auth',
                    },
                  },
                  children: [
                    {
                      id: 'endpoint-module',
                      type: 'core/code.types.module',
                      name: 'Mutation Flow',
                      props: { language: 'typescript' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      relations: [],
    };

    expect(
      validateDocument(doc, buildBundledSchema([act('core/web-app@0.3'), act('core/code@0.1', 1)])),
    ).toEqual([]);
  });

  it('allows api-endpoints and modules to call modules with layered schema activations', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [act('core/web-app@0.3'), act('core/code@0.1', 1)],
      entities: [
        {
          id: 'app',
          type: 'core/web-app.types.application',
          name: 'App',
          children: [
            {
              id: 'api',
              type: 'core/web-app.types.api',
              name: 'Diagram API',
              children: [
                {
                  id: 'endpoint',
                  type: 'core/web-app.types.api-endpoint',
                  name: 'Create Diagram',
                  props: {
                    http: {
                      method: 'POST',
                      path: '/diagrams',
                      auth: 'auth',
                    },
                  },
                },
              ],
            },
            {
              id: 'module-a',
              type: 'core/code.types.module',
              name: 'Mutation Flow',
              props: { language: 'typescript' },
            },
            {
              id: 'module-b',
              type: 'core/code.types.module',
              name: 'Validation',
              props: { language: 'typescript' },
            },
          ],
        },
      ],
      relations: [
        {
          id: 'rel-endpoint-module',
          type: 'core/software.relations.calls',
          from: 'endpoint',
          to: 'module-a',
        },
        {
          id: 'rel-module-module',
          type: 'core/software.relations.calls',
          from: 'module-a',
          to: 'module-b',
        },
      ],
    };

    expect(
      validateDocument(doc, buildBundledSchema([act('core/web-app@0.3'), act('core/code@0.1', 1)])),
    ).toEqual([]);
  });

  it('allows modules to read and write storage targets with layered schema activations', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [act('core/web-app@0.3'), act('core/code@0.1', 1)],
      entities: [
        {
          id: 'app',
          type: 'core/web-app.types.application',
          name: 'App',
          children: [
            {
              id: 'module-a',
              type: 'core/code.types.module',
              name: 'Projection',
              props: { language: 'typescript' },
            },
          ],
        },
        {
          id: 'orders-db',
          type: 'core/web-app.types.relational-db',
          name: 'Orders DB',
          props: {
            implementation: 'postgres',
          },
        },
      ],
      relations: [
        {
          id: 'rel-module-reads-db',
          type: 'core/software.relations.reads',
          from: 'module-a',
          to: 'orders-db',
        },
        {
          id: 'rel-module-writes-db',
          type: 'core/software.relations.writes',
          from: 'module-a',
          to: 'orders-db',
        },
      ],
    };

    expect(
      validateDocument(doc, buildBundledSchema([act('core/web-app@0.3'), act('core/code@0.1', 1)])),
    ).toEqual([]);
  });

  it('rejects invalid service deployability values', () => {
    const doc: SemanticDocument = {
      version: '1',
      schemaRefs: [act('core/web-app@0.3')],
      entities: [
        {
          id: 'app',
          type: 'core/web-app.types.application',
          name: 'App',
          children: [
            {
              id: 'svc',
              type: 'core/web-app.types.service',
              name: 'Checkout Service',
              props: {
                deployability: 'sometimes',
              },
            },
          ],
        },
      ],
      relations: [],
    };

    expect(
      diagnosticsToMessages(validateDocument(doc, buildBundledSchema([act('core/web-app@0.3')]))),
    ).toContain('Entity svc property deployability must be one of embedded, deployable');
  });
});
