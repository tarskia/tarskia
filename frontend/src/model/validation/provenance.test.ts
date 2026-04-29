import { describe, expect, it } from 'vitest';
import baseRaw from '../../schemas/base.yaml?raw';
import codeRaw from '../../schemas/code.yaml?raw';
import softwareRaw from '../../schemas/software.yaml?raw';
import webAppRaw from '../../schemas/web-app.yaml?raw';
import { parseSchema } from '../../util/serialization';
import { buildSchemaActivation } from '../schema-ref';
import { buildRawSchemaSet, buildSchemaRuntime, buildSchemaSelection } from '../schema-runtime';
import type { SemanticDocument } from '../types';
import { STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS } from '../validate';
import { validateDiagramDoc } from './diagram';

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

const raw = buildRawSchemaSet([
  parseSchema(baseRaw),
  parseSchema(softwareRaw),
  parseSchema(webAppRaw),
  parseSchema(codeRaw),
]);
const schema = buildSchemaRuntime({
  raw,
  selection: buildSchemaSelection({ raw }),
}).resolved.effectiveSchema;

const GIT_COMMIT = '0123456789abcdef0123456789abcdef01234567';

const createBaseDocument = (): SemanticDocument => ({
  version: '0.1.0',
  schemaRefs: [act('core/web-app@0.3')],
  entities: [
    {
      id: 'service-a',
      type: 'core/web-app.types.service',
      name: 'Service A',
    },
    {
      id: 'service-b',
      type: 'core/web-app.types.service',
      name: 'Service B',
    },
  ],
  relations: [
    {
      id: 'rel-a-calls-b',
      type: 'core/software.relations.calls',
      from: 'service-a',
      to: 'service-b',
    },
  ],
});

const withProvenance = (doc: SemanticDocument): SemanticDocument => ({
  ...doc,
  entities: doc.entities.map((entity) => ({
    ...entity,
    provenance: {
      locations: [
        {
          repo: 'https://github.com/example/repo',
          commit: GIT_COMMIT,
          path: `src/${entity.id}.ts`,
        },
      ],
    },
  })),
  relations: doc.relations.map((relation) => ({
    ...relation,
    provenance: {
      locations: [
        {
          repo: 'https://github.com/example/repo',
          commit: GIT_COMMIT,
          path: 'src/graph.ts',
        },
      ],
    },
  })),
});

describe('diagram provenance validation', () => {
  it('accepts legacy diagrams without provenance in permissive mode', () => {
    const result = validateDiagramDoc(createBaseDocument(), schema);
    expect(result.ok).toBe(true);
  });

  it('rejects missing entity and relation provenance in strict worker mode', () => {
    const result = validateDiagramDoc(
      createBaseDocument(),
      schema,
      STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((d) => d.code === 'diagram.document.missing_entity_provenance'),
    ).toBe(true);
    expect(
      result.diagnostics.some((d) => d.code === 'diagram.document.missing_relation_provenance'),
    ).toBe(true);
  });

  it('accepts absolute git provenance in strict worker mode', () => {
    const result = validateDiagramDoc(
      withProvenance(createBaseDocument()),
      schema,
      STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
    );

    expect(result.ok).toBe(true);
  });

  it('rejects non-immutable commit references', () => {
    const doc = withProvenance(createBaseDocument());
    const [firstEntity] = doc.entities;
    expect(firstEntity).toBeDefined();
    if (!firstEntity) {
      throw new Error('Expected a first entity');
    }
    firstEntity.provenance = {
      locations: [
        {
          repo: 'https://github.com/example/repo',
          commit: 'main',
          path: 'src/service-a.ts',
        },
      ],
    };

    const result = validateDiagramDoc(
      doc,
      schema,
      STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (d) => d.code === 'diagram.document.invalid_provenance_location_commit',
      ),
    ).toBe(true);
  });

  it('rejects missing repos and absolute file-system paths', () => {
    const doc = withProvenance(createBaseDocument());
    const [firstEntity] = doc.entities;
    expect(firstEntity).toBeDefined();
    if (!firstEntity) {
      throw new Error('Expected a first entity');
    }
    firstEntity.provenance = {
      locations: [
        {
          repo: '',
          commit: GIT_COMMIT,
          path: '/tmp/service-a.ts',
        },
      ],
    };

    const result = validateDiagramDoc(
      doc,
      schema,
      STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (d) => d.code === 'diagram.document.invalid_provenance_location_repo',
      ),
    ).toBe(true);
    expect(
      result.diagnostics.some(
        (d) => d.code === 'diagram.document.invalid_provenance_location_path',
      ),
    ).toBe(true);
  });
});
