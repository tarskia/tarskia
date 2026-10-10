import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSchemaActivation, loadSchemaRegistry } from '../semantic';
import { buildSchemaSetManagerFromAreaPlan } from './schema-set';

const fixturePath = (...segments: string[]) =>
  path.resolve(process.cwd(), 'test', 'fixtures', ...segments);

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

describe('AdvancedSchemaSetManager', () => {
  it('preserves an existing activation when re-proposed at another layer', async () => {
    const schemaRegistry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const manager = buildSchemaSetManagerFromAreaPlan({
      schemaRegistry,
      areaPlan: {
        repoSummary: 'Web app',
        initialSchemaActivations: [act('core/web-app@0.3', 1)],
        candidateSchemaRefs: [
          {
            schemaRef: 'core/web-app@0.3',
            suggestedLayer: 0,
            rationale: 'Re-proposed',
            evidence: [{ path: 'src/app.ts', reason: 'Runtime' }],
          },
        ],
        areas: [],
      },
    });
    expect(manager.acceptSchemaRefs(['core/web-app@0.3'])).toEqual({
      changed: false,
      acceptedSchemaRefs: ['core/web-app@0.3'],
      rejectedSchemaRefs: [],
    });
    expect(manager.snapshot().activeSchemaRefs).toEqual([act('core/web-app@0.3', 1)]);
    manager.restoreRootSchemaRefs([act('core/web-app@0.3', 1), act('core/web-app@0.3', 0)]);
    expect(manager.snapshot().activeSchemaRefs).toEqual([act('core/web-app@0.3', 1)]);
  });

  it('boots from planned initial schema activations', async () => {
    const schemaRegistry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const manager = buildSchemaSetManagerFromAreaPlan({
      schemaRegistry,
      areaPlan: {
        repoSummary: 'Frontend repo',
        initialSchemaActivations: [act('core/frontend@0.3')],
        candidateSchemaRefs: [],
        areas: [],
      },
    });

    expect(manager.snapshot().activeSchemaRefs).toEqual([act('core/frontend@0.3')]);
  });

  it('accepts planned candidate schemas and resolves their imports', async () => {
    const schemaRegistry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const manager = buildSchemaSetManagerFromAreaPlan({
      schemaRegistry,
      areaPlan: {
        repoSummary: 'Frontend repo',
        initialSchemaActivations: [act('core/frontend@0.3')],
        candidateSchemaRefs: [
          {
            schemaRef: 'core/code@0.1',
            suggestedLayer: 1,
            rationale: 'Code modules may be needed at the next layer.',
            evidence: [{ path: 'src/frontend.tsx', reason: 'Implementation-heavy frontend' }],
          },
        ],
        areas: [],
      },
    });

    const decision = manager.acceptSchemaRefs(['core/code@0.1']);

    expect(decision.acceptedSchemaRefs).toContain('core/code@0.1');
    expect(decision.rejectedSchemaRefs).toEqual([]);
    expect(manager.snapshot().activeSchemaRefs).toEqual([
      act('core/frontend@0.3'),
      act('core/code@0.1', 1),
    ]);
  });

  it('rejects unplanned, non-augmenting schema refs', async () => {
    const schemaRegistry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const manager = buildSchemaSetManagerFromAreaPlan({
      schemaRegistry,
      areaPlan: {
        repoSummary: 'Web app repo',
        initialSchemaActivations: [act('core/web-app@0.3')],
        candidateSchemaRefs: [],
        areas: [],
      },
    });

    const decision = manager.acceptSchemaRefs(['core/frontend@0.3', 'core/unknown@9.9']);

    expect(decision.acceptedSchemaRefs).toEqual([]);
    expect(decision.rejectedSchemaRefs).toEqual(
      expect.arrayContaining(['core/frontend@0.3', 'core/unknown@9.9']),
    );
  });
});
