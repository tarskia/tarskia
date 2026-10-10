import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDefaultSchemaSource } from '../default-assets';
import { buildSchemaActivation, compileSchemaSemantics, validateDiagramYaml } from '../semantic';
import { loadSchemaRegistry } from '../semantic/schema-loader';
import { buildSchemaFlowCatalog, renderSchemaFlowCatalogForPrompt } from './schema-flow-catalog';

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

describe('schema flow catalog', () => {
  it('groups active effective schema types by deterministic flow role', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
  - schema: core/frontend@0.3
    layer: 0
entities: []
relations: []
`,
      schemaRegistry,
      documentInputs: [
        {
          id: 'primary',
          kind: 'git',
          repo: 'https://github.com/example/repo',
          revision: 'abc123abc123abc123abc123abc123abc123abcd',
          role: 'primary',
        },
      ],
    });
    expect(validation.ok).toBe(true);
    expect(validation.effectiveSchema).toBeDefined();
    const semantics = compileSchemaSemantics(validation.effectiveSchema!);

    const catalog = buildSchemaFlowCatalog({
      schema: validation.effectiveSchema!,
      semantics,
      activeSchemaRefs: [act('core/web-app@0.3'), act('core/frontend@0.3')],
    });

    expect(catalog.groups.sources).toContain('core/frontend.types.frontend');
    expect(catalog.groups.through).toEqual(
      expect.arrayContaining(['core/web-app.types.queue', 'core/web-app.types.topic']),
    );
    expect(catalog.groups.sinks).toEqual(
      expect.arrayContaining(['core/web-app.types.datastore', 'core/web-app.types.relational-db']),
    );
    expect(catalog.entries.map((entry) => entry.typeId)).toEqual(
      [...catalog.entries.map((entry) => entry.typeId)].sort((left, right) =>
        left.localeCompare(right),
      ),
    );
    expect(
      catalog.entries.find((entry) => entry.typeId === 'core/web-app.types.queue'),
    ).toMatchObject({
      flowRole: 'through',
      expectsIngress: true,
      expectsEgress: true,
      expectedRelationIds: expect.arrayContaining([
        'core/software.relations.consumes-from',
        'core/software.relations.publishes-to',
      ]),
      relationParticipation: expect.arrayContaining([
        expect.objectContaining({
          relationId: 'core/software.relations.consumes-from',
          to: true,
        }),
      ]),
    });
  });

  it('renders a compact prompt summary with role buckets', async () => {
    const schemaRegistry = await loadSchemaRegistry(resolveDefaultSchemaSource());
    const validation = validateDiagramYaml({
      yaml: `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities: []
relations: []
`,
      schemaRegistry,
      documentInputs: [],
    });
    expect(validation.ok).toBe(true);
    const catalog = buildSchemaFlowCatalog({
      schema: validation.effectiveSchema!,
      semantics: compileSchemaSemantics(validation.effectiveSchema!),
      activeSchemaRefs: [act('core/web-app@0.3')],
    });

    const rendered = renderSchemaFlowCatalogForPrompt(catalog);

    expect(rendered).toContain('Active schema flow catalogue:');
    expect(rendered).toContain('Flow-through - should have incoming and outgoing flow');
    expect(rendered).toContain('core/web-app.types.queue');
    expect(rendered).toContain('Sinks - should have incoming flow');
    expect(rendered).toContain('core/web-app.types.relational-db');
  });
});
