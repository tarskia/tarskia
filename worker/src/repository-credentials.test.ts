import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import { buildDiagram } from './build-diagram';
import { DefaultRepositoryService } from './repository-service';
import { CANONICAL_EXAMPLE_YAML } from './semantic/diagram-synthesis-contract';
import { prepareWorkspace } from './workspace';

const state = vi.hoisted(() => ({
  clones: [] as string[],
  fetched: [] as string[],
  fail: false,
  localOrigin: '',
  interrupt: undefined as undefined | ((stage: string) => void),
}));
vi.mock('simple-git', () => ({
  simpleGit: (options?: string | { baseDir?: string }) => {
    const root = typeof options === 'string' ? options : options?.baseDir;
    const config = () => path.join(root!, '.git', 'config');
    const git = {
      env: () => git,
      clone: async (url: string, destination: string) => {
        state.clones.push(url);
        if (url.startsWith('git@') || state.fail)
          throw Object.assign(new Error(`clone failed ${url}`), { task: { commands: [url] } });
        await fs.mkdir(path.join(destination, '.git'), { recursive: true });
        await fs.writeFile(path.join(destination, '.git', 'config'), url);
        await fs.writeFile(path.join(destination, 'app.ts'), 'export const app = 1;');
        state.interrupt?.('clone');
      },
      revparse: async () => 'a'.repeat(40),
      show: async () => '2026-01-01T00:00:00Z',
      getRemotes: async () => {
        let url: string;
        try {
          url = await fs.readFile(config(), 'utf8');
        } catch {
          url = state.localOrigin;
        }
        return url ? [{ name: 'origin', refs: { fetch: url, push: url } }] : [];
      },
      raw: async (args: string[]) => {
        await fs.writeFile(config(), args.at(-1)!);
        return '';
      },
      fetch: async () => {
        state.fetched.push(await fs.readFile(config(), 'utf8'));
        state.interrupt?.('fetch');
      },
      checkout: async () => '',
    };
    return git;
  },
}));

const repo = 'https://x-access-token:SECRET123@github.com/acme/repo';
const schemaSource = path.resolve('test/fixtures/schema-repo');
const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
beforeEach(() => {
  state.clones = [];
  state.fetched = [];
  state.fail = false;
  state.localOrigin = '';
  state.interrupt = undefined;
});

async function readTree(root: string): Promise<string> {
  let result = '';
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    result += entry.isDirectory() ? await readTree(file) : await fs.readFile(file, 'utf8');
  }
  return result;
}

it('keeps credentials only in clone/authenticated preparation, never in artifacts or logs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'credential-build-'));
  const log = logger();
  const agent = {
    analyzeAndDraftDiagram: vi.fn().mockResolvedValue({
      yaml: CANONICAL_EXAMPLE_YAML,
      rawResponse: CANONICAL_EXAMPLE_YAML,
      threadId: 'mock',
      items: [],
      usage: null,
    }),
    repairDiagram: vi.fn(),
  };
  try {
    await buildDiagram(
      { repo, ref: 'main', schemaSource, out: path.join(root, 'diagram.yaml') },
      { agent, logger: log },
    );
    expect(state.clones).toEqual([repo]);
    expect(state.fetched).toEqual([repo]);
    expect(await readTree(root)).not.toContain('SECRET123');
    expect(
      JSON.stringify([log.info.mock.calls, log.error.mock.calls, log.warn.mock.calls]),
    ).not.toContain('SECRET123');
    expect(JSON.stringify(agent.analyzeAndDraftDiagram.mock.calls)).not.toContain('SECRET123');
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  }
});

it('reclones a checkout with reappeared git metadata and purges unsafe prior analysis', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'credential-resume-'));
  try {
    await prepareWorkspace({ repo, schemaSource, jobRoot: root });
    await fs.mkdir(path.join(root, 'out/analysis'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'out/analysis', 'repo-census.json'),
      JSON.stringify({ repoUrl: repo }),
    );
    await fs.mkdir(path.join(root, 'target-repo/.git'), { recursive: true });
    await fs.writeFile(path.join(root, 'target-repo/.git/config'), repo);
    state.clones = [];
    await prepareWorkspace({
      repo,
      schemaSource,
      jobRoot: root,
      resume: { expectedRepoRevision: 'a'.repeat(40) },
    });
    expect(state.clones).toEqual([repo]);
    await expect(fs.lstat(path.join(root, 'target-repo/.git'))).rejects.toThrow();
    await expect(fs.stat(path.join(root, 'out/analysis/repo-census.json'))).rejects.toThrow();
    expect(await readTree(root)).not.toContain('SECRET123');
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  }
});

it('strips local origin credentials from document identity without changing the source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'credential-local-'));
  state.localOrigin = repo;
  try {
    const context = await new DefaultRepositoryService().prepareRepositoryContext({
      repo: '/local/source',
      schemaSource,
      jobRoot: root,
    });
    expect(context.primaryDocumentInput.repo).toBe('https://github.com/acme/repo');
    expect(context.sourceRepository?.repo).toBe('https://github.com/acme/repo');
    expect(state.localOrigin).toBe(repo);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  }
});

it('throws sanitized aggregate failures and logs no clone credentials', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'credential-fail-'));
  const log = logger();
  state.fail = true;
  try {
    await expect(
      prepareWorkspace({ repo, schemaSource, jobRoot: root, logger: log }),
    ).rejects.toSatisfy((error: AggregateError) => {
      expect(error.message).not.toContain('SECRET123');
      expect(
        error.errors.every((entry) => !entry.message.includes('SECRET123') && !entry.task),
      ).toBe(true);
      return true;
    });
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('SECRET123');
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  }
});

it.each([
  'clone',
  'fetch',
])('removes a credential-bearing checkout when cancellation interrupts %s', async (stage) => {
  const { withCancellation } = await import('./cancellation');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'credential-abort-'));
  const controller = new AbortController();
  state.interrupt = (current) => {
    if (current !== stage) return;
    controller.abort(new Error('cancel preparation'));
    throw controller.signal.reason;
  };
  try {
    await expect(
      withCancellation(controller.signal, () =>
        prepareWorkspace({ repo, ref: 'main', schemaSource, jobRoot: root, logger: logger() }),
      ),
    ).rejects.toThrow('cancel preparation');
    await expect(fs.access(path.join(root, 'target-repo'))).rejects.toThrow();
    expect(await readTree(root)).not.toContain('SECRET123');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
