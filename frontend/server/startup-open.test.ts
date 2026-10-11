import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readStartupOpen, startupOpenHandler, startupOpenPlugin } from './startup-open';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'tarskia-open-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
async function write(relative: string, raw = 'diagram') {
  const filename = path.join(root, relative);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, raw);
}
describe('startup diagrams', () => {
  it('lists only selected files from two repositories', async () => {
    await write('one/.tarskia/one.yaml');
    await write('one/.tarskia/one.schema.yaml');
    await write('two/.tarskia/two.yaml');
    await write('one/secret.txt');
    await write('node_modules/.tarskia/dependency.yaml');
    await write('one/.tarskia/.job/output.yaml');
    await write('one/deep/.tarskia/hidden.yaml');
    const result = await readStartupOpen(root);
    expect(result.kind).toBe('folder');
    expect(result.files.map((file) => file.path).sort()).toEqual([
      'one/.tarskia/one.schema.yaml',
      'one/.tarskia/one.yaml',
      'two/.tarskia/two.yaml',
    ]);
  });
  it('does not follow symlinks out of selected directories', async () => {
    await write('one/.tarskia/one.yaml');
    await write('secret.txt');
    await fs.symlink(path.join(root, 'secret.txt'), path.join(root, 'one/.tarskia/secret.yaml'));
    expect((await readStartupOpen(root)).files.map((file) => file.path)).toEqual([
      'one/.tarskia/one.yaml',
    ]);
  });
  it('opens one diagram with its adjacent schemas', async () => {
    await write('diagram.yaml');
    await write('custom.schema.yaml', 'schema');
    await write('unrelated.yaml');
    expect(await readStartupOpen(path.join(root, 'diagram.yaml'))).toEqual({
      name: 'diagram.yaml',
      kind: 'file',
      files: [
        { path: 'diagram.yaml', raw: 'diagram' },
        { path: 'custom.schema.yaml', raw: 'schema' },
      ],
    });
  });
  it('reads changed files again', async () => {
    await write('.tarskia/root.yaml', 'before');
    expect((await readStartupOpen(root)).files[0].raw).toBe('before');
    await write('.tarskia/root.yaml', 'after');
    expect((await readStartupOpen(root)).files[0].raw).toBe('after');
  });
  it('fails startup clearly for a missing path', async () => {
    const missing = path.join(root, 'missing');
    const hook = startupOpenPlugin(missing).configureServer;
    expect(typeof hook).toBe('function');
    await expect((hook as (server: unknown) => Promise<void>)({})).rejects.toThrow(
      `TARSKIA_OPEN points at \`${missing}\`, which doesn't exist.`,
    );
  });
});

it('serves fresh JSON on GET and leaves other requests alone', async () => {
  await write('diagram.yaml', 'first');
  const handler = startupOpenHandler(path.join(root, 'diagram.yaml'));
  const request = async () => {
    const headers: Record<string, string> = {};
    const body = await new Promise<string>((resolve, reject) => {
      handler(
        { method: 'GET', url: '/__tarskia/open' } as IncomingMessage,
        {
          setHeader: (name: string, value: string) => {
            headers[name] = value;
          },
          end: resolve,
        } as unknown as ServerResponse,
        reject,
      );
    });
    expect(headers['Cache-Control']).toBe('no-store');
    expect(headers['Content-Type']).toBe('application/json');
    return JSON.parse(body);
  };
  expect((await request()).files[0].raw).toBe('first');
  await write('diagram.yaml', 'second');
  expect((await request()).files[0].raw).toBe('second');
  const next = vi.fn();
  handler(
    { method: 'POST', url: '/__tarskia/open' } as IncomingMessage,
    {} as ServerResponse,
    next,
  );
  handler(
    { method: 'GET', url: '/__tarskia/open/secret' } as IncomingMessage,
    {} as ServerResponse,
    next,
  );
  expect(next).toHaveBeenCalledTimes(2);
});
