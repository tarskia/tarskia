import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import {
  DefaultGraphifyHintsBuilder,
  type GraphifyCommandRunner,
  type GraphifyHints,
  GraphifyHintsError,
} from './graphify-hints';

async function createWorkspace() {
  const jobRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'graphify-hints-test-'));
  const workspace = {
    jobRoot,
    targetRepoPath: path.join(jobRoot, 'target-repo'),
    schemaRepoPath: path.join(jobRoot, 'schema-repo'),
    workspaceOutputDir: path.join(jobRoot, 'out'),
    repoRevision: 'abc123',
  };
  await fs.mkdir(workspace.targetRepoPath, { recursive: true });
  await fs.mkdir(workspace.schemaRepoPath, { recursive: true });
  await fs.mkdir(workspace.workspaceOutputDir, { recursive: true });
  return workspace;
}

function quietLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function hintsArtifact(): GraphifyHints {
  return {
    version: 1,
    status: 'available',
    mode: 'code-only',
    generatedAt: '2026-01-01T00:00:00.000Z',
    graphifyPackage: 'graphifyy==0.6.7',
    corpus: {
      codeFiles: 2,
      nodes: 3,
      edges: 2,
      communities: 1,
      extractedEdges: 1,
      inferredEdges: 1,
      ambiguousEdges: 0,
    },
    centralNodes: [
      {
        id: 'src/app.ts::App',
        label: 'App',
        degree: 2,
        sourceFile: 'src/app.ts',
        sourceLocation: '1',
        community: 0,
      },
    ],
    communities: [],
    bridgeNodes: [],
    extractedRelations: [
      {
        sourceId: 'src/app.ts::App',
        sourceLabel: 'App',
        targetId: 'src/api.ts::Api',
        targetLabel: 'Api',
        relation: 'calls',
        confidence: 'EXTRACTED',
        sourceFile: 'src/app.ts',
        sourceLocation: '1',
      },
    ],
    inferredRelations: [
      {
        sourceId: 'src/app.ts::App',
        sourceLabel: 'App',
        targetId: 'src/store.ts::Store',
        targetLabel: 'Store',
        relation: 'similarity',
        confidence: 'INFERRED',
        confidenceScore: 0.73,
      },
    ],
    warnings: [],
    artifacts: {
      graphJson: 'analysis/graphify/graph.json',
      extractionJson: 'analysis/graphify/extraction.json',
      reportMarkdown: 'analysis/graphify/GRAPH_REPORT.md',
      summaryMarkdown: 'analysis/graphify-hints.md',
    },
    summaryMarkdown: '# Graphify Code-Structure Hints\n\n- App calls Api\n',
  };
}

async function writeGeneratedArtifacts(
  summaryJsonPath: string,
  summaryMarkdownPath: string,
  graphifyOutDir: string,
  value: unknown = hintsArtifact(),
) {
  await fs.mkdir(path.dirname(summaryJsonPath), { recursive: true });
  await fs.mkdir(graphifyOutDir, { recursive: true });
  await fs.writeFile(summaryJsonPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.writeFile(
    summaryMarkdownPath,
    '# Graphify Code-Structure Hints\n\n- App calls Api\n',
    'utf8',
  );
  await fs.writeFile(path.join(graphifyOutDir, 'graph.json'), '{}\n', 'utf8');
  await fs.writeFile(path.join(graphifyOutDir, 'extraction.json'), '{}\n', 'utf8');
  await fs.writeFile(path.join(graphifyOutDir, 'GRAPH_REPORT.md'), '# Report\n', 'utf8');
}

describe('DefaultGraphifyHintsBuilder', () => {
  it('skips in auto mode when uv is unavailable', async () => {
    const workspace = await createWorkspace();
    const logger = quietLogger();
    const commandRunner = {
      execFile: vi.fn().mockRejectedValue(new Error('uv not found')),
    } satisfies GraphifyCommandRunner;
    const builder = new DefaultGraphifyHintsBuilder({ commandRunner });

    const result = await builder.buildGraphifyHints({ workspace, mode: 'auto', logger });

    expect(result).toBeUndefined();
    expect(commandRunner.execFile).toHaveBeenCalledTimes(1);
    expect(commandRunner.execFile).toHaveBeenCalledWith(
      'uv',
      ['--version'],
      expect.objectContaining({ cwd: workspace.jobRoot }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Graphify hints skipped because the uv executable is unavailable'),
    );
    await expect(
      fs.readFile(
        path.join(workspace.workspaceOutputDir, 'analysis/graphify-hints.failure.json'),
        'utf8',
      ),
    ).resolves.toContain('"status": "skipped"');
  });

  it('fails in required mode when uv is unavailable', async () => {
    const workspace = await createWorkspace();
    const logger = quietLogger();
    const commandRunner = {
      execFile: vi.fn().mockRejectedValue(new Error('uv not found')),
    } satisfies GraphifyCommandRunner;
    const builder = new DefaultGraphifyHintsBuilder({ commandRunner });

    let thrown: unknown;
    try {
      await builder.buildGraphifyHints({ workspace, mode: 'required', logger });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GraphifyHintsError);
    expect((thrown as GraphifyHintsError).message).toContain('uv executable is unavailable');
    await expect(
      fs.readFile(
        path.join(workspace.workspaceOutputDir, 'analysis/graphify-hints.failure.json'),
        'utf8',
      ),
    ).resolves.toContain('"status": "skipped"');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('runs uv script mode and parses generated artifacts', async () => {
    const workspace = await createWorkspace();
    const logger = quietLogger();
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'should-not-be-forwarded';
    vi.stubEnv('UV_CONFIG_FILE', '/untrusted/uv.toml');
    vi.stubEnv('UV_INDEX_URL', 'https://untrusted.invalid/simple');
    vi.stubEnv('UV_ENV_FILE', '/untrusted/.env');
    vi.stubEnv('PYTHONPATH', '/untrusted/python');
    const commandRunner = {
      execFile: vi.fn().mockImplementation(async (_file: string, args: string[]) => {
        if (args[0] === '--version') {
          return { stdout: 'uv 1.0.0', stderr: '' };
        }
        const scriptPath = args[args.indexOf('--script') + 1];
        const graphifyOutDir = args[args.indexOf('--out-dir') + 1];
        const summaryJsonPath = args[args.indexOf('--summary-json') + 1];
        const summaryMarkdownPath = args[args.indexOf('--summary-md') + 1];
        const script = await fs.readFile(scriptPath, 'utf8');
        expect(script).toContain('requires-python = ">=3.10"');
        expect(script).toContain('"graphifyy==0.6.7"');
        expect(args.slice(0, args.indexOf('--script'))).toEqual([
          'run',
          '--no-config',
          '--isolated',
          '--locked',
          '--no-build',
        ]);
        const lock = await fs.readFile(`${scriptPath}.lock`, 'utf8');
        expect(lock).toBe(
          await fs.readFile(new URL('./build-graphify-hints.py.lock', import.meta.url), 'utf8'),
        );
        const packages = lock.split('[[package]]').slice(1);
        expect(packages.length).toBeGreaterThan(20);
        const packageNames = new Set(packages.map((entry) => entry.match(/name = "([^"]+)"/)?.[1]));
        for (const entry of packages) {
          expect(entry).toMatch(/version = "[0-9][^"]*"/);
          expect(entry).toContain('source = { registry = "https://pypi.org/simple" }');
          expect(entry).toMatch(/hash = "sha256:[a-f0-9]{64}"/);
          for (const dependency of entry.matchAll(/\{ name = "([^"]+)"/g))
            expect(packageNames.has(dependency[1])).toBe(true);
        }
        await writeGeneratedArtifacts(summaryJsonPath, summaryMarkdownPath, graphifyOutDir);
        return { stdout: '{"status":"available"}', stderr: 'graphify stderr' };
      }),
    } satisfies GraphifyCommandRunner;
    const builder = new DefaultGraphifyHintsBuilder({ commandRunner });

    try {
      const result = await builder.buildGraphifyHints({ workspace, mode: 'auto', logger });

      expect(result).toEqual(expect.objectContaining({ graphifyPackage: 'graphifyy==0.6.7' }));
      expect(result?.summaryMarkdown).toContain('App calls Api');
      expect(commandRunner.execFile).toHaveBeenCalledTimes(2);
      expect(commandRunner.execFile).toHaveBeenLastCalledWith(
        'uv',
        expect.arrayContaining([
          'run',
          '--no-config',
          '--isolated',
          '--locked',
          '--no-build',
          '--script',
        ]),
        expect.objectContaining({ cwd: workspace.jobRoot, timeout: 600_000 }),
      );
      for (const call of commandRunner.execFile.mock.calls) {
        expect(call[2].env?.OPENAI_API_KEY).toBeUndefined();
        for (const key of ['UV_CONFIG_FILE', 'UV_INDEX_URL', 'UV_ENV_FILE', 'PYTHONPATH'])
          expect(call[2].env?.[key]).toBeUndefined();
      }
      expect(logger.info).toHaveBeenCalledWith('Graphify hints stderr: graphify stderr');
    } finally {
      vi.unstubAllEnvs();
      if (previousOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiKey;
      }
    }
  });

  it('treats malformed generated summary output as a recoverable auto failure', async () => {
    const workspace = await createWorkspace();
    const logger = quietLogger();
    const commandRunner = {
      execFile: vi.fn().mockImplementation(async (_file: string, args: string[]) => {
        if (args[0] === '--version') {
          return { stdout: 'uv 1.0.0', stderr: '' };
        }
        await writeGeneratedArtifacts(
          args[args.indexOf('--summary-json') + 1],
          args[args.indexOf('--summary-md') + 1],
          args[args.indexOf('--out-dir') + 1],
          { version: 1, status: 'available', mode: 'code-only' },
        );
        return { stdout: '', stderr: '' };
      }),
    } satisfies GraphifyCommandRunner;
    const builder = new DefaultGraphifyHintsBuilder({ commandRunner });

    const result = await builder.buildGraphifyHints({ workspace, mode: 'auto', logger });

    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Graphify hints generation failed'),
    );
    const failure = await fs.readFile(
      path.join(workspace.workspaceOutputDir, 'analysis/graphify-hints.failure.json'),
      'utf8',
    );
    expect(failure).toContain('"status": "failed"');
    expect(failure).toContain('missing corpus statistics');
  });
});

it.each([
  'auto',
  'required',
] as const)('does not run unlocked when the shipped lock is missing in %s mode', async (mode) => {
  const workspace = await createWorkspace();
  const commandRunner = {
    execFile: vi.fn().mockResolvedValue({ stdout: 'uv 0.11.26', stderr: '' }),
  };
  const readFile = fs.readFile.bind(fs);
  const spy = vi.spyOn(fs, 'readFile').mockImplementation(((file, ...args) => {
    if (file instanceof URL && file.pathname.endsWith('.py.lock'))
      return Promise.reject(new Error('missing shipped lock'));
    return readFile(file, ...args);
  }) as typeof fs.readFile);
  try {
    const run = new DefaultGraphifyHintsBuilder({ commandRunner }).buildGraphifyHints({
      workspace,
      mode,
      logger: quietLogger(),
    });
    if (mode === 'required') await expect(run).rejects.toThrow('missing shipped lock');
    else await expect(run).resolves.toBeUndefined();
    expect(commandRunner.execFile).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

it
  .skipIf(process.env.TARSKIA_GRAPHIFY_INTEGRATION !== '1')
  .each(['uv.toml', 'pyproject.toml', 'user'] as const)(
  'runs locked static Graphify despite hostile %s configuration',
  async (config) => {
    const workspace = await createWorkspace();
    await fs.writeFile(
      path.join(workspace.targetRepoPath, 'app.py'),
      'def hello():\n    return "hello"\n\ndef run():\n    return hello()\n',
    );
    if (config === 'user') {
      const home = path.join(workspace.jobRoot, 'home');
      await fs.mkdir(path.join(home, '.config/uv'), { recursive: true });
      await fs.writeFile(path.join(home, '.config/uv/uv.toml'), 'index-url = [ invalid');
      vi.stubEnv('HOME', home);
    } else
      await fs.writeFile(
        path.join(workspace.jobRoot, config),
        config === 'uv.toml' ? 'index-url = [ invalid' : '[tool.uv]\nindex-url = [ invalid',
      );
    try {
      const result = await new DefaultGraphifyHintsBuilder().buildGraphifyHints({
        workspace,
        mode: 'required',
        logger: quietLogger(),
      });
      expect(result?.status).toBe('available');
      expect(result?.corpus.codeFiles).toBeGreaterThan(0);
      expect(result?.corpus.nodes).toBeGreaterThan(0);
      expect(
        await fs.readFile(
          path.join(workspace.workspaceOutputDir, 'analysis/graphify-hints.json'),
          'utf8',
        ),
      ).toContain('"available"');
    } finally {
      vi.unstubAllEnvs();
      await fs.rm(workspace.jobRoot, { recursive: true, force: true });
    }
  },
  120000,
);

it.skipIf(process.env.TARSKIA_GRAPHIFY_INTEGRATION !== '1')(
  'rejects stale script metadata instead of updating the lock',
  async () => {
    const workspace = await createWorkspace();
    const execute = promisify(execFile);
    const commandRunner: GraphifyCommandRunner = {
      async execFile(file, args, options) {
        if (args.includes('--script')) {
          const scriptPath = args[args.indexOf('--script') + 1];
          const script = await fs.readFile(scriptPath, 'utf8');
          await fs.writeFile(
            scriptPath,
            script.replace('"graphifyy==0.6.7"', '"graphifyy==0.6.6"'),
          );
        }
        return execute(file, args, options);
      },
    };
    try {
      await expect(
        new DefaultGraphifyHintsBuilder({ commandRunner }).buildGraphifyHints({
          workspace,
          mode: 'required',
          logger: quietLogger(),
        }),
      ).rejects.toThrow(/lockfile|lock file/);
      await expect(
        fs.access(path.join(workspace.workspaceOutputDir, 'analysis/graphify-hints.json')),
      ).rejects.toThrow();
      expect(
        await fs.readFile(
          path.join(workspace.workspaceOutputDir, 'analysis/graphify/build-graphify-hints.py.lock'),
          'utf8',
        ),
      ).toBe(await fs.readFile(new URL('./build-graphify-hints.py.lock', import.meta.url), 'utf8'));
    } finally {
      await fs.rm(workspace.jobRoot, { recursive: true, force: true });
    }
  },
  120000,
);

it.skipIf(process.env.TARSKIA_GRAPHIFY_INTEGRATION !== '1').each(['auto', 'required'] as const)(
  'fails closed without a compatible wheel in %s mode',
  async (mode) => {
    const workspace = await createWorkspace();
    const execute = promisify(execFile);
    const commandRunner: GraphifyCommandRunner = {
      async execFile(file, args, options) {
        const scriptIndex = args.indexOf('--script');
        const platformArgs =
          scriptIndex < 0
            ? args
            : [
                ...args.slice(0, scriptIndex),
                '--python-platform',
                'aarch64-unknown-linux-musl',
                ...args.slice(scriptIndex),
              ];
        return execute(file, platformArgs, options);
      },
    };
    try {
      const run = new DefaultGraphifyHintsBuilder({ commandRunner }).buildGraphifyHints({
        workspace,
        mode,
        logger: quietLogger(),
      });
      if (mode === 'required') await expect(run).rejects.toThrow('--no-build');
      else await expect(run).resolves.toBeUndefined();
      const failure = await fs.readFile(
        path.join(workspace.workspaceOutputDir, 'analysis/graphify-hints.failure.json'),
        'utf8',
      );
      expect(failure).toContain('--no-build');
      expect(failure).toContain('no binary distribution');
    } finally {
      await fs.rm(workspace.jobRoot, { recursive: true, force: true });
    }
  },
  120000,
);
