import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { version } from '../package.json';
import { resolveDefaultSchemaSource } from './default-assets';
import { createInitialJobMetadata, writeJobMetadata } from './job-metadata';
import { schemaRepoFixture } from './schema-repo-fixture';

const exec = promisify(execFile);
const cli = path.resolve('dist/cli.js');
let tmp: string;
let probePreload: string;
async function run(
  args: string[],
  debug = false,
  missing: 'codex' | 'uv' | '' = '',
  codexYaml = '',
  platform = process.platform,
) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: tmp,
      env: {
        ...process.env,
        TARSKIA_DEBUG: debug ? '1' : '',
        NODE_OPTIONS: `--import=${probePreload}`,
        TARSKIA_TEST_MISSING: missing,
        TARSKIA_TEST_PLATFORM: platform,
        TARSKIA_TEST_CODEX_YAML: codexYaml,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tarskia-cli-'));
  probePreload = path.join(tmp, 'probe-preload.mjs');
  await fs.writeFile(
    probePreload,
    `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    Object.defineProperty(process, 'platform', { value: process.env.TARSKIA_TEST_PLATFORM || process.platform });
    const original = childProcess.execFile;
    childProcess.execFile = function(file, args, options, callback) {
      const codex = args?.includes('login') && args?.includes('status');
      const uv = file === 'uv' && args?.includes('--version');
      if (!codex && !uv) return original.call(this, file, args, options, callback);
      const missing = process.env.TARSKIA_TEST_MISSING === (codex ? 'codex' : 'uv');
      queueMicrotask(() => callback(missing ? new Error('not available') : null, '', ''));
    };
    const originalSpawn = childProcess.spawn;
    childProcess.spawn = function(file, args, options) {
      const fixture = process.env.TARSKIA_TEST_CODEX_YAML;
      if (!fixture || args?.[0] !== 'exec') return originalSpawn.call(this, file, args, options);
      const program = [
        "const fs = require('node:fs');",
        'const fixture = ' + JSON.stringify(fixture) + ';',
        "process.stdin.resume(); process.stdin.on('end', () => {",
        "fs.appendFileSync(fixture + '.calls', 'call;');",
        "const events = [{type:'thread.started',thread_id:'fake-cli-thread'},",
        "{type:'item.completed',item:{id:'message',type:'agent_message',text:fs.readFileSync(fixture,'utf8')}},",
        "{type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}}];",
        "for (const event of events) console.log(JSON.stringify(event)); });",
      ].join(' ');
      return originalSpawn.call(this, process.execPath, ['-e', program], options);
    };
    syncBuiltinESMExports();
  `,
  );
  await exec('npm', ['run', 'build'], { cwd: process.cwd(), maxBuffer: 8 * 1024 * 1024 });
  await fs.writeFile(path.join(tmp, 'empty.yaml'), '');
  await fs.writeFile(path.join(tmp, 'broken.yaml'), 'schemaRefs: [\n');
}, 60000);
afterAll(async () => {
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
});

describe('built CLI streams and errors', () => {
  it('prints the package version', async () => {
    expect(await run(['--version'])).toEqual({ code: 0, stdout: `${version}\n`, stderr: '' });
  });
  it.each([
    ['build', 'tarskia build', 'tarskia validate'],
    ['validate', 'tarskia validate', 'tarskia build'],
    ['check', 'tarskia check', 'tarskia build'],
  ])('prints only %s help', async (command, expected, absent) => {
    const result = await run([command, '--help']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(expected);
    expect(result.stdout).not.toContain(absent);
    if (command === 'build') {
      expect(result.stdout).toContain('--repo');
      expect(result.stdout).toContain('bundle-compile');
      expect(result.stdout).toContain('level0-review');
      expect(result.stdout).not.toContain('simple');
    }
  });
  it.each([
    [['build', '.', '--outt', 'x.yaml'], "unknown option '--outt'"],
    [
      ['build', '.', '--out', 'x.yaml', '--reasoning-effort', 'huge'],
      "invalid --reasoning-effort 'huge' (expected minimal, low, medium, high, xhigh, max, ultra or persistent)",
    ],
    [
      ['validate', 'empty.yaml', '--kind', 'weird'],
      "invalid --kind 'weird' (expected auto, diagram, schema or schema-registry)",
    ],
    [['validate', 'nope.yaml'], 'file not found: nope.yaml'],
    [
      ['build', '.', '--out', 'x.yaml', '--fresh', '--restart-from', 'final-review'],
      '--fresh cannot be combined with --restart-from',
    ],
    [
      ['build', '.', '--out', 'x.yaml', '--restart-from', 'level0-review'],
      '--restart-from needs an existing advanced job for this repo and output; none was found.',
    ],
    [
      ['build', '.', '--out', 'missing-job.yaml', '--restart-from', 'final-review'],
      '--restart-from needs an existing advanced job for this repo and output; none was found.',
    ],
    [
      ['build', '.', '--out', 'x.yaml', '--max-depth', '2abc'],
      "invalid --max-depth '2abc' (expected a positive integer)",
    ],
    [
      ['build', '.', '--out', 'x.yaml', '--restart-from', 'later'],
      "invalid --restart-from 'later'",
    ],
    [['build', '.', '--out', 'x.yaml', '--stop-after', 'later'], "invalid --stop-after 'later'"],
    [
      ['build', '.', '--out', 'x.yaml', '--graphify-hints', 'sometimes'],
      "invalid --graphify-hints 'sometimes'",
    ],
  ] as const)('reports usage/config errors: %j', async (args, message) => {
    const result = await run([...args]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`tarskia: ${message}`);
    expect(result.stderr).toContain(`Run 'tarskia ${args[0]} --help' for usage.`);
    expect(result.stderr).not.toContain('    at ');
  });
  it('emits exactly one JSON object even on parseArgs or runtime errors', async () => {
    for (const args of [
      ['validate', 'nope.yaml', '--json'],
      ['validate', '--outt', 'x', '--json'],
    ]) {
      const result = await run(args);
      expect(result.code).toBe(2);
      expect(JSON.parse(result.stdout)).toEqual({
        ok: false,
        error: { message: expect.any(String) },
      });
      expect(result.stderr).toContain('tarskia:');
    }
  });
  it.each([
    'empty.yaml',
    'broken.yaml',
  ])('returns validation failure consistently for %s', async (file) => {
    for (const kind of ['auto', 'diagram']) {
      const result = await run(['validate', file, '--kind', kind, '--json']);
      expect(result.code).toBe(1);
      expect(result.stderr).toBe('');
      const parsed = JSON.parse(result.stdout);
      expect(parsed.ok).toBe(false);
      expect(parsed.diagnostics.length).toBeGreaterThan(0);
    }
  });
  it('reports malformed registry files as diagnostics', async () => {
    await fs.mkdir(path.join(tmp, 'registry'));
    await fs.writeFile(path.join(tmp, 'registry/broken.yaml'), 'owner: [\n');
    const result = await run(['validate', 'registry', '--kind', 'schema-registry', '--json']);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      kind: 'schema-registry',
      diagnostics: [
        expect.objectContaining({
          severity: 'error',
          path: expect.stringContaining('broken.yaml'),
        }),
      ],
    });
  });
  it('drains more than 64KB of diagnostics through a pipe', async () => {
    const entities = Array.from({ length: 1800 }, (_, index) => ({
      id: `entity-${index}`,
      type: 'missing.types.unknown',
    }));
    await fs.writeFile(
      path.join(tmp, 'large.yaml'),
      JSON.stringify({
        version: '0.1.0',
        schemaRefs: [{ schema: 'core/web-app@0.3', layer: 0 }],
        entities,
        relations: [],
      }),
    );
    const result = await run(['validate', 'large.yaml', '--json']);
    expect(result.code).toBe(1);
    expect(Buffer.byteLength(result.stdout)).toBeGreaterThan(65536);
    expect(JSON.parse(result.stdout).diagnostics.length).toBeGreaterThanOrEqual(1800);
    expect(result.stderr).toBe('');
  });
  it('only prints a stack in debug mode', async () => {
    const result = await run(['validate', 'nope.yaml'], true);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('    at ');
  });
  it('accepts --repo while keeping runtime build logs off stdout', async () => {
    const result = await run([
      'build',
      '--repo',
      path.join(tmp, 'nonexistent-repository'),
      '--out',
      path.join(tmp, 'advanced.yaml'),
      '--graphify-hints',
      'off',
    ]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('[INFO]');
    expect(result.stderr).not.toContain('    at ');
  });
});

it('rejects a non-repo generated schema id as a usage/configuration error', async () => {
  const result = await run([
    'build',
    '.',
    '--out',
    'diagram.yaml',
    '--schema-out',
    'schema.yaml',
    '--schema-id',
    'core/web-app',
    '--json',
  ]);
  expect(result.code).toBe(2);
  expect(JSON.parse(result.stdout)).toMatchObject({
    ok: false,
    error: { message: expect.stringContaining('expected repo/<name>') },
  });
  expect(result.stderr).toContain('tarskia: Invalid schema id');
});

it('CLI preflight fails before workspace preparation when not signed in', async () => {
  const result = await run(
    ['build', '.', '--out', path.join(tmp, 'preflight.yaml')],
    false,
    'codex',
  );
  expect(result.code).toBe(2);
  expect(result.stderr).toContain(
    "tarskia: Codex isn't signed in. Run 'codex login' and try again.",
  );
  expect(result.stderr).not.toContain('[INFO]');
  await expect(fs.access(path.join(tmp, 'preflight.yaml.job'))).rejects.toThrow();
});
it('CLI required Graphify fails before cloning when uv is unavailable', async () => {
  const result = await run(
    ['build', '.', '--out', path.join(tmp, 'uv.yaml'), '--graphify-hints', 'required'],
    false,
    'uv',
  );
  expect(result.code).toBe(2);
  expect(result.stderr).toContain(
    'tarskia: --graphify-hints required needs uv (https://docs.astral.sh/uv/).',
  );
  expect(result.stderr).not.toContain('[INFO]');
});
it('check prints WARN for missing optional uv without failing the command', async () => {
  const result = await run(['check'], false, 'uv');
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('OK Codex:');
  expect(result.stdout).toContain('WARN uv:');
});

it('rejects a generated schema source collision before workspace preparation', async () => {
  const source = path.join(tmp, 'schema-collision-source');
  await fs.cp(resolveDefaultSchemaSource(), source, { recursive: true });
  const schemaFile = path.join(source, 'existing.yaml');
  const original = 'owner: repo\nname: existing\nversion: "0.1"\ntypes: []\nrelations: []\n';
  await fs.writeFile(schemaFile, original);
  const out = path.join(tmp, 'schema-collision-diagram.yaml');
  const result = await run([
    'build',
    '.',
    '--out',
    out,
    '--schema-out',
    path.join(tmp, 'generated.yaml'),
    '--schema-id',
    'repo/existing',
    '--schema-source',
    source,
    '--json',
  ]);
  expect(result.code).toBe(2);
  expect(JSON.parse(result.stdout)).toMatchObject({
    ok: false,
    error: {
      message: `schema id repo/existing already exists in ${source}; pass a different --schema-id.`,
    },
  });
  expect(result.stderr).not.toContain('[INFO]');
  await expect(fs.access(`${out}.job`)).rejects.toThrow();
  expect(await fs.readFile(schemaFile, 'utf8')).toBe(original);
});

it('rejects ambiguous directories as usage/config errors without corrupting JSON stdout', async () => {
  await fs.mkdir(path.join(tmp, 'ordinary'));
  await fs.writeFile(path.join(tmp, 'ordinary/docker-compose.yaml'), 'services: {}\n');
  const result = await run(['validate', 'ordinary', '--json']);
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('tarskia:');
  expect(result.stderr).not.toContain('    at ');
  expect(JSON.parse(result.stdout)).toMatchObject({
    ok: false,
    error: { message: expect.stringContaining("can't tell what") },
  });
  expect(JSON.parse(result.stdout).error.message).toContain('pass --kind');
});

it('rejects duplicate --schema IDs with both paths and exit 2', async () => {
  const bundled = path.join(resolveDefaultSchemaSource(), 'web-app.yaml');
  const duplicate = path.join(tmp, 'duplicate-web-app.yaml');
  await fs.copyFile(bundled, duplicate);
  const result = await run(['validate', 'empty.yaml', '--schema', duplicate, '--json']);
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('tarskia:');
  expect(result.stderr).not.toContain('    at ');
  const message = JSON.parse(result.stdout).error.message;
  expect(message).toContain('duplicate schema id core/web-app');
  expect(message).toContain(path.resolve('dist/schemas/web-app.yaml'));
  expect(message).toContain(duplicate);
});

it('reports a missing pinned diagram schema once with exit 1 and JSON diagnostics', async () => {
  await fs.writeFile(
    path.join(tmp, 'wrong-version.yaml'),
    'version: 0.1.0\nschemaRefs:\n  - schema: core/web-app@99.0\n    layer: 0\nentities: []\nrelations: []\n',
  );
  const result = await run(['validate', 'wrong-version.yaml', '--json']);
  expect(result).toMatchObject({ code: 1, stderr: '' });
  expect(JSON.parse(result.stdout)).toMatchObject({
    ok: false,
    diagnostics: [
      expect.objectContaining({
        code: 'schema.resolution.missing_dependency',
        message: expect.stringContaining('core/web-app@99.0'),
      }),
    ],
  });
});

it.each([
  ['SIGINT', 130],
  ['SIGTERM', 143],
] as const)('returns %s cancellation status and stops an active probe process', async (signal, expectedCode) => {
  const ready = path.join(tmp, `signal-${signal}.pid`);
  const preload = path.join(tmp, `signal-${signal}.mjs`);
  await fs.writeFile(
    preload,
    `
    import cp from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const original = cp.execFile;
    cp.execFile = function(file, args, options, callback) {
      if (args?.includes('login')) return original(process.execPath, ['-e', ${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(()=>{},1000);`)}], options, callback);
      return original(file, args, options, callback);
    };
    syncBuiltinESMExports();
  `,
  );
  const child = spawn(
    process.execPath,
    [cli, 'build', '.', '--out', path.join(tmp, `${signal}.yaml`), '--json'],
    {
      cwd: tmp,
      env: { ...process.env, NODE_OPTIONS: `--import=${preload}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const closed = new Promise<number | null>((resolve, reject) => {
    child.on('close', resolve);
    child.on('error', reject);
  });
  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  try {
    await expect.poll(async () => fs.readFile(ready, 'utf8').catch(() => '')).not.toBe('');
    const pid = Number(await fs.readFile(ready, 'utf8'));
    child.kill(signal);
    expect(await closed).toBe(expectedCode);
    expect(stderr).toContain(`Build interrupted by ${signal}`);
    expect(JSON.parse(stdout)).toEqual({
      ok: false,
      error: { message: `Build interrupted by ${signal}` },
      secrets: { maskedInRepo: 0, files: [], redactedFromOutput: 0 },
    });
    await expect
      .poll(() => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
    await expect(fs.access(path.join(tmp, `${signal}.yaml.job`))).rejects.toThrow();
  } finally {
    child.kill('SIGKILL');
  }
});

it.each([
  'auto',
  'diagram',
])('rejects YAML alias expansion with exit 1 in %s mode', async (kind) => {
  const target = path.join(tmp, `alias-${kind}.yaml`);
  await fs.writeFile(target, 'schemaRefs: []\nmetadata: {a: &a [1], b: &b [*a, *a], c: [*b, *b]}');
  const startedAt = performance.now();
  const result = await run(['validate', target, '--kind', kind, '--json']);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout).diagnostics).toContainEqual(
    expect.objectContaining({ code: 'diagram.parse.alias_not_allowed' }),
  );
  expect(performance.now() - startedAt).toBeLessThan(1000);
});

it('reports files over 50 MiB as validation failures', async () => {
  const target = path.join(tmp, 'oversized.yaml');
  await fs.writeFile(target, '#'.repeat(51 * 1024 * 1024));
  const result = await run(['validate', target, '--json']);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout).diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'diagram.parse.too_large',
      message: 'Input is 51 MB; the limit is 50 MB.',
    }),
  );
});

it('separates output replacement from fresh builds and permits restarting a successful job', async () => {
  const out = path.join(tmp, 'existing.yaml');
  const schemaSource = path.join(tmp, 'schemas');
  await fs.mkdir(schemaSource, { recursive: true });
  await fs.writeFile(out, 'keep original');
  const metadata = createInitialJobMetadata({
    repo: '.',
    schemaSource,
    outputPath: out,
    workspaceRoot: `${out}.job`,
  });
  metadata.status = 'succeeded';
  await writeJobMetadata(`${out}.job`, metadata);
  const args = ['build', '.', '--out', out, '--schema-source', schemaSource];
  const fresh = await run([...args, '--fresh'], false, 'codex');
  expect(fresh.code).toBe(2);
  expect(fresh.stderr).toContain('Refusing to overwrite');
  for (const flags of [
    ['--overwrite'],
    ['--restart-from', 'final-review'],
    ['--fresh', '--overwrite'],
  ]) {
    const result = await run([...args, ...flags], false, 'codex');
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Codex');
    expect(result.stderr).not.toContain('Refusing to overwrite');
  }
  expect(await fs.readFile(out, 'utf8')).toBe('keep original');
});

it('documents the optional build allowance and effort-scaled timeout', async () => {
  const result = await run(['build', '--help']);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('--max-turns');
  expect(result.stdout).toContain('--turn-timeout');
  expect(result.stdout).toContain('0 disables');
});
it.each([
  ['--max-turns', '0'],
  ['--max-turns', '1.5'],
  ['--turn-timeout', '-1'],
  ['--turn-timeout', 'Infinity'],
])('rejects invalid %s %s before any build', async (flag, value) => {
  const result = await run(['build', '/missing-repo', '--out', 'budget.yaml', `${flag}=${value}`]);
  expect(result.code).toBe(2);
  expect(result.stderr).toContain(`invalid ${flag}`);
});

it('built CLI exits zero on budget exhaustion and resumes the advanced pipeline with the same limit', async () => {
  const repo = path.join(tmp, 'budget-repo');
  await fs.mkdir(path.join(repo, 'src'), { recursive: true });
  await fs.writeFile(path.join(repo, 'src/index.ts'), 'export const app = true;');
  const secret = ['ghp', randomBytes(18).toString('hex')].join('_');
  await fs.writeFile(path.join(repo, '.env'), secret);
  for (let index = 0; index < 10; index++)
    await fs.writeFile(path.join(repo, `.env-${index}`), secret);
  for (const args of [
    ['init'],
    ['config', 'user.name', 'CLI Test'],
    ['config', 'user.email', 'test@example.com'],
    ['add', '.'],
    ['commit', '-m', 'fixture'],
  ])
    await exec('git', args, { cwd: repo });
  const yaml = path.join(tmp, 'sdk-output.yaml');
  const plan = JSON.stringify({
    repoSummary: 'Fixture app',
    galleryDescription: 'Fixture app',
    initialSchemaActivations: [{ schema: 'core/web-app@0.3', layer: 0 }],
    candidateSchemaRefs: [],
    keyConcepts: [
      {
        id: 'app',
        kind: 'service',
        title: 'App',
        paths: ['src/index.ts'],
        rationale: 'Runtime app',
        evidence: [{ path: 'src/index.ts', reason: 'Runtime entry' }],
        groupingHints: [],
        openQuestions: [],
      },
    ],
  });
  await fs.writeFile(yaml, plan);
  const out = path.join(tmp, 'budget-diagram.yaml');
  const partial = path.join(tmp, 'budget-diagram.partial.yaml');
  const args = [
    'build',
    repo,
    '--out',
    out,
    '--schema-source',
    schemaRepoFixture(),
    '--max-turns',
    '1',
    '--graphify-hints',
    'off',
    '--json',
  ];
  const first = await run(args, false, '', yaml);
  expect(first.code, first.stderr).toBe(0);
  expect(first.stderr).toContain(
    'Stopped after 1 turns (--max-turns). Run the same command again to continue.',
  );
  expect(JSON.parse(first.stdout)).toMatchObject({
    outputPath: partial,
    secrets: {
      maskedInRepo: 11,
      files: expect.arrayContaining([{ path: '.env', rules: ['github'] }]),
      redactedFromOutput: 0,
    },
  });
  expect(first.stderr.trim()).toMatch(/Consider rotating them\.$/);
  expect(first.stderr).not.toContain(secret);
  const firstAlert = first.stderr.slice(first.stderr.lastIndexOf('Warning: found'));
  expect(firstAlert).toContain('and 1 more');
  expect(firstAlert).not.toContain('.env-9');
  expect(JSON.parse(first.stdout).secrets.files).toHaveLength(11);
  expect(await fs.readFile(partial, 'utf8')).toContain('schemaRefs:');
  await expect(fs.stat(out)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(
    JSON.parse(await fs.readFile(path.join(out + '.job', 'out/job-metadata.json'), 'utf8')).status,
  ).toBe('budget-exhausted');
  expect(await fs.readFile(yaml + '.calls', 'utf8')).toBe('call;');
  await fs.writeFile(
    yaml,
    `version: 0.1.0
schemaRefs:
  - schema: core/web-app@0.3
    layer: 0
entities:
  - id: browser-client
    type: core/web-app.types.external-api
    name: Browser Client
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: app
    type: core/web-app.types.application
    name: Application
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: backend
    type: core/web-app.types.external-api
    name: Backend
    provenance:
      locations:
        - input: primary
          path: src/index.ts
relations:
  - id: browser-calls-app
    type: core/software.relations.calls
    from: browser-client
    to: app
    provenance:
      locations:
        - input: primary
          path: src/index.ts
  - id: app-calls-backend
    type: core/software.relations.calls
    from: app
    to: backend
    provenance:
      locations:
        - input: primary
          path: src/index.ts
`,
  );
  const second = await run(args, false, '', yaml);
  expect(second.code, second.stderr).toBe(0);
  expect(JSON.parse(second.stdout)).toMatchObject({
    outputPath: partial,
    secrets: {
      maskedInRepo: 11,
      files: expect.arrayContaining([{ path: '.env', rules: ['github'] }]),
      redactedFromOutput: 0,
    },
  });
  expect(second.stderr.trim()).toMatch(/Consider rotating them\.$/);
  expect(second.stderr).not.toContain(secret);
  expect(await fs.readFile(yaml + '.calls', 'utf8')).toBe('call;call;');
  const resumedMetadata = JSON.parse(
    await fs.readFile(path.join(`${out}.job`, 'out/job-metadata.json'), 'utf8'),
  );
  expect(resumedMetadata.advanced.lastCompletedStage, second.stderr).toBe('level0-backbone');
  await expect(fs.stat(out)).rejects.toMatchObject({ code: 'ENOENT' });
  await fs.writeFile(yaml, 'not a plan');
  const failureArgs = args.filter(
    (value, index) => value !== '--max-turns' && args[index - 1] !== '--max-turns',
  );
  const failed = await run([...failureArgs, '--fresh', '--overwrite'], false, '', yaml);
  // Exhausted malformed planner responses are a configuration/runtime error.
  expect(failed.code, failed.stderr).toBe(2);
  expect(JSON.parse(failed.stdout)).toMatchObject({
    ok: false,
    secrets: {
      maskedInRepo: 11,
      files: expect.arrayContaining([{ path: '.env', rules: ['github'] }]),
      redactedFromOutput: 0,
    },
  });
  expect(failed.stderr.trim()).toMatch(/Consider rotating them\.$/);
  expect(failed.stderr).not.toContain(secret);
  for (const filename of await fs.readdir(repo))
    if (filename.startsWith('.env')) await fs.writeFile(path.join(repo, filename), 'safe');
  await exec('git', ['add', '.'], { cwd: repo });
  await exec('git', ['commit', '-m', 'remove planted fixture keys'], { cwd: repo });
  await fs.writeFile(yaml, plan);
  const clean = await run([...args, '--fresh', '--overwrite'], false, '', yaml);
  expect(clean.code, clean.stderr).toBe(0);
  expect(JSON.parse(clean.stdout).secrets).toEqual({
    maskedInRepo: 0,
    files: [],
    redactedFromOutput: 0,
  });
  expect(clean.stderr).not.toContain('Warning: found');
  expect(clean.stderr).not.toContain('Consider rotating');
}, 30000);

it('rejects Windows builds before argument validation or setup and reports platform in check', async () => {
  const message = "Windows isn't supported yet. Run tarskia in WSL (Windows Subsystem for Linux).";
  const result = await run(['build'], false, 'codex', '', 'win32');
  expect(result.code).toBe(2);
  expect(result.stderr).toBe(`tarskia: ${message}\nRun 'tarskia build --help' for usage.\n`);
  const check = await run(['check', '--json'], false, '', '', 'win32');
  expect(check.code).toBe(2);
  expect(JSON.parse(check.stdout).checks).toContainEqual({
    name: 'platform',
    ok: false,
    detail: message,
  });
  const supported = await run(['check', '--json']);
  expect(JSON.parse(supported.stdout).checks).toContainEqual({
    name: 'platform',
    ok: true,
    detail: process.platform,
  });
});

it('versions valid and invalid validate JSON documents', async () => {
  await fs.writeFile(
    path.join(tmp, 'valid-versioned.yaml'),
    'schemaRefs: [{schema: core/base@0.1, layer: 0}]\nentities: []\nrelations: []\n',
  );
  for (const [file, code, ok] of [
    ['valid-versioned.yaml', 0, true],
    ['broken.yaml', 1, false],
  ] as const) {
    const result = await run(['validate', file, '--json']);
    expect(result.code).toBe(code);
    const output = JSON.parse(result.stdout);
    expect(Object.keys(output)[0]).toBe('version');
    expect(output).toMatchObject({
      version: 1,
      ok,
      kind: 'diagram',
      path: path.join(await fs.realpath(tmp), file),
    });
    if (!ok)
      expect(output.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'semantic.parse.invalid_yaml' }),
      );
  }
});

it('rejects the retired strict validation option as an unknown option', async () => {
  // Construct the retired flag so repository scans distinguish it from supported CLI options.
  const retiredFlag = ['--', 'strict'].join('');
  const result = await run(['validate', 'empty.yaml', retiredFlag]);
  expect(result.code).toBe(2);
  expect(result.stderr).toContain(`unknown option '${retiredFlag}'`);
  expect((await run(['validate', '--help'])).stdout).not.toContain(retiredFlag);
});

it('rejects the retired build mode option with an unknown-option usage error', async () => {
  // Build the retired flag separately so supported-option scans remain useful.
  const retiredFlag = ['--', 'mode'].join('');
  const result = await run(['build', '.', '--out', 'x.yaml', retiredFlag, 'advanced']);
  expect(result.code).toBe(2);
  expect(result.stderr).toContain(`unknown option '${retiredFlag}'`);
  expect((await run(['build', '--help'])).stdout).not.toContain(`${retiredFlag} `);
});
