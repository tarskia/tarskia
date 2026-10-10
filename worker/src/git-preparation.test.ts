import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultRepositoryService } from './repository-service';
import { prepareWorkspace } from './workspace';

const state = vi.hoisted(() => ({
  attempts: [] as string[],
  instances: [] as { options: { baseDir?: string; timeout?: unknown }; env?: NodeJS.ProcessEnv }[],
  failure: undefined as Error | undefined,
  fetchFailure: undefined as Error | undefined,
}));
vi.mock('simple-git', () => ({
  simpleGit: (options: { baseDir?: string; timeout?: unknown } = {}) => {
    const instance = { options, env: undefined as NodeJS.ProcessEnv | undefined };
    state.instances.push(instance);
    const git = {
      env: (env: NodeJS.ProcessEnv) => {
        instance.env = env;
        return git;
      },
      clone: async (url: string, destination: string) => {
        state.attempts.push(url);
        if (state.failure && state.attempts.length === 1) throw state.failure;
        await fs.mkdir(path.join(destination, '.git'), { recursive: true });
        await fs.writeFile(path.join(destination, 'app.ts'), 'export const app = true;');
      },
      revparse: async () => 'a'.repeat(40),
      show: async () => '2026-01-01T00:00:00Z',
      getRemotes: async () => [],
      raw: async () => '',
      fetch: async () => {
        if (state.fetchFailure) throw state.fetchFailure;
      },
      checkout: async () => '',
    };
    return git;
  },
}));
let root: string;
const schemaSource = path.resolve('test/fixtures/schema-repo');
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'git-preparation-'));
  state.attempts = [];
  state.instances = [];
  state.failure = undefined;
  state.fetchFailure = undefined;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});
const prepare = (repo: string, ref?: string) =>
  prepareWorkspace({ repo, ref, schemaSource, jobRoot: root });

describe('clone transport policy', () => {
  it('uses the supplied HTTPS URL and credentials on the first attempt', async () => {
    const repo = 'https://user:SECRET@github.com/team/repo.git';
    await prepare(repo);
    expect(state.attempts).toEqual([repo]);
  });
  it.each([
    'github.com',
    'gitlab.com',
    'bitbucket.org',
  ])('retries HTTPS auth failures over SSH on %s', async (host) => {
    const repo = `https://user:SECRET@${host}/team/repo.git`;
    state.failure = new Error(`fatal: Authentication failed for '${repo}'`);
    await prepare(repo);
    expect(state.attempts).toEqual([repo, `git@${host}:team/repo.git`]);
    expect(
      state.instances.every((item) => item.env?.GIT_SSH_COMMAND === 'ssh -o BatchMode=yes'),
    ).toBe(true);
  });
  it.each([
    "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    "fatal: unable to access 'https://github.com/team/repo': The requested URL returned error: 401",
  ])('recognizes noninteractive credential failure: %s', async (message) => {
    state.failure = new Error(message);
    await prepare('https://github.com/team/repo');
    expect(state.attempts).toHaveLength(2);
  });
  it.each([
    'https://example.test/team/repo',
    'https://github.com.evil.test/team/repo',
    'https://sub.github.com/team/repo',
    'https://github.com./team/repo',
    'http://github.com/team/repo',
    'ssh://git@host:2222/team/repo',
    'git@github.com:team/repo',
  ])('never synthesizes SSH for %s', async (repo) => {
    state.failure = new Error('fatal: Authentication failed');
    await expect(prepare(repo)).rejects.toThrow('Failed to clone');
    expect(state.attempts).toEqual([repo]);
  });
  it('suggests an explicit SSH URL for unsupported HTTPS hosts', async () => {
    state.failure = new Error('fatal: Authentication failed');
    await expect(prepare('https://example.test/team/repo')).rejects.toThrow(
      'pass an explicit SSH repository URL',
    );
  });
  it.each([
    'fatal: repository not found',
    'fatal: Could not resolve host',
    'fatal: SSL certificate problem',
    'fatal: unable to access: 403',
    'Permission denied',
    "fatal: repository 'Authentication failed' not found",
  ])('does not retry non-authentication failures: %s', async (message) => {
    state.failure = new Error(message);
    await expect(prepare('https://github.com/team/repo')).rejects.toThrow('Failed to clone');
    expect(state.attempts).toHaveLength(1);
  });
  it('does not use an HTTPS port as the SSH port', async () => {
    state.failure = new Error('fatal: Authentication failed');
    await prepare('https://github.com:8443/team/repo');
    expect(state.attempts).toEqual([
      'https://github.com:8443/team/repo',
      'git@github.com:team/repo.git',
    ]);
  });
  it.each([
    'git@host:team/repo',
    'ssh://git@host:2222/team/repo',
  ])('preserves explicit SSH transport %s', async (repo) => {
    await prepare(repo);
    expect(state.attempts).toEqual([repo]);
  });
  it.each([
    'clone',
    'fetch',
  ])('reports a redacted %s timeout through the repository service', async (operation) => {
    const failure = Object.assign(
      new Error('block timeout reached https://user:SECRET@github.com/team/repo'),
      { plugin: 'timeout' },
    );
    if (operation === 'clone') state.failure = failure;
    else state.fetchFailure = failure;
    const promise = new DefaultRepositoryService().prepareRepositoryContext({
      repo: 'https://user:SECRET@github.com/team/repo',
      ref: 'main',
      schemaSource,
      jobRoot: root,
    });
    await expect(promise).rejects.toThrow(
      /timed out after 600000ms for https:\/\/github.com\/team\/repo/,
    );
    await expect(promise).rejects.not.toThrow('SECRET');
    expect(state.attempts).toHaveLength(1);
  });
  it('uses the configured factory for local metadata and workspace reuse too', async () => {
    vi.stubEnv('GIT_DIR', '/unsafe');
    vi.stubEnv('SECRET_TOKEN', 'secret');
    vi.stubEnv('TARSKIA_GIT_TIMEOUT_MS', '2345');
    const local = path.join(root, 'local');
    await fs.mkdir(path.join(local, '.git'), { recursive: true });
    await fs.writeFile(path.join(local, 'app.ts'), 'app');
    const options = { repo: local, schemaSource, jobRoot: path.join(root, 'job') };
    const service = new DefaultRepositoryService();
    const first = await service.prepareRepositoryContext(options);
    await service.prepareRepositoryContext({
      ...options,
      resume: { expectedRepoRevision: first.workspace.repoRevision },
    });
    expect(state.instances.length).toBeGreaterThan(5);
    for (const instance of state.instances) {
      expect(instance.options.timeout).toEqual({ block: 2345, stdOut: false, stdErr: false });
      expect(instance.env?.GIT_DIR).toBeUndefined();
      expect(instance.env?.SECRET_TOKEN).toBeUndefined();
      expect(instance.env?.GIT_LFS_SKIP_SMUDGE).toBe('1');
      expect(instance.env?.HOME).toBe(process.env.HOME);
    }
  });
});
