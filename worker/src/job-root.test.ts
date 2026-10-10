import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { ensureJobRoot } from './job-root';

it('creates an ignored job root without replacing existing user ignore rules', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tarskia-job-root-'));
  try {
    await Promise.all([ensureJobRoot(root), ensureJobRoot(root)]);
    expect(await fs.readFile(path.join(root, '.gitignore'), 'utf8')).toBe('*\n');
    await fs.writeFile(path.join(root, '.gitignore'), 'node_modules/\n');
    await ensureJobRoot(root);
    expect(await fs.readFile(path.join(root, '.gitignore'), 'utf8')).toBe('node_modules/\n');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
