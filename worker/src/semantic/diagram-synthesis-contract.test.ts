import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { schemaRepoFixture } from '../schema-repo-fixture';
import {
  buildDiagramSynthesisContract,
  OPTIONAL_DOCUMENT_KEYS,
  REQUIRED_DOCUMENT_KEYS,
} from './diagram-synthesis-contract';
import { STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS } from './model/validate';
import { loadSchemaRegistry, validateDiagramYaml } from './schema-loader';

const fixturePath = (...segments: string[]) =>
  segments[0] === 'schema-repo'
    ? path.join(schemaRepoFixture(), ...segments.slice(1))
    : path.resolve(process.cwd(), 'test', 'fixtures', ...segments);

describe('diagram-synthesis-contract', () => {
  it('builds a contract from the live schema registry', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));

    const contract = buildDiagramSynthesisContract(registry);

    expect(contract.validationRules.requiredTopLevelKeys).toEqual([...REQUIRED_DOCUMENT_KEYS]);
    expect(contract.validationRules.optionalTopLevelKeys).toEqual([...OPTIONAL_DOCUMENT_KEYS]);
    expect(contract.validationRules.schemaRefsRequired).toBe(true);
    expect(contract.validationRules.preferredContainmentEncoding).toBe('children');
    expect(contract.validationRules.relationDirectionRule).toBe('directed-by-default');
    expect(contract.validationRules.workerRequiresEntityProvenance).toBe(true);
    expect(contract.validationRules.workerInjectsPrimaryGitInput).toBe(true);
    expect(contract.promptPolicies.runtimeOverToolingRule).toContain(
      'At every level, prefer shipped runtime architecture over build tooling',
    );
    expect(contract.promptPolicies.modelingGuardrails).toEqual(
      expect.arrayContaining([expect.any(String), expect.any(String), expect.any(String)]),
    );
    expect(
      contract.promptPolicies.modelingGuardrails.some((rule) =>
        rule.includes('core/code.types.module'),
      ),
    ).toBe(true);
    expect(
      contract.promptPolicies.modelingGuardrails.some((rule) =>
        rule.includes('props.mode to mixed and omit props.groupType'),
      ),
    ).toBe(true);
    expect(
      contract.promptPolicies.modelingGuardrails.some((rule) =>
        rule.includes('core/web-app.types.frontend'),
      ),
    ).toBe(true);
    expect(
      contract.promptPolicies.modelingGuardrails.some((rule) =>
        rule.includes('activated layers exactly'),
      ),
    ).toBe(true);
    expect(
      contract.promptPolicies.modelingGuardrails.some((rule) => rule.includes('not queues/topics')),
    ).toBe(true);
    expect(
      contract.promptPolicies.modelingGuardrails.some((rule) =>
        rule.includes('analysis.topLevelBias hints'),
      ),
    ).toBe(true);
    expect(
      contract.promptPolicies.modelingGuardrails.some((rule) => rule.includes('service units')),
    ).toBe(true);
    expect(contract.schemaCatalog.map((entry) => entry.schemaRef)).toEqual([
      'core/base@0.1',
      'core/code@0.1',
      'core/data-model@0.3',
      'core/frontend@0.3',
      'core/kubernetes@0.3',
      'core/presentation@0.1',
      'core/software@0.1',
      'core/web-app@0.3',
      'gallery/clickhouse@0.1',
    ]);
    expect(contract.schemaCatalog.find((entry) => entry.schemaRef === 'core/code@0.1')).toEqual(
      expect.objectContaining({
        imports: ['core/software@0.1'],
        types: expect.arrayContaining([
          expect.objectContaining({
            id: 'core/code.types.module',
            label: 'Module',
            properties: expect.arrayContaining([
              expect.objectContaining({
                id: 'language',
                type: 'enum',
                description:
                  'Primary implementation language for this module or subtree when known.',
              }),
            ]),
          }),
        ]),
      }),
    );
    expect(contract.schemaCatalog.find((entry) => entry.schemaRef === 'core/web-app@0.3')).toEqual(
      expect.objectContaining({
        imports: ['core/software@0.1'],
      }),
    );
  });

  it('keeps the canonical example valid against the fixture schema repo', async () => {
    const registry = await loadSchemaRegistry(fixturePath('schema-repo'));
    const contract = buildDiagramSynthesisContract(registry);

    const validation = validateDiagramYaml({
      yaml: contract.canonicalExampleYaml,
      schemaRegistry: registry,
      validationOptions: STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
    });

    expect(validation.ok).toBe(true);
    expect(validation.document?.view).toBeUndefined();
    expect(validation.document?.inputs?.[0]?.id).toBe('primary');
  });
});
