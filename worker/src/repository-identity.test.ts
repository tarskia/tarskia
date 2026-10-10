import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInitialJobMetadata, isCompatibleResumeMetadata } from './job-metadata';
import {
  redactLegacyRepositoryArtifacts,
  redactRepositoryError,
  redactRepositorySpecifier,
  redactRepositoryText,
} from './repository-identity';
import { normalizeRepositoryBrowseUrl } from './source-repository';

const credentialRepo = 'https://x-access-token:SECRET123@github.com/acme/repo';

describe('repository identities', () => {
  it.each(["sec'ret", 'sec"ret'])('redacts escaped legacy passwords %s', (password) => {
    const repoUrl = `https://user:${password}@host/o/r`;
    const artifact = JSON.stringify({ repoUrl, prompt: `Clone URL: ${repoUrl}` });
    const safe = JSON.parse(redactRepositoryText(artifact));
    expect(safe).toEqual({ repoUrl: 'https://host/o/r', prompt: 'Clone URL: https://host/o/r' });
    expect(redactRepositoryText(`Clone URL: ${repoUrl}`)).toBe('Clone URL: https://host/o/r');
    const control = JSON.stringify({ repoUrl: 'https://host', email: 'a@b' });
    expect(redactRepositoryText(control)).toBe(control);
  });

  it.each([
    [credentialRepo, 'https://github.com/acme/repo'],
    ['  ' + credentialRepo + '  ', 'https://github.com/acme/repo'],
    ['https://SECRET123@github.com/acme/repo.git', 'https://github.com/acme/repo.git'],
    [
      'https://user:S%45CRET123@host:8443/a%20b/repo?x=1#ref',
      'https://host:8443/a%20b/repo?x=1#ref',
    ],
    ['ssh://git:SECRET123@host:2222/o/r', 'ssh://git@host:2222/o/r'],
    ['ssh://git@host:2222/o/r', 'ssh://git@host:2222/o/r'],
    ['git@host:o/r.git', 'git@host:o/r.git'],
    ['/tmp/my repo', '/tmp/my repo'],
  ])('redacts %s while preserving transport identity', (input, output) => {
    expect(redactRepositorySpecifier(input)).toBe(output);
  });

  it('maps an explicit SSH port to the host browse URL', () => {
    expect(normalizeRepositoryBrowseUrl('ssh://git@host:2222/o/r')).toBe('https://host/o/r');
  });

  it('rebuilds nested errors without secret-bearing task fields or stacks', () => {
    const error = Object.assign(
      new Error(`clone ${credentialRepo}`, { cause: new Error('SECRET123 rejected') }),
      { task: { commands: [credentialRepo] } },
    );
    const safe = redactRepositoryError(
      new AggregateError([error], `failed ${credentialRepo}`),
      credentialRepo,
    ) as AggregateError;
    expect(JSON.stringify(safe, Object.getOwnPropertyNames(safe))).not.toContain('SECRET123');
    expect(safe.stack).not.toContain('SECRET123');
    expect(safe.errors[0].message).toContain('https://github.com/acme/repo');
    expect(safe.errors[0].cause.message).not.toContain('SECRET123');
    expect(safe.errors[0].task).toBeUndefined();
  });

  it('compares old credential-bearing metadata with safe resume identity', () => {
    const params = {
      repo: credentialRepo,
      schemaSource: '/schemas',
      outputPath: '/out.yaml',
      workspaceRoot: '/job',
    };
    const metadata = createInitialJobMetadata(params);
    metadata.repo = credentialRepo;
    expect(
      isCompatibleResumeMetadata(metadata, { ...params, repo: 'https://github.com/acme/repo' }),
    ).toBe(true);
  });

  it('scrubs persisted artifacts before reuse without touching source trees or symlinks', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-redact-'));
    try {
      await fs.mkdir(path.join(root, 'analysis'));
      await fs.mkdir(path.join(root, 'target-repo'));
      await fs.writeFile(
        path.join(root, 'analysis', 'repo-census.json'),
        JSON.stringify({ repoUrl: credentialRepo }),
      );
      await fs.writeFile(path.join(root, 'target-repo', 'source.txt'), credentialRepo);
      await fs.symlink(
        path.join(root, 'target-repo', 'source.txt'),
        path.join(root, 'analysis', 'link.txt'),
      );
      await redactLegacyRepositoryArtifacts(root);
      expect(
        await fs.readFile(path.join(root, 'analysis', 'repo-census.json'), 'utf8'),
      ).not.toContain('SECRET123');
      expect(await fs.readFile(path.join(root, 'target-repo', 'source.txt'), 'utf8')).toBe(
        credentialRepo,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
