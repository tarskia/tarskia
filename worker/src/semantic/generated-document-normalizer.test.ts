import { describe, expect, it } from 'vitest';
import { testGroupSemantics } from '../advanced/refinement-test-context';
import { normalizeGeneratedDocument } from './generated-document-normalizer';

describe('normalizeGeneratedDocument', () => {
  it.each([
    'core/web-app.types.group',
    'core/kubernetes.types.group',
  ])('removes groupType from mixed %s', (type) => {
    const doc = normalizeGeneratedDocument(
      {
        version: '0.1.0',
        schemaRefs: [],
        entities: [
          {
            id: 'service-group',
            type,
            props: {
              mode: 'mixed',
              groupType: 'core/web-app.types.service',
            },
          },
        ],
        relations: [],
      },
      testGroupSemantics,
    );

    expect(doc.entities[0]?.props).toEqual({ mode: 'mixed' });
  });

  it('normalizes dotted ontology ids in model output', () => {
    const doc = normalizeGeneratedDocument(
      {
        version: '0.1.0',
        schemaRefs: [],
        entities: [
          {
            id: 'service-group',
            type: 'core.web-app.types.group',
            props: {
              mode: 'typed',
              groupType: 'core.code.types.module',
            },
            children: [
              {
                id: 'service-group/runtime',
                type: 'core.code.types.module',
              },
            ],
          },
        ],
        relations: [
          {
            id: 'runtime-calls-api',
            from: 'service-group/runtime',
            to: 'api',
            type: 'core.software.relations.calls',
          },
        ],
      },
      testGroupSemantics,
    );

    expect(doc.entities[0]?.type).toBe('core/web-app.types.group');
    expect(doc.entities[0]?.props?.groupType).toBe('core/code.types.module');
    expect(doc.entities[0]?.children?.[0]?.type).toBe('core/code.types.module');
    expect(doc.relations[0]?.type).toBe('core/software.relations.calls');
  });
});
