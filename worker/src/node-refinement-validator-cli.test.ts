import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildInitialNodeRefinementState } from './advanced/node-refinement-engine';
import { testGroupSemantics } from './advanced/refinement-test-context';
import { validateNodeRefinementCandidateCommand } from './node-refinement-validator-cli';
import { schemaRepoFixture } from './schema-repo-fixture';
import { parseDocument } from './semantic';

const fixturePath = (...segments: string[]) =>
  segments[0] === 'schema-repo'
    ? path.join(schemaRepoFixture(), ...segments.slice(1))
    : path.resolve(process.cwd(), 'test', 'fixtures', ...segments);

describe('validateNodeRefinementCandidateCommand', () => {
  it('returns hard diagnostics for an invalid runtime-to-code sibling edge', async () => {
    const jobRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'node-refinement-validator-'));
    await fs.cp(fixturePath('schema-repo'), path.join(jobRoot, 'schema-repo'), {
      recursive: true,
    });

    const baseDoc = parseDocument(`version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
  - schema: core/code@0.1
    layer: 1
entities:
  - id: app
    type: core/web-app.types.application
    name: App
    provenance:
      locations:
        - input: primary
          path: src/app.ts
  - id: store
    type: core/web-app.types.datastore
    name: Store
    provenance:
      locations:
        - input: primary
          path: src/store.ts
relations:
  - id: app-reads-store
    type: core/software.relations.reads
    from: app
    to: store
    provenance:
      locations:
        - input: primary
          path: src/app.ts
`);

    const state = buildInitialNodeRefinementState({
      semantics: testGroupSemantics,
      level0Doc: baseDoc,
      areaPlan: {
        repoSummary: 'Test repo',
        initialSchemaActivations: [
          { schema: 'core/web-app@0.3', layer: 0 },
          { schema: 'core/code@0.1', layer: 1 },
        ],
        candidateSchemaRefs: [],
        keyConcepts: [
          {
            id: 'app',
            kind: 'service' as const,
            title: 'App',
            paths: ['src'],
            rationale: 'Primary runtime.',
            evidence: [{ path: 'src/app.ts', reason: 'Entrypoint' }],
            groupingHints: [],
            openQuestions: [] as string[],
          },
        ],
      },
      visibleResponsibilityIds: ['app'],
    });

    await fs.mkdir(path.join(jobRoot, 'out', 'analysis'), { recursive: true });
    await fs.writeFile(
      path.join(jobRoot, 'out', 'analysis', 'node-refinement.validation-context.json'),
      `${JSON.stringify(
        {
          version: 1,
          task: state.queue[0],
          state,
          baseDoc,
          activeSchemaRefs: [
            { schema: 'core/web-app@0.3', layer: 0 },
            { schema: 'core/code@0.1', layer: 1 },
          ],
          primaryDocumentInput: {
            id: 'primary',
            kind: 'git',
            repo: 'https://github.com/example/repo',
            revision: 'abc123',
            role: 'primary',
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const result = await validateNodeRefinementCandidateCommand({
      jobRoot,
      contextPath: 'out/analysis/node-refinement.validation-context.json',
      rawResponse: JSON.stringify({
        children: [
          {
            localId: 'api-surface',
            name: 'API surface',
            typeId: 'core/web-app.types.api',
            scope: ['src/app.ts'],
            evidence: [{ path: 'src/app.ts', reason: 'API layer' }],
            queueDecision: 'expand',
          },
          {
            localId: 'api-dispatch',
            name: 'API dispatch',
            typeId: 'core/code.types.module',
            scope: ['src/app.ts'],
            evidence: [{ path: 'src/app.ts', reason: 'Implementation' }],
            queueDecision: 'leaf',
          },
        ],
        relations: [
          {
            localId: 'api-surface-dispatches-api-routes',
            typeId: 'core/software.relations.calls',
            fromLocalId: 'api-surface',
            toLocalId: 'api-dispatch',
            evidence: [{ path: 'src/app.ts', reason: 'Handler dispatch' }],
          },
        ],
        edgeRefinements: [],
        edgeProposals: [],
      }),
    });

    expect(JSON.stringify(result)).not.toContain('app-reads-store');
    const unknownHandle = await validateNodeRefinementCandidateCommand({
      jobRoot,
      contextPath: 'out/analysis/node-refinement.validation-context.json',
      rawResponse: JSON.stringify({
        children: [],
        relations: [],
        edgeRefinements: [{ edgeId: 'out-9', fromChildLocalId: 'child' }],
      }),
    });
    expect(unknownHandle.hardOk).toBe(false);
    expect(unknownHandle.hardDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.node_refinement.invalid_edge_handle',
          message: `Edge reference "out-9" is not one of this task's edges: out-1.`,
        }),
      ]),
    );
    const validHandle = await validateNodeRefinementCandidateCommand({
      jobRoot,
      contextPath: 'out/analysis/node-refinement.validation-context.json',
      rawResponse: JSON.stringify({
        children: [],
        relations: [],
        edgeRefinements: [{ edgeId: 'out-1', fromChildLocalId: 'child' }],
      }),
    });
    expect(
      validHandle.hardDiagnostics.some(
        (diagnostic) => diagnostic.code === 'diagram.node_refinement.invalid_edge_handle',
      ),
    ).toBe(false);
    expect(JSON.stringify(validHandle)).not.toContain('app-reads-store');
    expect(result.hardOk).toBe(false);
    expect(result.hardDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'diagram.node_refinement.invalid_relation_type',
        }),
      ]),
    );
  });
});
