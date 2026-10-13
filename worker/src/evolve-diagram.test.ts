import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildEntityTree,
  evolveSemanticDiagramDiffUnion,
  type SchemaModule,
} from '@tarskia/diagram-semantics';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagramEvolverInput } from './codex/diagram-evolver';
import { buildDiagramEvolvePrompt } from './codex/diagram-evolver';
import { assertAdditiveSchema, completeEvolveCandidate } from './evolve-candidate';
import { evolveDiagram } from './evolve-diagram';
import { workerGit } from './git';
import { parseDocument, parseSchema, serializeDocument, serializeSchemaModule } from './semantic';
import { CANONICAL_EXAMPLE_YAML } from './semantic/diagram-synthesis-contract';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const response = (entities: unknown[] = [], relations: unknown[] = [], schema?: string) =>
  JSON.stringify({
    diff: { kind: 'semantic-diagram-diff', version: 1, entities, relations },
    schema,
  });
const base = parseDocument(CANONICAL_EXAMPLE_YAML);
const flat = (id: string) => {
  const tree = buildEntityTree(base);
  const node = tree.byId.get(id)!;
  const { children: _children, ...entity } = node.entity;
  return { ...entity, ...(node.parentId !== tree.rootId ? { parent: node.parentId } : {}) };
};
async function fixture(withChanges = true, withDiagram = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tarskia-evolve-'));
  roots.push(root);
  const git = workerGit(root);
  await git.init();
  await git.addConfig('user.name', 'Evolve Test');
  await git.addConfig('user.email', 'evolve@example.test');
  await fs.mkdir(path.join(root, '.tarskia'));
  await fs.writeFile(path.join(root, 'app.ts'), 'const version = 1;\n');
  if (withDiagram)
    await fs.writeFile(path.join(root, '.tarskia/example.yaml'), CANONICAL_EXAMPLE_YAML);
  await git.add('.');
  await git.commit('PRIVATE BASE TASK TEXT');
  const commit = (await git.revparse(['HEAD'])).trim();
  await git.raw(['update-ref', 'refs/remotes/origin/main', commit]);
  if (withChanges) {
    await fs.writeFile(path.join(root, 'app.ts'), 'const version = 2;\n');
    await fs.writeFile(path.join(root, '.tarskia/private.txt'), 'PRIVATE TASK DETAILS');
    await git.add('.');
    await git.commit('PRIVATE IMPLEMENTER CONVERSATION');
  }
  return { root, git, commit };
}

describe('after-only candidate', () => {
  it('fills before/changedFields, retains nested untouched content, and hides provenance-only moves', () => {
    const moved = {
      ...flat('module-create-order'),
      provenance: { locations: [{ input: 'primary', path: 'src/moved.ts' }] },
    };
    const candidate = completeEvolveCandidate(
      base,
      response([{ entityId: moved.id, change: 'changed', after: moved }]),
    );
    expect(candidate.diff.entities[0].before).toMatchObject({
      id: moved.id,
      parent: 'endpoint-create-order',
    });
    expect(candidate.diff.entities[0].changedFields).toEqual(['provenance']);
    const evolved = evolveSemanticDiagramDiffUnion({ before: base, diff: candidate.diff });
    expect(evolved.value?.pointsOfInterest.nodeIds).toEqual([]);
    expect(candidate.document.entities[0].children?.[1]).toEqual(base.entities[0].children?.[1]);
  });
  it('adds a module under its parent', () => {
    const added = { ...flat('module-create-order'), id: 'new-module', name: 'New module' };
    const result = completeEvolveCandidate(
      base,
      response([{ entityId: added.id, change: 'added', after: added }]),
    );
    expect(buildEntityTree(result.document).byId.get(added.id)?.parentId).toBe(
      'endpoint-create-order',
    );
  });
  it.each([
    'changed',
    'removed',
    'added',
  ])('rejects %s IDs inconsistent with the base', (change) => {
    const id = change === 'added' ? 'module-create-order' : 'missing';
    expect(() =>
      completeEvolveCandidate(
        base,
        response([{ entityId: id, change, after: flat('module-create-order') }]),
      ),
    ).toThrow(/base/);
  });
  it('rejects removing a parent while leaving its children and relation endpoints', () => {
    expect(() =>
      completeEvolveCandidate(base, response([{ entityId: 'api-checkout', change: 'removed' }])),
    ).toThrow();
  });
  it('rejects a newly missing parent', () => {
    expect(() =>
      completeEvolveCandidate(
        base,
        response([
          {
            entityId: 'module-create-order',
            change: 'changed',
            after: { ...flat('module-create-order'), parent: 'missing' },
          },
        ]),
      ),
    ).toThrow();
  });
  it('rejects caller-authored before snapshots', () => {
    expect(() =>
      completeEvolveCandidate(
        base,
        response([
          {
            entityId: 'module-create-order',
            change: 'changed',
            before: {},
            after: flat('module-create-order'),
          },
        ]),
      ),
    ).toThrow(/before/);
  });
});

describe('committed evolution', () => {
  it('adds a repo schema type while keeping the committed base valid', async () => {
    const { root, git } = await fixture(false);
    const schema: SchemaModule = {
      owner: 'repo',
      name: 'example',
      version: '0.1',
      use: [{ schema: 'core/code@0.1' }],
      types: [],
      relations: [],
    };
    const schemaBase = {
      ...base,
      schemaRefs: [...base.schemaRefs, { schema: 'repo/example@0.1', layer: 1 }],
    };
    await fs.writeFile(
      path.join(root, '.tarskia/example.schema.yaml'),
      serializeSchemaModule(schema),
    );
    await fs.writeFile(path.join(root, '.tarskia/example.yaml'), serializeDocument(schemaBase));
    await git.add('.');
    await git.commit('Schema diagram');
    await fs.writeFile(path.join(root, 'app.ts'), 'new module\n');
    await git.add('.');
    await git.commit('Code');
    const nextSchema = serializeSchemaModule({
      ...schema,
      types: [{ id: 'domain-module', extends: 'core/code.types.module' }],
      relations: [{ id: 'domain-call', label: 'Domain call', directed: true }],
    });
    const evolve = vi.fn(async () => ({
      response: response(
        [
          {
            entityId: 'module-create-order',
            change: 'changed',
            after: { ...flat('module-create-order'), type: 'repo/example.types.domain-module' },
          },
        ],
        [],
        nextSchema,
      ),
      threadId: null,
    }));
    const result = await evolveDiagram({ cwd: root, evolver: { evolve }, logger: logger() });
    expect(result.status).toBe('succeeded');
    if (result.status !== 'succeeded') throw new Error('expected success');
    expect(result.addedTypes).toEqual(['domain-module', 'domain-call']);
    const writtenSchema = parseSchema(await fs.readFile(result.schemaOutputPath!, 'utf8'));
    expect(writtenSchema.types[0].id).toBe('domain-module');
    expect(writtenSchema.relations[0].id).toBe('domain-call');
    expect(evolve).toHaveBeenCalledTimes(1);
  });
  it('uses a squash merge carrying code and diagram as the next base', async () => {
    const { root, git } = await fixture(false);
    const mainBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    await git.checkoutLocalBranch('feature');
    await fs.writeFile(path.join(root, 'app.ts'), 'branch code\n');
    await fs.writeFile(
      path.join(root, '.tarskia/example.yaml'),
      serializeDocument({ ...base, metadata: { name: 'Squashed' } }),
    );
    await git.add('.');
    await git.commit('Feature');
    await git.checkout(mainBranch);
    await git.merge(['--squash', 'feature']);
    await git.commit('Squash');
    const squash = (await git.revparse(['HEAD'])).trim();
    await fs.writeFile(path.join(root, 'app.ts'), 'later code\n');
    await git.add('.');
    await git.commit('Later');
    const result = await evolveDiagram({
      cwd: root,
      evolver: { evolve: vi.fn(async () => ({ response: response(), threadId: null })) },
      logger: logger(),
    });
    expect(result.baseCommit).toBe(squash);
  });
  it('exports committed code without history or .tarskia, repairs, and writes durable comparison files', async () => {
    const { root, git, commit } = await fixture();
    const head = (await git.revparse(['HEAD'])).trim();
    await fs.writeFile(path.join(root, 'app.ts'), 'uncommitted source');
    await fs.writeFile(path.join(root, '.tarskia/example.yaml'), 'uncommitted diagram');
    const log = logger();
    const evolve = vi.fn(async (input: DiagramEvolverInput) => {
      expect(await fs.readFile(path.join(input.workspaceRoot, 'repo/app.ts'), 'utf8')).toContain(
        'version = 2',
      );
      await expect(fs.stat(path.join(input.workspaceRoot, 'repo/.git'))).rejects.toThrow();
      await expect(fs.stat(path.join(input.workspaceRoot, 'repo/.tarskia'))).rejects.toThrow();
      const diff = await fs.readFile(path.join(input.workspaceRoot, 'input/code.diff'), 'utf8');
      expect(diff).not.toContain('PRIVATE');
      expect(diff).not.toContain('.tarskia');
      expect(buildDiagramEvolvePrompt(input)).not.toContain('PRIVATE');
      return {
        response: input.diagnostics.length
          ? response()
          : response([{ entityId: 'absent', change: 'removed' }]),
        threadId: 'stub',
      };
    });
    const result = await evolveDiagram({ cwd: root, logger: log, evolver: { evolve } });
    expect(evolve).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('succeeded');
    if (result.status !== 'succeeded') throw new Error('expected success');
    expect(result.baseCommit).toBe(commit);
    expect(result.compareCommit).toBe(commit);
    expect(await git.revparse(['HEAD'])).toContain(head);
    expect(await fs.readFile(path.join(root, 'app.ts'), 'utf8')).toBe('uncommitted source');
    const output = await fs.readFile(result.outputPath, 'utf8');
    expect(parseDocument(output).entities).toEqual(base.entities);
    expect(parseDocument(output).inputs?.[0].revision).toBe(head);
    expect(await fs.readFile(result.comparePath, 'utf8')).toBe(CANONICAL_EXAMPLE_YAML);
    expect(
      JSON.parse(await fs.readFile(path.join(root, '.tarskia/.job/compare/example.json'), 'utf8')),
    ).toEqual({
      baseCommit: commit,
      afterSha256: createHash('sha256').update(output).digest('hex'),
    });
    await expect(fs.stat(path.join(root, '.tarskia/.job/.lock'))).rejects.toThrow();
    expect(log.warn.mock.calls.flat().join('\n')).toContain('Replacing uncommitted');
    expect(log.warn.mock.calls.flat().join('\n')).toContain('Uncommitted changes outside');
  });
  it('uses the last diagram-changing commit while comparison remains at the branch merge base', async () => {
    const { root, git, commit } = await fixture();
    const changedBase = { ...base, metadata: { name: 'Earlier evolution' } };
    await fs.writeFile(path.join(root, '.tarskia/example.yaml'), serializeDocument(changedBase));
    await git.add('.');
    await git.commit('Earlier evolve');
    const diagramCommit = (await git.revparse(['HEAD'])).trim();
    await fs.writeFile(path.join(root, 'app.ts'), 'const version = 3;\n');
    await git.add('.');
    await git.commit('Skipped evolve');
    const result = await evolveDiagram({
      cwd: root,
      logger: logger(),
      evolver: { evolve: vi.fn(async () => ({ response: response(), threadId: null })) },
    });
    expect(result.baseCommit).toBe(diagramCommit);
    if (result.status !== 'succeeded') throw new Error('expected success');
    expect(result.compareCommit).toBe(commit);
    expect(await fs.readFile(result.comparePath, 'utf8')).toBe(CANONICAL_EXAMPLE_YAML);
  });
  it('writes nothing and does not call the agent when no code changed', async () => {
    const { root, git } = await fixture(false);
    await fs.writeFile(path.join(root, '.tarskia/other.txt'), 'metadata only');
    await git.add('.');
    await git.commit('Metadata only');
    const evolve = vi.fn();
    const result = await evolveDiagram({ cwd: root, evolver: { evolve }, logger: logger() });
    expect(result.status).toBe('unchanged');
    expect(evolve).not.toHaveBeenCalled();
    await expect(fs.stat(path.join(root, '.tarskia/.job'))).rejects.toThrow();
  });
  it('fails with the prescribed guidance when there is no committed diagram', async () => {
    const { root } = await fixture(false, false);
    await expect(evolveDiagram({ cwd: root })).rejects.toThrow(
      'No committed diagram in .tarskia/. Run tarskia build, then commit its output there.',
    );
  });
  it.each([
    undefined,
    'owner: repo\nname: example\nversion: "0.1"\ntypes: []\nrelations: []',
  ])('repairs unknown types and fails naming the type without writing output (schema=%s)', async (schema) => {
    const { root } = await fixture();
    const evolve = vi.fn(async () => ({
      response: response(
        [
          {
            entityId: 'module-create-order',
            change: 'changed',
            after: { ...flat('module-create-order'), type: 'repo/example.types.unavailable' },
          },
        ],
        [],
        schema,
      ),
      threadId: null,
    }));
    await expect(
      evolveDiagram({ cwd: root, evolver: { evolve }, logger: logger() }),
    ).rejects.toThrow(/unavailable/);
    expect(evolve).toHaveBeenCalledTimes(4);
    expect(await fs.readFile(path.join(root, '.tarskia/example.yaml'), 'utf8')).toBe(
      CANONICAL_EXAMPLE_YAML,
    );
  });
});

describe('additive repo schema', () => {
  const schema: SchemaModule = {
    owner: 'repo',
    name: 'example',
    version: '0.1',
    types: [{ id: 'module' }],
    relations: [],
  };
  it('accepts added types and properties', () => {
    expect(
      assertAdditiveSchema(schema, {
        ...schema,
        types: [{ id: 'module', properties: [{ id: 'status', type: 'string' }] }, { id: 'new' }],
      }),
    ).toEqual(['new']);
  });
  it('accepts new relation types but freezes existing relation definitions', () => {
    const withRelation = { ...schema, relations: [{ id: 'calls', label: 'Calls' }] };
    expect(assertAdditiveSchema(schema, withRelation)).toEqual(['calls']);
    expect(() => assertAdditiveSchema(withRelation, schema)).toThrow('relation type calls');
    expect(() =>
      assertAdditiveSchema(withRelation, {
        ...withRelation,
        relations: [{ id: 'calls', label: 'Changed' }],
      }),
    ).toThrow('relation type calls');
  });
  it('permits imports referenced by new types without remapping existing imports', () => {
    const imported = { ...schema, use: [{ schema: 'core/base@0.1', alias: 'base' }] };
    const next = {
      ...imported,
      use: [...imported.use, { schema: 'core/software@0.1', alias: 'software' }],
      types: [...schema.types, { id: 'new', extends: 'software.types.module' }],
    };
    expect(assertAdditiveSchema(imported, next)).toEqual(['new']);
    expect(() => assertAdditiveSchema(imported, { ...next, types: schema.types })).toThrow(
      'needed by an added type',
    );
    expect(() =>
      assertAdditiveSchema(imported, {
        ...next,
        use: [{ schema: 'core/software@0.1', alias: 'base' }],
      }),
    ).toThrow('remap');
    expect(() =>
      assertAdditiveSchema(imported, {
        ...next,
        use: [...imported.use, { schema: 'core/base@0.2', alias: 'other' }],
      }),
    ).toThrow('remap');
  });
  it.each([
    { ...schema, types: [] },
    { ...schema, types: [{ id: 'module', label: 'Changed' }] },
    { ...schema, version: '0.2' },
  ])('rejects removing or changing existing schema definitions', (next) => {
    expect(() => assertAdditiveSchema(schema, next as SchemaModule)).toThrow();
  });
});
