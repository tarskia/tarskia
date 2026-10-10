import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { simpleGit } from 'simple-git';
import { describe, expect, it, vi } from 'vitest';
import { buildRepoCensus } from './advanced/repo-census';
import { SECRET_LINT_VERSION } from './secret-masking';
import { buildSshCloneFallbackUrl, prepareWorkspace } from './workspace';

async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createGitRepo(files: Record<string, string>): Promise<string> {
  const repoRoot = await createTempDir('diagram-worker-workspace-repo-');
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(repoRoot, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, contents, 'utf8');
  }

  const git = simpleGit(repoRoot);
  await git.init();
  await git.addConfig('user.name', 'Diagram Worker Test');
  await git.addConfig('user.email', 'diagram-worker@example.com');
  await git.add('.');
  await git.commit('Initial commit');
  return repoRoot;
}

async function withGitConfig<T>(lines: string[], action: () => Promise<T>): Promise<T> {
  const homePath = await createTempDir('diagram-worker-git-home-');
  await fs.writeFile(path.join(homePath, '.gitconfig'), lines.join('\n'), 'utf8');

  const previousEnv = {
    HOME: process.env.HOME,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
  };
  process.env.HOME = homePath;
  process.env.GIT_CONFIG_NOSYSTEM = '1';

  try {
    return await action();
  } finally {
    if (previousEnv.HOME === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousEnv.HOME;
    }
    if (previousEnv.GIT_CONFIG_NOSYSTEM === undefined) {
      delete process.env.GIT_CONFIG_NOSYSTEM;
    } else {
      process.env.GIT_CONFIG_NOSYSTEM = previousEnv.GIT_CONFIG_NOSYSTEM;
    }
  }
}

describe('prepareWorkspace', () => {
  it('ignores job artifacts, warns for local edits, and warns again on resume', async () => {
    const repo = await createGitRepo({ 'tracked.ts': 'committed' });
    const schemaSource = await createGitRepo({ 'base.yaml': 'id: core/test@0.1\n' });
    const jobRoot = path.join(repo, 'diagram.yaml.job');
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const first = await prepareWorkspace({ repo, schemaSource, jobRoot, logger });
    expect(await fs.readFile(path.join(jobRoot, '.gitignore'), 'utf8')).toBe('*\n');
    expect(await simpleGit(repo).raw(['status', '--porcelain'])).toBe('');
    expect(logger.warn).not.toHaveBeenCalled();
    await fs.writeFile(path.join(repo, 'tracked.ts'), 'uncommitted');
    await fs.writeFile(path.join(repo, 'untracked.ts'), 'untracked');
    await prepareWorkspace({
      repo,
      schemaSource,
      jobRoot,
      logger,
      resume: {
        expectedRepoRevision: first.repoRevision,
        expectedSchemaSourceRevision: first.schemaSourceRevision,
      },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      `Building from commit ${first.repoRevision.slice(0, 12)}; uncommitted changes in ${repo} are not included.`,
    );
    expect(await fs.readFile(path.join(first.targetRepoPath, 'tracked.ts'), 'utf8')).toBe(
      'committed',
    );
    logger.warn.mockClear();
    await prepareWorkspace({
      repo: pathToFileURL(repo).href,
      schemaSource,
      jobRoot,
      logger,
      hardRefresh: true,
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('builds SSH fallback URLs for HTTPS repository URLs', () => {
    expect(buildSshCloneFallbackUrl('https://github.com/example/private-repo')).toBe(
      'git@github.com:example/private-repo.git',
    );
    expect(buildSshCloneFallbackUrl('https://github.com/example/private-repo.git/')).toBe(
      'git@github.com:example/private-repo.git',
    );
    expect(
      buildSshCloneFallbackUrl('https://git.example.com:8443/team/private-repo.git'),
    ).toBeUndefined();
    expect(buildSshCloneFallbackUrl('git@github.com:example/private-repo.git')).toBeUndefined();
    expect(buildSshCloneFallbackUrl('/tmp/private-repo')).toBeUndefined();
  });

  it('rejects repository specifiers that can be parsed as git options', async () => {
    const schemaSource = await createGitRepo({
      'src/schemas/core.yaml': 'id: core/test@0.1\n',
    });

    await expect(
      prepareWorkspace({
        repo: '--upload-pack=/tmp/not-a-real-command',
        schemaSource,
        jobRoot: await createTempDir('diagram-worker-workspace-job-'),
      }),
    ).rejects.toThrow('values starting with "-" can be interpreted as git options');
  });

  it('rejects command-capable git protocols', async () => {
    const schemaSource = await createGitRepo({
      'src/schemas/core.yaml': 'id: core/test@0.1\n',
    });

    await expect(
      prepareWorkspace({
        repo: 'ext::sh -c echo unsafe',
        schemaSource,
        jobRoot: await createTempDir('diagram-worker-workspace-job-'),
      }),
    ).rejects.toThrow('remote-ext protocol is not supported');
  });

  it('tries the original HTTPS URL before any SSH URL', async () => {
    const sshRepoRoot = await createGitRepo({
      'src/index.ts': 'export const transport = "ssh";\n',
    });
    const httpsRepoRoot = await createGitRepo({
      'src/index.ts': 'export const transport = "https";\n',
    });
    const schemaSource = await createGitRepo({
      'src/schemas/core.yaml': 'id: core/test@0.1\n',
    });
    const jobRoot = await createTempDir('diagram-worker-workspace-job-');

    await withGitConfig(
      [
        '[protocol "file"]',
        '\tallow = always',
        `[url "${pathToFileURL(httpsRepoRoot).href}"]`,
        '\tinsteadOf = https://example.test/acme/private-repo.git',
        `[url "${pathToFileURL(sshRepoRoot).href}"]`,
        '\tinsteadOf = git@example.test:acme/private-repo.git',
      ],
      async () => {
        const prepared = await prepareWorkspace({
          repo: 'https://example.test/acme/private-repo.git',
          schemaSource,
          jobRoot,
        });

        expect(prepared.repoRevision).toBe(await simpleGit(httpsRepoRoot).revparse(['HEAD']));
        await expect(
          fs.readFile(path.join(prepared.targetRepoPath, 'src/index.ts'), 'utf8'),
        ).resolves.toContain('"https"');
      },
    );
  });

  it('uses a working HTTPS URL without trying an unavailable SSH URL', async () => {
    const httpsRepoRoot = await createGitRepo({
      'src/index.ts': 'export const transport = "https";\n',
    });
    const schemaSource = await createGitRepo({
      'src/schemas/core.yaml': 'id: core/test@0.1\n',
    });
    const jobRoot = await createTempDir('diagram-worker-workspace-job-');
    const missingRepoUrl = pathToFileURL(
      path.join(await createTempDir('diagram-worker-missing-repo-'), 'missing'),
    ).href;

    await withGitConfig(
      [
        '[protocol "file"]',
        '\tallow = always',
        `[url "${missingRepoUrl}"]`,
        '\tinsteadOf = git@example.test:acme/private-repo.git',
        `[url "${pathToFileURL(httpsRepoRoot).href}"]`,
        '\tinsteadOf = https://example.test/acme/private-repo.git',
      ],
      async () => {
        const prepared = await prepareWorkspace({
          repo: 'https://example.test/acme/private-repo.git',
          schemaSource,
          jobRoot,
        });

        expect(prepared.repoRevision).toBe(await simpleGit(httpsRepoRoot).revparse(['HEAD']));
        await expect(
          fs.readFile(path.join(prepared.targetRepoPath, 'src/index.ts'), 'utf8'),
        ).resolves.toContain('"https"');
      },
    );
  });

  it('prunes hard-excluded schemas from the copied schema workspace', async () => {
    const repoRoot = await createGitRepo({
      'src/index.ts': 'export const app = true;\n',
    });
    const schemaSource = await createGitRepo({
      'src/schemas/base.yaml':
        'owner: core\nname: base\nversion: "0.1"\ntypes: []\nrelations: []\n',
      'src/schemas/data-model.yaml':
        'owner: core\nname: data-model\nversion: "0.3"\ntypes: []\nrelations: []\n',
    });

    const prepared = await prepareWorkspace({
      repo: repoRoot,
      schemaSource,
    });

    expect(Date.parse(prepared.repoCommittedAt ?? '')).not.toBeNaN();
    await expect(
      fs.access(path.join(prepared.schemaRepoPath, 'src/schemas/base.yaml')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(prepared.schemaRepoPath, 'src/schemas/data-model.yaml')),
    ).rejects.toThrow();
  });

  it('reuses an existing prepared workspace when the expected revisions still match', async () => {
    const repoRoot = await createGitRepo({
      'src/index.ts': 'export const app = true;\n',
    });
    const schemaSource = await createGitRepo({
      'src/schemas/core.yaml': 'id: core/test@0.1\n',
    });
    const jobRoot = await createTempDir('diagram-worker-workspace-job-');

    const first = await prepareWorkspace({
      repo: repoRoot,
      schemaSource,
      jobRoot,
    });

    const repoMarkerPath = path.join(first.targetRepoPath, 'resume-marker.txt');
    const schemaMarkerPath = path.join(first.schemaRepoPath, 'resume-marker.txt');
    await fs.writeFile(repoMarkerPath, 'keep', 'utf8');
    await fs.writeFile(schemaMarkerPath, 'keep', 'utf8');

    const resumed = await prepareWorkspace({
      repo: repoRoot,
      schemaSource,
      jobRoot,
      resume: {
        expectedRepoRevision: first.repoRevision,
        expectedSchemaSourceRevision: first.schemaSourceRevision ?? null,
      },
    });

    await expect(fs.readFile(repoMarkerPath, 'utf8')).resolves.toBe('keep');
    await expect(fs.readFile(schemaMarkerPath, 'utf8')).resolves.toBe('keep');
    expect(resumed.repoRevision).toBe(first.repoRevision);
    expect(resumed.schemaSourceRevision).toBe(first.schemaSourceRevision);
  });

  it('refreshes the copied schema workspace when the source schema revision changes', async () => {
    const repoRoot = await createGitRepo({
      'src/index.ts': 'export const app = true;\n',
    });
    const schemaSource = await createGitRepo({
      'src/schemas/core.yaml': 'id: core/test@0.1\n',
    });
    const jobRoot = await createTempDir('diagram-worker-workspace-job-');

    const first = await prepareWorkspace({
      repo: repoRoot,
      schemaSource,
      jobRoot,
    });

    const schemaMarkerPath = path.join(first.schemaRepoPath, 'resume-marker.txt');
    await fs.writeFile(schemaMarkerPath, 'stale', 'utf8');

    const updatedSchemaPath = path.join(schemaSource, 'src/schemas/core.yaml');
    await fs.writeFile(updatedSchemaPath, 'id: core/test@0.2\n', 'utf8');
    const schemaGit = simpleGit(schemaSource);
    await schemaGit.add('.');
    await schemaGit.commit('Update schema');

    const resumed = await prepareWorkspace({
      repo: repoRoot,
      schemaSource,
      jobRoot,
      resume: {
        expectedRepoRevision: first.repoRevision,
        expectedSchemaSourceRevision: first.schemaSourceRevision ?? null,
      },
    });

    await expect(fs.access(schemaMarkerPath)).rejects.toThrow();
    expect(resumed.schemaSourceRevision).not.toBe(first.schemaSourceRevision);
  });

  it('reclones and discards old analysis when a later-stage target clone is missing', async () => {
    const repoRoot = await createGitRepo({
      'src/index.ts': 'export const app = true;\n',
    });
    const schemaSource = await createGitRepo({
      'src/schemas/core.yaml': 'id: core/test@0.1\n',
    });
    const jobRoot = await createTempDir('diagram-worker-workspace-job-');

    const first = await prepareWorkspace({
      repo: repoRoot,
      schemaSource,
      jobRoot,
    });

    await fs.mkdir(path.join(first.workspaceOutputDir, 'analysis'), { recursive: true });
    await fs.writeFile(
      path.join(first.workspaceOutputDir, 'analysis/repo-census.json'),
      '{"summary":{"totalFiles":1,"totalDirectories":1,"totalLines":1,"languages":{},"topLevelPaths":[]},"signals":[]}',
      'utf8',
    );

    await Promise.all([
      fs.rm(first.targetRepoPath, { recursive: true, force: true }),
      fs.rm(first.schemaRepoPath, { recursive: true, force: true }),
    ]);

    const updatedSchemaPath = path.join(schemaSource, 'src/schemas/core.yaml');
    await fs.writeFile(updatedSchemaPath, 'id: core/test@0.2\n', 'utf8');
    const schemaGit = simpleGit(schemaSource);
    await schemaGit.add('.');
    await schemaGit.commit('Update schema before artifact-only resume');

    const resumed = await prepareWorkspace({
      repo: repoRoot,
      schemaSource,
      jobRoot,
      resume: {
        expectedRepoRevision: first.repoRevision,
        expectedSchemaSourceRevision: first.schemaSourceRevision ?? null,
        allowMissingTargetRepo: true,
        requiredArtifactPaths: ['analysis/repo-census.json'],
      },
    });

    await expect(fs.access(path.join(resumed.targetRepoPath))).resolves.toBeUndefined();
    await expect(
      fs.readFile(path.join(resumed.schemaRepoPath, 'src/schemas/core.yaml'), 'utf8'),
    ).resolves.toContain('core/test@0.2');
    expect(resumed.repoRevision).toBe(first.repoRevision);
    expect(resumed.analysisReusable).toBe(false);
    await expect(
      fs.access(path.join(resumed.workspaceOutputDir, 'analysis/repo-census.json')),
    ).rejects.toThrow();
    expect(await fs.readFile(path.join(resumed.targetRepoPath, 'src/index.ts'), 'utf8')).toContain(
      'export const app',
    );
  });
});

it.each([
  'missing',
  'malformed',
  'old-version',
  'legacy-git',
  'git-reappeared',
  'marker-symlink',
])('reclones and discards unsafe analysis with %s masking marker', async (kind) => {
  const secret = 'ghp_' + randomBytes(18).toString('hex');
  const repo = await createGitRepo({ 'config.txt': secret, 'plain.txt': 'unchanged' });
  const schemaSource = await createGitRepo({ 'core.yaml': 'id: core/test@0.1\n' });
  const jobRoot = await createTempDir('mask-migrate-');
  const first = await prepareWorkspace({ repo, schemaSource, jobRoot });
  const markerPath = path.join(jobRoot, 'target-repo.json');
  if (kind === 'missing' || kind === 'legacy-git') await fs.rm(markerPath);
  if (kind === 'malformed') await fs.writeFile(markerPath, '{');
  if (kind === 'old-version') {
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    marker.secretlintVersion = 'old';
    await fs.writeFile(markerPath, JSON.stringify(marker));
  }
  if (kind === 'legacy-git' || kind === 'git-reappeared') {
    await fs.cp(path.join(repo, '.git'), path.join(first.targetRepoPath, '.git'), {
      recursive: true,
    });
  }
  if (kind === 'marker-symlink') {
    const external = path.join(await createTempDir('marker-external-'), 'marker.json');
    await fs.rename(markerPath, external);
    await fs.symlink(external, markerPath);
  }
  await fs.writeFile(path.join(first.targetRepoPath, 'config.txt'), secret);
  await fs.writeFile(path.join(first.targetRepoPath, 'stale.txt'), 'old clone');
  await fs.mkdir(path.join(first.workspaceOutputDir, 'analysis'), { recursive: true });
  await fs.writeFile(path.join(first.workspaceOutputDir, 'analysis/old-response'), secret);
  const next = await prepareWorkspace({
    repo,
    schemaSource,
    jobRoot,
    resume: {
      expectedRepoRevision: first.repoRevision,
      expectedSchemaSourceRevision: first.schemaSourceRevision,
    },
  });
  expect(next.analysisReusable).toBe(false);
  expect(await fs.readFile(path.join(next.targetRepoPath, 'config.txt'), 'utf8')).toBe(
    '[REDACTED]',
  );
  expect(await fs.readFile(path.join(repo, 'config.txt'), 'utf8')).toBe(secret);
  await expect(fs.lstat(path.join(next.targetRepoPath, '.git'))).rejects.toThrow();
  await expect(fs.stat(path.join(next.targetRepoPath, 'stale.txt'))).rejects.toThrow();
  await expect(
    fs.stat(path.join(next.workspaceOutputDir, 'analysis/old-response')),
  ).rejects.toThrow();
  const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
  expect(marker).toMatchObject({
    revision: first.repoRevision,
    secretlintVersion: SECRET_LINT_VERSION,
    maskedFiles: 1,
    maskedSecrets: 1,
  });
  expect(JSON.stringify(marker)).not.toContain(secret);
});

it('strips deleted history, masks before analysis, preserves the original, and reuses counts', async () => {
  const secret = 'ghp_' + randomBytes(18).toString('hex');
  const deletedSecret = 'ghp_' + randomBytes(18).toString('hex');
  const repo = await createGitRepo({
    'config.txt': secret,
    'deleted.txt': deletedSecret,
    'plain.txt': 'unchanged\n',
  });
  await fs.rm(path.join(repo, 'deleted.txt'));
  const externalRoot = await createTempDir('mask-external-');
  const external = path.join(externalRoot, 'private.txt');
  await fs.writeFile(external, secret);
  await fs.symlink(external, path.join(repo, 'external-link'));
  await simpleGit(repo).add('.');
  await simpleGit(repo).commit('Delete historical secret and add external link');
  const schemaSource = await createGitRepo({ 'core.yaml': 'id: core/test@0.1\n' });
  const jobRoot = await createTempDir('mask-history-');
  const onSecrets = vi.fn();
  const first = await prepareWorkspace({ repo, schemaSource, jobRoot, onSecrets });
  expect(onSecrets).toHaveBeenLastCalledWith(first.secrets);
  expect(await fs.readFile(path.join(first.targetRepoPath, 'config.txt'), 'utf8')).toBe(
    '[REDACTED]',
  );
  expect(await fs.readFile(path.join(first.targetRepoPath, 'plain.txt'))).toEqual(
    await fs.readFile(path.join(repo, 'plain.txt')),
  );
  for (const removed of ['.git', 'deleted.txt', 'external-link'])
    await expect(fs.lstat(path.join(first.targetRepoPath, removed))).rejects.toThrow();
  expect(await fs.readFile(external, 'utf8')).toBe(secret);
  expect(await fs.readFile(path.join(repo, 'config.txt'), 'utf8')).toBe(secret);
  expect(await simpleGit(repo).raw(['status', '--porcelain'])).toBe('');
  const marker = JSON.parse(await fs.readFile(path.join(jobRoot, 'target-repo.json'), 'utf8'));
  expect(marker.committedAt).toBe(first.repoCommittedAt);
  expect(first.secrets).toMatchObject({
    maskedInRepo: 1,
    redactedFromOutput: 0,
    files: [{ path: 'config.txt' }],
  });
  const census = await buildRepoCensus({
    repoRoot: first.targetRepoPath,
    repoUrl: repo,
    repoRevision: first.repoRevision,
  });
  expect(census.files.find((file) => file.path === 'config.txt')?.byteCount).toBe(
    Buffer.byteLength('[REDACTED]'),
  );
  expect(JSON.stringify(census)).not.toContain(secret);

  await fs.writeFile(path.join(first.targetRepoPath, 'reuse.txt'), 'reuse sentinel');
  const second = await prepareWorkspace({
    repo,
    schemaSource,
    jobRoot,
    onSecrets,
    resume: {
      expectedRepoRevision: first.repoRevision,
      expectedSchemaSourceRevision: first.schemaSourceRevision,
    },
  });
  expect(second.analysisReusable).toBe(true);
  expect(onSecrets).toHaveBeenLastCalledWith(second.secrets);
  expect(second.secrets).toEqual(first.secrets);
  expect(await fs.readFile(path.join(second.targetRepoPath, 'reuse.txt'), 'utf8')).toBe(
    'reuse sentinel',
  );
  onSecrets.mockClear();
  await fs.rm(schemaSource, { recursive: true, force: true });
  await expect(
    prepareWorkspace({
      repo,
      schemaSource,
      jobRoot,
      onSecrets,
      resume: {
        expectedRepoRevision: first.repoRevision,
        expectedSchemaSourceRevision: first.schemaSourceRevision,
      },
    }),
  ).rejects.toThrow();
  expect(onSecrets).toHaveBeenLastCalledWith(first.secrets);
});
