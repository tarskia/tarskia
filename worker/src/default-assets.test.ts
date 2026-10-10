import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { simpleGit } from 'simple-git';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { version } from '../package.json';
import { loadDiagramMetaOntology } from './codex/meta-ontology';
import { resolveDefaultSchemaSource } from './default-assets';

const exec = promisify(execFile);
let root: string;
let bundled: string;
let modulePath: string;
let hostile: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'tarskia-assets-'));
  const packageRoot = path.join(root, 'node_modules/worker');
  bundled = path.join(packageRoot, 'assets/schemas');
  modulePath = path.join(packageRoot, 'dist/assets.mjs');
  hostile = path.join(root, 'hostile');
  for (const directory of [bundled, path.dirname(modulePath), hostile])
    await fs.mkdir(directory, { recursive: true });
  // Bundle the actual loaders exactly as the CLI does, into an installed-package layout.
  await build({
    stdin: {
      contents: "export * from './src/default-assets'; export * from './src/codex/meta-ontology';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: modulePath,
  });
  for (const relative of ['assets/schemas', 'worker/assets/schemas']) {
    await fs.mkdir(path.join(hostile, relative), { recursive: true });
    await fs.writeFile(path.join(hostile, relative, 'evil.yaml'), 'untrusted: true');
  }
  for (const relative of ['src/codex', 'worker/src/codex']) {
    await fs.mkdir(path.join(hostile, relative), { recursive: true });
    await fs.writeFile(path.join(hostile, relative, 'diagram-meta-ontology.md'), 'UNTRUSTED');
  }
});
afterAll(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});
async function call(expression: string) {
  return exec(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import * as assets from ${JSON.stringify(pathToFileURL(modulePath).href)}; ${expression}`,
    ],
    { cwd: hostile },
  );
}

describe('bundled asset boundary', () => {
  it('loads the source layout independently of cwd', () => {
    expect(resolveDefaultSchemaSource()).toBe(path.resolve('assets/schemas'));
    expect(loadDiagramMetaOntology()).toContain('diagram');
  });
  it('uses packaged assets, and fails closed when either is missing despite both cwd fallbacks', async () => {
    const ontology = path.join(path.dirname(modulePath), 'diagram-meta-ontology.md');
    await fs.writeFile(ontology, 'TRUSTED');
    expect(
      (
        await call(
          'console.log(assets.resolveDefaultSchemaSource()); console.log(assets.loadDiagramMetaOntology());',
        )
      ).stdout,
    ).toBe(`${await fs.realpath(bundled)}\nTRUSTED\n`);
    await fs.rename(bundled, `${bundled}.saved`);
    await expect(call('assets.resolveDefaultSchemaSource()')).rejects.toThrow(
      'Unable to locate bundled schema assets',
    );
    await fs.rename(`${bundled}.saved`, bundled);
    await fs.rm(ontology);
    await expect(call('assets.loadDiagramMetaOntology()')).rejects.toThrow(
      'Unable to load bundled diagram meta-ontology',
    );
  });
  it('fingerprints package bytes and names independently of enclosing Git HEAD', async () => {
    await fs.writeFile(path.join(bundled, 'base.yaml'), 'owner: core\nname: base\n');
    const git = simpleGit(root);
    await git.init();
    await git.addConfig('user.name', 'Test');
    await git.addConfig('user.email', 'test@example.com');
    await fs.writeFile(path.join(root, 'tracked'), 'one');
    await git.add('tracked');
    await git.commit('one');
    const revision = async (source = bundled) =>
      (
        await call(
          `console.log(await assets.resolveBundledSchemaRevision(${JSON.stringify(source)}));`,
        )
      ).stdout.trim();
    const initial = await revision();
    expect(initial).toMatch(/^bundled@.+\+[a-f0-9]{12}$/);
    expect(initial.startsWith(`bundled@${version}+`)).toBe(true);
    await fs.writeFile(path.join(root, 'tracked'), 'two');
    await git.add('tracked');
    await git.commit('two');
    expect(await revision()).toBe(initial);
    await fs.symlink(bundled, path.join(root, 'alias'));
    expect(await revision(path.join(root, 'alias'))).toBe(initial);
    expect(await revision(hostile)).toBe('undefined');
    await fs.writeFile(path.join(bundled, 'base.yaml'), 'owner: core\nname: changed\n');
    const changed = await revision();
    expect(changed).not.toBe(initial);
    await fs.rename(path.join(bundled, 'base.yaml'), path.join(bundled, 'renamed.yaml'));
    expect(await revision()).not.toBe(changed);
    const target = path.join(root, 'linked.yaml');
    await fs.writeFile(target, 'first');
    await fs.symlink(target, path.join(bundled, 'linked.yaml'));
    const linked = await revision();
    await fs.writeFile(target, 'second');
    expect(await revision()).not.toBe(linked);
  });
});
