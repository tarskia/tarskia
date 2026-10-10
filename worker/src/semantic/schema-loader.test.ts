import { promises as fs } from 'node:fs';
import path from 'node:path';
import { dump, load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { CANONICAL_EXAMPLE_YAML } from './diagram-synthesis-contract';
import { buildSchemaActivation } from './model/schema-ref';
import { compileSchemaSemantics, getResolvedTypeSemantics } from './model/schema-runtime';
import { STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS } from './model/validate';
import { loadSchemaRegistry, validateDiagramYaml } from './schema-loader';
import { parseDocument, serializeDocument } from './util/serialization';

const fixturePath = (...segments: string[]) =>
  path.resolve(process.cwd(), 'test', 'fixtures', ...segments);

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

async function loadSampleYaml(): Promise<string> {
  const raw = await fs.readFile(fixturePath('schema-repo', 'src', 'data', 'sample.yaml'), 'utf8');
  const document = load(raw) as Record<string, unknown>;
  // These tests exercise semantic validation, so replace the fixture's v1 view block.
  document.view = { kind: 'semantic-diagram-view', version: 3 };
  return dump(document);
}

describe('schema-loader', () => {
  it.each([0, 1])('rejects a repeated schema id at layer %i in final validation', async (layer) => {
    const schemaRegistry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const document = parseDocument(await loadSampleYaml());
    document.schemaRefs.push(act('core/web-app@0.3', layer));
    const result = validateDiagramYaml({ yaml: serializeDocument(document), schemaRegistry });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'diagram.document.duplicate_schema_ref',
        severity: 'error',
        targetId: 'core/web-app',
      }),
    );
  });

  it('loads the copied schema fixtures', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    expect(registry.schemaFiles).toHaveLength(9);
    expect([...registry.modulesById.keys()].sort()).toEqual([
      'core/base',
      'core/code',
      'core/data-model',
      'core/frontend',
      'core/kubernetes',
      'core/presentation',
      'core/software',
      'core/web-app',
      'gallery/clickhouse',
    ]);
  });

  it('validates the sample semantic document against the copied schemas', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const yaml = await loadSampleYaml();

    const result = validateDiagramYaml({ yaml, schemaRegistry: registry });

    expect(result.ok).toBe(true);
    expect(result.document?.schemaRefs).toEqual([
      act('core/web-app@0.3', 0),
      act('core/frontend@0.3', 0),
      act('core/kubernetes@0.3', 0),
      act('core/code@0.1', 1),
      act('core/data-model@0.3', 1),
    ]);
    expect(result.resolvedSchemaIds).toEqual([
      'core/base',
      'core/software',
      'core/web-app',
      'core/frontend',
      'core/kubernetes',
      'core/code',
      'core/data-model',
    ]);
  });

  it('reports unknown entity types deterministically', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const document = parseDocument(await loadSampleYaml());
    const firstEntity = document.entities[0];
    expect(firstEntity).toBeDefined();
    if (!firstEntity) {
      throw new Error('expected first entity in sample document');
    }
    firstEntity.type = 'core/web-app.types.not-real';

    const result = validateDiagramYaml({
      yaml: serializeDocument(document),
      schemaRegistry: registry,
    });

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === 'diagram.document.unknown_entity_type',
      ),
    ).toBe(true);
  });

  it('reports missing relation endpoints deterministically', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const document = parseDocument(await loadSampleYaml());
    document.relations.push({
      id: 'rel-broken-endpoint',
      type: 'core/software.relations.calls',
      from: 'app-checkout',
      to: 'missing-service',
    });

    const result = validateDiagramYaml({
      yaml: serializeDocument(document),
      schemaRegistry: registry,
    });

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === 'diagram.document.missing_relation_endpoint',
      ),
    ).toBe(true);
  });

  it('reports invalid relation property shapes deterministically', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const document = parseDocument(await loadSampleYaml());
    const relation = document.relations.find((entry) => entry.id === 'rel-frontend-calls-checkout');
    expect(relation).toBeDefined();
    if (!relation) {
      throw new Error('expected checkout relation in sample document');
    }
    relation.props = {
      unexpected: true,
    };

    const result = validateDiagramYaml({
      yaml: serializeDocument(document),
      schemaRegistry: registry,
    });

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === 'diagram.document.relation_properties_not_allowed',
      ),
    ).toBe(true);
  });

  it('accepts nested service and api containment', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const yaml = `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app
    type: core/web-app.types.application
    name: App
    children:
      - id: service-parent
        type: core/web-app.types.service
        name: Parent Service
        children:
          - id: service-child
            type: core/web-app.types.service
            name: Child Service
          - id: api-child
            type: core/web-app.types.api
            name: Internal API
relations: []
`;

    const result = validateDiagramYaml({ yaml, schemaRegistry: registry });

    expect(result.ok).toBe(true);
  });

  it('accepts nested storage boundaries inside a datastore without relying on code modules', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const yaml = `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: storage-plane
    type: core/web-app.types.datastore
    name: Storage Plane
    children:
      - id: primary-db
        type: core/web-app.types.relational-db
        name: Primary DB
      - id: cache
        type: core/web-app.types.cache
        name: Redis Cache
      - id: blob-store
        type: core/web-app.types.object-store
        name: Blob Store
relations: []
`;

    const result = validateDiagramYaml({ yaml, schemaRegistry: registry });

    expect(result.ok).toBe(true);
  });

  it('resolves datastores and relational stores as sinks', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const result = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities: []
relations: []
`,
      schemaRegistry: registry,
    });

    expect(result.ok).toBe(true);
    expect(result.effectiveSchema).toBeDefined();
    if (!result.effectiveSchema) {
      throw new Error('expected effective schema');
    }

    const semantics = compileSchemaSemantics(result.effectiveSchema);

    expect(
      getResolvedTypeSemantics(semantics, 'core/web-app.types.datastore')?.expectations,
    ).toMatchObject({
      expectsIngress: true,
      expectsEgress: false,
      flowRole: 'sink',
      mayTerminate: true,
    });
    expect(
      getResolvedTypeSemantics(semantics, 'core/web-app.types.relational-db')?.expectations,
    ).toMatchObject({
      expectsIngress: true,
      expectsEgress: false,
      flowRole: 'sink',
      mayTerminate: true,
    });
    expect(
      getResolvedTypeSemantics(semantics, 'core/web-app.types.object-store')?.expectations,
    ).toMatchObject({
      expectsIngress: true,
      expectsEgress: false,
      flowRole: 'sink',
      mayTerminate: true,
    });
  });

  it('accepts code modules nested under runtime boundaries via adjacent-layer containment', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const yaml = `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
  - schema: core/frontend@0.3
    layer: 0
  - schema: core/code@0.1
    layer: 1
entities:
  - id: frontend
    type: core/frontend.types.frontend
    name: Frontend
    children:
      - id: frontend-module
        type: core/code.types.module
        name: Frontend Module
        props:
          language: typescript
  - id: app
    type: core/web-app.types.application
    name: App
    children:
      - id: app-module
        type: core/code.types.module
        name: App Module
        props:
          language: typescript
      - id: api
        type: core/web-app.types.api
        name: API
        children:
          - id: endpoint
            type: core/web-app.types.api-endpoint
            name: Endpoint
            props:
              http:
                method: GET
                path: /health
                auth: public
            children:
              - id: endpoint-module
                type: core/code.types.module
                name: Endpoint Module
                props:
                  language: typescript
      - id: service
        type: core/web-app.types.service
        name: Service
        children:
          - id: service-module
            type: core/code.types.module
            name: Service Module
            props:
              language: typescript
            children:
              - id: nested-module
                type: core/code.types.module
                name: Nested Module
                props:
                  language: typescript
relations: []
`;

    const result = validateDiagramYaml({ yaml, schemaRegistry: registry });

    expect(result.ok).toBe(true);
  });

  it('accepts neutral software systems as top-level roots', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const yaml = `version: 0.1.0
schemaRefs:
  - schema: core/software@0.1
    layer: 0
  - schema: core/web-app@0.3
    layer: 0
  - schema: core/code@0.1
    layer: 1
entities:
  - id: clickhouse
    type: core/software.types.system
    name: ClickHouse
    children:
      - id: server-runtime
        type: core/web-app.types.service
        name: Server Runtime
      - id: planner-module
        type: core/code.types.module
        name: Planner
relations: []
`;

    const result = validateDiagramYaml({ yaml, schemaRegistry: registry });

    expect(result.ok).toBe(true);
  });

  it('accepts clickhouse-specific wrapper boundaries and coarse flow', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const yaml = `version: 0.1.0
schemaRefs:
  - schema: gallery/clickhouse@0.1
    layer: 0
  - schema: core/web-app@0.3
    layer: 1
entities:
  - id: clickhouse
    type: gallery/clickhouse.types.engine
    name: ClickHouse
    children:
      - id: protocols
        type: gallery/clickhouse.types.protocol-surface
        name: Protocol Surfaces
      - id: server-runtime
        type: gallery/clickhouse.types.runtime-stack
        name: Server Runtime
      - id: storage
        type: gallery/clickhouse.types.storage-stack
        name: Storage
      - id: keeper
        type: gallery/clickhouse.types.coordination-service
        name: Keeper
      - id: tools
        type: gallery/clickhouse.types.tool-suite
        name: Tooling
relations:
  - id: rel-tools-call-protocols
    type: core/software.relations.calls
    from: tools
    to: protocols
  - id: rel-protocols-call-runtime
    type: core/software.relations.calls
    from: protocols
    to: server-runtime
  - id: rel-runtime-call-storage
    type: core/software.relations.calls
    from: server-runtime
    to: storage
  - id: rel-runtime-call-keeper
    type: core/software.relations.calls
    from: server-runtime
    to: keeper
`;

    const result = validateDiagramYaml({ yaml, schemaRegistry: registry });

    expect(result.ok).toBe(true);
  });

  it('accepts structural groups nested under code modules', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const yaml = `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
  - schema: core/code@0.1
    layer: 1
entities:
  - id: module-root
    type: core/code.types.module
    name: Module Root
    props:
      language: typescript
    children:
      - id: mixed-group
        type: core/web-app.types.group
        name: Mixed Group
        props:
          mode: mixed
relations: []
`;

    const result = validateDiagramYaml({ yaml, schemaRegistry: registry });

    expect(result.ok).toBe(true);
  });

  it('accepts endpoint-to-module and module-to-module calls', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const document = parseDocument(CANONICAL_EXAMPLE_YAML);
    document.relations.unshift({
      id: 'rel-endpoint-calls-validation',
      type: 'core/software.relations.calls',
      from: 'endpoint-create-order',
      to: 'module-schema-validation',
    });

    const result = validateDiagramYaml({
      yaml: serializeDocument(document),
      schemaRegistry: registry,
    });

    expect(result.ok).toBe(true);
  });

  it('accepts the canonical example in strict worker provenance mode', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));

    const result = validateDiagramYaml({
      yaml: CANONICAL_EXAMPLE_YAML,
      schemaRegistry: registry,
      validationOptions: STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
    });

    expect(result.ok).toBe(true);
    expect(result.document?.inputs?.[0]).toEqual(
      expect.objectContaining({
        id: 'primary',
        kind: 'git',
      }),
    );
  });

  it('requires provenance in strict worker mode', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const document = parseDocument(CANONICAL_EXAMPLE_YAML);
    const firstEntity = document.entities[0];
    expect(firstEntity).toBeDefined();
    if (!firstEntity) {
      throw new Error('expected first entity in canonical example');
    }
    document.entities[0] = {
      ...firstEntity,
      provenance: undefined,
    };

    const result = validateDiagramYaml({
      yaml: serializeDocument(document),
      schemaRegistry: registry,
      validationOptions: STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
    });

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === 'diagram.document.missing_entity_provenance',
      ),
    ).toBe(true);
  });

  it('rejects target-repo-prefixed provenance paths in strict worker mode', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const document = parseDocument(CANONICAL_EXAMPLE_YAML);
    const firstEntity = document.entities[0];
    expect(firstEntity).toBeDefined();
    if (!firstEntity) {
      throw new Error('expected first entity in canonical example');
    }
    document.entities[0] = {
      ...firstEntity,
      provenance: {
        locations: [{ input: 'primary', path: 'target-repo/src/app.ts' }],
      },
    };

    const result = validateDiagramYaml({
      yaml: serializeDocument(document),
      schemaRegistry: registry,
      validationOptions: STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
    });

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === 'diagram.document.invalid_provenance_location_path' &&
          diagnostic.path === 'target-repo/src/app.ts',
      ),
    ).toBe(true);
  });

  it('rejects empty group-like entities in strict worker mode', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const yaml = `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: app-shell
    type: core/web-app.types.group
    name: App Shell
    props:
      mode: mixed
relations: []
`;

    const defaultValidation = validateDiagramYaml({
      yaml,
      schemaRegistry: registry,
    });
    expect(defaultValidation.ok).toBe(true);

    const strictValidation = validateDiagramYaml({
      yaml,
      schemaRegistry: registry,
      validationOptions: STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
    });

    expect(strictValidation.ok).toBe(false);
    expect(
      strictValidation.diagnostics.some(
        (diagnostic) => diagnostic.code === 'diagram.document.group_like_entity_missing_children',
      ),
    ).toBe(true);
  });

  it('rejects omitted provenance input when multiple document inputs exist', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const document = parseDocument(CANONICAL_EXAMPLE_YAML);
    const firstEntity = document.entities[0];
    expect(firstEntity).toBeDefined();
    if (!firstEntity) {
      throw new Error('expected first entity in canonical example');
    }
    document.inputs = [
      ...(document.inputs ?? []),
      {
        id: 'secondary',
        kind: 'git',
        repo: 'https://github.com/example/infra',
        revision: 'def456',
        role: 'secondary',
      },
    ];
    document.entities[0] = {
      ...firstEntity,
      provenance: {
        locations: [{ path: 'src/app.ts' }],
      },
    };

    const result = validateDiagramYaml({
      yaml: serializeDocument(document),
      schemaRegistry: registry,
      validationOptions: STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
    });

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === 'diagram.document.provenance_input_required',
      ),
    ).toBe(true);
  });

  it('accepts module read and write relations to storage', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const document = parseDocument(CANONICAL_EXAMPLE_YAML);
    document.entities.push({
      id: 'orders-db',
      type: 'core/web-app.types.relational-db',
      name: 'Orders DB',
    });
    document.relations.push(
      {
        id: 'rel-module-reads-db',
        type: 'core/software.relations.reads',
        from: 'module-create-order',
        to: 'orders-db',
      },
      {
        id: 'rel-module-writes-db',
        type: 'core/software.relations.writes',
        from: 'module-create-order',
        to: 'orders-db',
      },
    );

    const result = validateDiagramYaml({
      yaml: serializeDocument(document),
      schemaRegistry: registry,
    });

    expect(result.ok).toBe(true);
  });

  it('rejects invalid service deployability values', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const document = parseDocument(CANONICAL_EXAMPLE_YAML);
    const service = document.entities[0]?.children?.find(
      (entry) => entry.id === 'service-validation',
    );
    expect(service).toBeDefined();
    if (!service) {
      throw new Error('expected validation service in canonical example');
    }
    service.props = { ...(service.props ?? {}), deployability: 'remote' };

    const result = validateDiagramYaml({
      yaml: serializeDocument(document),
      schemaRegistry: registry,
    });

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === 'diagram.document.invalid_entity_property_value',
      ),
    ).toBe(true);
  });
});
