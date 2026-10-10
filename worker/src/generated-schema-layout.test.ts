import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratedSchemaService } from './generated-schema';
import { loadSchemaRegistry, validateDiagramYaml } from './semantic';
import { type PreparedWorkspace, prepareWorkspace } from './workspace';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tarskia-schema-layout-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('generated schema registry layout', () => {
  it('reuses an older generated module without installing a duplicate schema ID', async () => {
    const schemaRepoPath = path.join(tempRoot, 'schema-repo');
    const schemaDirectory = path.join(schemaRepoPath, 'src', 'schemas');
    await fs.cp(path.resolve('assets/schemas'), schemaDirectory, { recursive: true });
    const artifactPath = path.join(schemaDirectory, 'application.yaml');
    await fs.writeFile(
      artifactPath,
      `owner: repo
name: application
version: "0.1"
use:
  - schema: core/code@0.1
types: []
relations: []
`,
    );
    const agent = { draftGeneratedSchema: vi.fn(), repairGeneratedSchema: vi.fn() };
    await expect(
      new GeneratedSchemaService({ agent }).prepareGeneratedSchema({
        workspace: {
          jobRoot: tempRoot,
          targetRepoPath: path.join(tempRoot, 'target-repo'),
          schemaRepoPath,
          workspaceOutputDir: path.join(tempRoot, 'out'),
          repoRevision: 'saved-revision',
        },
        repo: '/example/application',
        schemaId: 'repo/application',
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }),
    ).rejects.toThrow(
      `schema id repo/application already exists in ${schemaRepoPath}; pass a different --schema-id.`,
    );
    expect(agent.draftGeneratedSchema).not.toHaveBeenCalled();
    const reused = await new GeneratedSchemaService({ agent }).prepareGeneratedSchema({
      workspace: {
        jobRoot: tempRoot,
        targetRepoPath: path.join(tempRoot, 'target-repo'),
        schemaRepoPath,
        workspaceOutputDir: path.join(tempRoot, 'out'),
        repoRevision: 'saved-revision',
      },
      repo: '/example/application',
      schemaId: 'repo/application',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      resume: { status: 'succeeded', artifactPath },
    });
    expect(reused.status).toBe('succeeded');
    expect(reused.reused).toBe(true);
    expect(agent.draftGeneratedSchema).not.toHaveBeenCalled();
    expect(agent.repairGeneratedSchema).not.toHaveBeenCalled();
    const registry = await loadSchemaRegistry(schemaRepoPath);
    expect([...registry.modulesById.keys()]).toEqual(
      expect.arrayContaining(['core/base', 'core/code', 'repo/application']),
    );
  });

  it('refreshes schemas in a trusted masked workspace after an upgrade and retains its generated schema and census', async () => {
    const schemaSource = path.join(tempRoot, 'source');
    await fs.cp(path.resolve('assets/schemas'), schemaSource, { recursive: true });
    const sourceGit = simpleGit(schemaSource);
    await sourceGit.init();
    await sourceGit.addConfig('user.name', 'Tarskia Test');
    await sourceGit.addConfig('user.email', 'test@example.com');
    await sourceGit.add('.');
    await sourceGit.commit('Schema source upgrade');
    const schemaRevision = (await sourceGit.revparse(['HEAD'])).trim();
    const jobRoot = path.join(tempRoot, 'job');
    const target = path.join(tempRoot, 'original-repo');
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'README.md'), 'Application\n');
    const targetGit = simpleGit(target);
    await targetGit.init();
    await targetGit.addConfig('user.name', 'Tarskia Test');
    await targetGit.addConfig('user.email', 'test@example.com');
    await targetGit.add('.');
    await targetGit.commit('Application revision');
    const first = await prepareWorkspace({ repo: target, schemaSource, jobRoot });
    const repoRevision = first.repoRevision;
    await expect(fs.lstat(path.join(first.targetRepoPath, '.git'))).rejects.toThrow();
    await fs.writeFile(path.join(first.targetRepoPath, 'reuse-sentinel'), 'masked clone retained');
    const schemaRepo = path.join(jobRoot, 'schema-repo');
    await fs.cp(schemaSource, schemaRepo, { recursive: true });
    const shadowDirectory = path.join(schemaRepo, 'src', 'schemas');
    await fs.mkdir(shadowDirectory, { recursive: true });
    const yaml = `owner: repo
name: application
version: "0.1"
use:
  - schema: core/code@0.1
types: []
relations: []
`;
    await fs.writeFile(path.join(shadowDirectory, 'application.yaml'), yaml);
    const out = path.join(jobRoot, 'out');
    await fs.mkdir(path.join(out, 'generated-schema'), { recursive: true });
    await fs.mkdir(path.join(out, 'analysis'), { recursive: true });
    const artifactPath = path.join(out, 'generated-schema/application.yaml');
    await fs.writeFile(artifactPath, yaml);
    const censusPath = path.join(out, 'analysis/repo-census.json');
    await fs.writeFile(censusPath, '{"saved":"census"}\n');

    const workspace = await prepareWorkspace({
      repo: target,
      schemaSource,
      jobRoot,
      resume: {
        expectedRepoRevision: repoRevision,
        expectedSchemaSourceRevision: 'previous-worker-revision',
        allowMissingTargetRepo: true,
        requiredArtifactPaths: ['analysis/repo-census.json', 'generated-schema/application.yaml'],
      },
    });
    expect(workspace.repoRevision).toBe(repoRevision);
    expect(workspace.analysisReusable).toBe(true);
    expect(await fs.readFile(path.join(workspace.targetRepoPath, 'reuse-sentinel'), 'utf8')).toBe(
      'masked clone retained',
    );
    expect(workspace.schemaSourceRevision).toBe(schemaRevision);
    const agent = { draftGeneratedSchema: vi.fn(), repairGeneratedSchema: vi.fn() };
    const reused = await new GeneratedSchemaService({ agent }).prepareGeneratedSchema({
      workspace,
      repo: target,
      schemaId: 'repo/application',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      resume: { status: 'succeeded', artifactPath },
    });
    expect(reused.status).toBe('succeeded');
    expect(reused.reused).toBe(true);
    expect(agent.draftGeneratedSchema).not.toHaveBeenCalled();
    expect(agent.repairGeneratedSchema).not.toHaveBeenCalled();
    expect(await fs.readFile(censusPath, 'utf8')).toBe('{"saved":"census"}\n');
    expect(await fs.readFile(artifactPath, 'utf8')).toBe(yaml);
    const registry = await loadSchemaRegistry(workspace.schemaRepoPath);
    expect([...registry.modulesById.keys()]).toEqual(
      expect.arrayContaining(['core/base', 'core/code', 'repo/application']),
    );
  });

  it.each([
    'flat',
    'nested',
  ] as const)('keeps core imports available after generation and reuse in a %s registry', async (layout) => {
    const workspace: PreparedWorkspace = {
      jobRoot: tempRoot,
      targetRepoPath: path.join(tempRoot, 'target-repo'),
      schemaRepoPath: path.join(tempRoot, 'schema-repo'),
      workspaceOutputDir: path.join(tempRoot, 'out'),
      repoRevision: 'test-revision',
    };
    const schemaDirectory =
      layout === 'flat'
        ? workspace.schemaRepoPath
        : path.join(workspace.schemaRepoPath, 'src', 'schemas');
    await fs.cp(path.resolve('assets/schemas'), schemaDirectory, { recursive: true });
    const coreCodeBefore = await fs.readFile(path.join(schemaDirectory, 'code.yaml'), 'utf8');
    const yaml = `owner: repo
name: code
version: "0.1"
use:
  - schema: core/code@0.1
  - schema: core/web-app@0.3
types: []
relations: []
`;
    const agent = {
      draftGeneratedSchema: vi.fn().mockResolvedValue({
        yaml,
        rawResponse: yaml,
        threadId: 'schema-thread',
        items: [],
        usage: null,
      }),
      repairGeneratedSchema: vi.fn(),
    };
    const service = new GeneratedSchemaService({ agent });
    const options = {
      workspace,
      repo: '/example/code',
      schemaId: 'repo/code',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const generated = await service.prepareGeneratedSchema(options);
    expect(generated.status).toBe('succeeded');
    expect(generated.repaired).toBe(false);
    expect(agent.repairGeneratedSchema).not.toHaveBeenCalled();

    const assertRegistryResolves = async () => {
      const registry = await loadSchemaRegistry(workspace.schemaRepoPath);
      const validation = validateDiagramYaml({
        yaml: `version: 0.1.0
schemaRefs:
  - schema: repo/code@0.1
    layer: 0
entities: []
relations: []
`,
        schemaRegistry: registry,
      });
      expect(validation.diagnostics).toEqual([]);
      expect(validation.ok).toBe(true);
      expect(validation.resolvedSchemaIds).toEqual(
        expect.arrayContaining([
          'core/base',
          'core/software',
          'core/code',
          'core/web-app',
          'repo/code',
        ]),
      );
      expect(await fs.readFile(path.join(schemaDirectory, 'code.yaml'), 'utf8')).toBe(
        coreCodeBefore,
      );
    };
    await assertRegistryResolves();

    const reused = await service.prepareGeneratedSchema({
      ...options,
      resume: { status: 'succeeded', artifactPath: generated.artifactPath },
    });
    expect(reused.status).toBe('succeeded');
    expect(reused.reused).toBe(true);
    expect(agent.draftGeneratedSchema).toHaveBeenCalledTimes(1);
    expect(agent.repairGeneratedSchema).not.toHaveBeenCalled();
    await assertRegistryResolves();
  });
});
