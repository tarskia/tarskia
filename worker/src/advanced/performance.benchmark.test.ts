import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { describe, expect, it, vi } from 'vitest';
import { buildDiagram } from '../build-diagram';
import { schemaRepoFixture } from '../schema-repo-fixture';
import { parseDocument, type SemanticDocument, serializeDocument } from '../semantic';
import type { NodeRefinerInput } from './graph-builders';
import { buildRepoCensus } from './repo-census';

const writes = vi.hoisted(() => ({
  bytes: 0,
  count: 0,
  byName: {} as Record<string, { bytes: number; count: number }>,
}));
vi.mock('../write-file-atomic', async (importOriginal) => {
  const original = await importOriginal<typeof import('../write-file-atomic')>();
  return {
    ...original,
    writeFileAtomic: async (...args: Parameters<typeof original.writeFileAtomic>) => {
      const size = typeof args[1] === 'string' ? Buffer.byteLength(args[1]) : args[1].byteLength;
      writes.bytes += size;
      writes.count++;
      const name = path.basename(args[0]);
      const entry = writes.byName[name] ?? { bytes: 0, count: 0 };
      writes.byName[name] = entry;
      entry.bytes += size;
      entry.count++;
      return original.writeFileAtomic(...args);
    },
  };
});

const outputHashes: Record<number, string> = {
  50: '940b0cb4ee20b9eb7ffbd75acd286eb04503d7c46c14d94a56c92fc32a4cfbdf',
  200: '159097dafa7b1cfae1a106ab924c54b45a6771444fb5cad24589a98494223a66',
  800: '20df0a2806ae5a97bf3380da95f068e249c4e842246bf1571e31035210945359',
};
const enabled = process.env.TARSKIA_PERFORMANCE_BENCHMARK === '1';
const report = async (result: unknown) => {
  const line = JSON.stringify(result) + '\n';
  process.stdout.write(line);
  if (process.env.TARSKIA_BENCHMARK_REPORT)
    await fs.appendFile(process.env.TARSKIA_BENCHMARK_REPORT, line);
};
const quiet = { info() {}, warn() {}, error() {} };
const evidence = [{ path: 'src/index.ts', reason: 'Synthetic runtime entrypoint' }];
const provenance = { locations: [{ input: 'primary', path: 'src/index.ts' }] };
const turn = (doc: SemanticDocument) => ({
  doc,
  rawYaml: serializeDocument(doc),
  rawResponse: 'fixture',
  threadId: 'mock',
});

function dependencies(nodeCount: number) {
  // Up to seven leaf children per application: <=100 real refinement turns at
  // N=800, within the unchanged production budget and child-count soft limits.
  const roots = Math.ceil((nodeCount - 2) / 8);
  const childCounts = Array.from({ length: roots }, (_, i) =>
    Math.min(7, nodeCount - 2 - roots - i * 7),
  );
  const doc = parseDocument(
    serializeDocument({
      version: '0.1.0',
      schemaRefs: [{ schema: 'core/web-app@0.3', layer: 0 }],
      entities: [
        { id: 'source', type: 'core/web-app.types.external-api', name: 'Source', provenance },
        { id: 'sink', type: 'core/web-app.types.external-api', name: 'Sink', provenance },
        ...Array.from({ length: roots }, (_, i) => ({
          id: `app-${i}`,
          type: 'core/web-app.types.application',
          name: `Application ${i}`,
          provenance,
        })),
      ],
      relations: [
        {
          id: 'ingress',
          type: 'core/software.relations.calls',
          from: 'source',
          to: 'app-0',
          provenance,
        },
        {
          id: 'egress',
          type: 'core/software.relations.calls',
          from: `app-${roots - 1}`,
          to: 'sink',
          provenance,
        },
        ...Array.from({ length: roots - 1 }, (_, i) => ({
          id: `call-${i}`,
          type: 'core/software.relations.calls',
          from: `app-${i}`,
          to: `app-${i + 1}`,
          provenance,
        })),
      ],
    } as SemanticDocument),
  );
  let tasks = 0;
  const unexpected = async (input: { diagnostics?: unknown }) => {
    throw new Error(
      `Unexpected repair/model call in deterministic benchmark: ${JSON.stringify(input.diagnostics)}`,
    );
  };
  const deps: NonNullable<Parameters<typeof buildDiagram>[1]> = {
    logger: quiet,
    advancedThreadClient: {
      startThread: () => {
        throw new Error('Real Codex calls forbidden in benchmark');
      },
    },
    areaPlanner: {
      planAreas: async () => ({
        plan: {
          repoSummary: 'Synthetic connected runtime',
          galleryDescription: 'Synthetic connected runtime',
          initialSchemaActivations: doc.schemaRefs,
          candidateSchemaRefs: [],
          areas: doc.entities
            .filter((entity) => entity.id.startsWith('app-'))
            .map((entity) => ({
              id: entity.id,
              kind: 'service' as const,
              title: entity.name ?? entity.id,
              paths: ['src'],
              groupingHints: [],
              rationale: 'Runtime',
              evidence,
              openQuestions: [],
            })),
        },
        rawResponse: '{}',
        threadId: 'mock',
      }),
    },
    level0BackboneBuilder: { buildLevel0Backbone: async () => turn(doc) },
    level0BackboneRepairer: { repairLevel0Backbone: unexpected },
    level0BackboneReviewer: {
      reviewLevel0Backbone: async ({ currentBackboneYaml }) =>
        turn(parseDocument(currentBackboneYaml)),
    },
    level0BackboneReviewerRepairer: { repairLevel0BackboneReview: unexpected },
    wave1Reviewer: {
      reviewWave1: async () => ({ patch: {}, rawResponse: '{}', threadId: 'mock' }),
    },
    wave1ReviewerRepairer: { repairWave1Review: unexpected },
    finalGraphReviewer: {
      reviewFinalGraph: async ({ currentFinalGraphYaml }) =>
        turn(parseDocument(currentFinalGraphYaml)),
    },
    finalGraphReviewerRepairer: { repairFinalGraphReview: unexpected },
    graphCollator: { collateGraph: async ({ assembledDoc }) => turn(assembledDoc) },
    nodeRefiner: {
      refineNode: async ({ task }: NodeRefinerInput) => {
        tasks++;
        const count = childCounts[Number(task.nodeId.slice(4))];
        return {
          result: {
            children: Array.from({ length: count }, (_, i) => ({
              localId: `service-${i}`,
              typeId: 'core/web-app.types.service',
              name: `Service ${i}`,
              scope: ['src'],
              evidence,
              queueDecision: 'leaf' as const,
            })),
            relations: Array.from({ length: Math.max(0, count - 1) }, (_, i) => ({
              localId: `calls-${i}`,
              typeId: 'core/software.relations.calls',
              fromLocalId: `service-${i}`,
              toLocalId: `service-${i + 1}`,
              evidence,
            })),
            edgeRefinements: [
              ...task.inboundEdges.map((edge) => ({
                edgeId: edge.id,
                toChildLocalId: 'service-0',
              })),
              ...task.outboundEdges.map((edge) => ({
                edgeId: edge.id,
                fromChildLocalId: `service-${count - 1}`,
              })),
            ],
          },
          rawResponse: '{}',
          threadId: 'mock',
        };
      },
    },
    nodeRefinerRepairer: { repairNode: unexpected },
  };
  return { deps, tasks: () => tasks, roots };
}

describe.skipIf(!enabled)('opt-in worker performance benchmarks (no models)', () => {
  it.each(
    (process.env.TARSKIA_BENCHMARK_N ?? '50,200,800').split(',').map(Number),
  )('advanced pipeline grows to %i nodes', async (n) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tarskia-perf-'));
    try {
      const repo = path.join(root, 'repo');
      await fs.mkdir(path.join(repo, 'src'), { recursive: true });
      await fs.writeFile(path.join(repo, 'src/index.ts'), 'export const runtime = true;\n');
      const git = simpleGit(repo);
      await git.init();
      await git.addConfig('user.name', 'Benchmark');
      await git.addConfig('user.email', 'benchmark@example.test');
      await git.add('.');
      await git.commit('Fixture');
      const { deps, tasks, roots } = dependencies(n);
      writes.bytes = 0;
      writes.count = 0;
      writes.byName = {};
      const started = performance.now();
      const result = await buildDiagram(
        {
          repo,
          schemaSource: schemaRepoFixture(),
          out: path.join(root, 'diagram.yaml'),

          graphifyHintsMode: 'off',
          nodeRefinementMaxDepth: 1,
        },
        deps,
      );
      const elapsedMs = performance.now() - started;
      expect(tasks()).toBe(roots);
      const count = (entities: SemanticDocument['entities']): number =>
        entities.reduce((sum, entity) => sum + 1 + count(entity.children ?? []), 0);
      const document = parseDocument(await fs.readFile(result.outputPath, 'utf8'));
      expect(count(document.entities)).toBe(n);
      const stable = serializeDocument({ ...document, inputs: undefined, metadata: undefined });
      const outputSha256 = createHash('sha256').update(stable).digest('hex');
      if (outputHashes[n]) expect(outputSha256).toBe(outputHashes[n]);
      await report({
        benchmark: 'advanced',
        n,
        tasks: tasks(),
        elapsedMs,
        msPerTask: elapsedMs / tasks(),
        bytes: writes.bytes,
        bytesPerTask: writes.bytes / tasks(),
        writes: writes.count,
        stateWrites: writes.byName['node-refinement-state.json'],
        metadataWrites: writes.byName['job-metadata.json'],
        outputSha256,
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 600_000);

  it.skipIf(process.env.TARSKIA_BENCHMARK_CENSUS !== '1')(
    'census of 50k small files and a 200 MiB file',
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tarskia-census-perf-'));
      try {
        for (let dir = 0; dir < 500; dir++) {
          const folder = path.join(root, String(dir).padStart(3, '0'));
          await fs.mkdir(folder);
          await Promise.all(
            Array.from({ length: 100 }, (_, file) =>
              fs.writeFile(
                path.join(folder, `file-${file}.ts`),
                'export const runtime = true;\r\n',
              ),
            ),
          );
        }
        const large = await fs.open(path.join(root, 'large.txt'), 'w');
        const chunk = Buffer.alloc(1024 * 1024, 'x');
        for (let i = 0; i < 200; i++) await large.write(chunk);
        await large.close();
        const started = performance.now();
        const census = await buildRepoCensus({
          repoRoot: root,
          repoUrl: 'fixture',
          repoRevision: 'fixed',
        });
        const elapsedMs = performance.now() - started;
        expect(census.summary.totalFiles).toBe(50_001);
        expect(census.summary.totalLines).toBe(100_001);
        const outputSha256 = createHash('sha256')
          .update(JSON.stringify({ ...census, repoRoot: '<fixture>', generatedAt: '<fixed>' }))
          .digest('hex');
        expect(outputSha256).toBe(
          '28a297a3937bc365da10581af7775473b8155fe16d9d9d1393da2b8e1a726a61',
        );
        await report({
          benchmark: 'census',
          elapsedMs,
          peakRssKiB: process.resourceUsage().maxRSS,
          outputSha256,
        });
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    600_000,
  );
});
