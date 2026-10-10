import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { withCancellation } from '../cancellation';
import { buildRepoCensus } from './repo-census';

async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createRepoFixture(files: Record<string, string>): Promise<string> {
  const repoRoot = await createTempDir('diagram-census-');
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(repoRoot, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, contents, 'utf8');
  }
  return repoRoot;
}

describe('buildRepoCensus', () => {
  it('stops scheduling files on cancellation and closes every active reader', async () => {
    const repoRoot = await createRepoFixture(
      Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`file-${i}.ts`, 'content\n'])),
    );
    const controller = new AbortController();
    const reason = new Error('stop census');
    const originalOpen = fs.open.bind(fs);
    let opened = 0;
    let closed = 0;
    const open = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const file = await originalOpen(...args);
      opened++;
      const originalClose = file.close.bind(file);
      vi.spyOn(file, 'close').mockImplementation(async () => {
        await originalClose();
        closed++;
      });
      controller.abort(reason);
      return file;
    });
    try {
      await expect(
        withCancellation(controller.signal, () =>
          buildRepoCensus({ repoRoot, repoUrl: 'fixture', repoRevision: 'fixed' }),
        ),
      ).rejects.toBe(reason);
      expect(opened).toBeGreaterThan(0);
      expect(opened).toBeLessThanOrEqual(8);
      expect(closed).toBe(opened);
    } finally {
      open.mockRestore();
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('preserves the complete census for byte boundaries, invalid UTF-8 and ignored entries', async () => {
    const repoRoot = await createRepoFixture({
      'package.json': '{"name":"fixture"}\n',
      'app/routes/index.ts': 'first\r\nsecond\rthird\n',
      'empty.txt': '',
      'only-cr.txt': '\r',
      'node_modules/ignored.ts': 'ignored\n',
    });
    try {
      const boundary = Buffer.alloc(64 * 1024, 'x');
      boundary[boundary.length - 1] = 13;
      await fs.writeFile(
        path.join(repoRoot, 'boundary.txt'),
        Buffer.concat([boundary, Buffer.from([10, 0xc3, 0xa9, 10, 0xff, 0x0a])]),
      );
      await fs.mkdir(path.join(repoRoot, 'empty-dir'));
      await fs.symlink('package.json', path.join(repoRoot, 'symlink.json'));
      const census = await buildRepoCensus({ repoRoot, repoUrl: 'fixture', repoRevision: 'fixed' });
      expect(
        JSON.stringify({ ...census, repoRoot: '<fixture>', generatedAt: '<fixed>' }, null, 2),
      ).toMatchSnapshot();
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('captures deterministic repo stats, manifests, and signals', async () => {
    const repoRoot = await createRepoFixture({
      'package.json': JSON.stringify({ name: 'sample' }, null, 2),
      'apps/web/package.json': JSON.stringify({ name: 'web' }, null, 2),
      'apps/web/src/routes/index.ts': 'export const route = true;\n',
      'backend/cmd/api/main.go': 'package main\n\nfunc main() {}\n',
      'infra/render.yaml': 'services: []\n',
      'db/migrations/001_init.sql': 'create table users(id uuid primary key);\n',
    });

    const census = await buildRepoCensus({
      repoRoot,
      repoUrl: 'https://github.com/tarskia/example',
      requestedRef: 'main',
      repoRevision: 'deadbeef',
    });

    expect(census.summary.totalFiles).toBe(6);
    expect(census.summary.totalLines).toBeGreaterThan(0);
    expect(census.summary.languages.typescript).toBeGreaterThan(0);
    expect(census.summary.languages.go).toBeGreaterThan(0);
    expect(census.summary.languages.sql).toBeGreaterThan(0);
    expect(census.manifests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'package.json', kind: 'node-package' }),
        expect.objectContaining({
          path: 'infra/render.yaml',
          kind: 'render-blueprint',
        }),
      ]),
    );
    expect(census.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'route-surface',
          path: 'apps/web/src/routes/index.ts',
        }),
        expect.objectContaining({
          kind: 'backend-entrypoint',
          path: 'backend/cmd/api/main.go',
        }),
        expect.objectContaining({
          kind: 'infra-surface',
          path: 'infra/render.yaml',
        }),
        expect.objectContaining({
          kind: 'database-surface',
          path: 'db/migrations/001_init.sql',
        }),
      ]),
    );
    expect(census.summary.topLevelPaths[0]?.path).toBe('apps');
    expect(census.files.map((file) => file.path)).toEqual([
      'apps/web/package.json',
      'apps/web/src/routes/index.ts',
      'backend/cmd/api/main.go',
      'db/migrations/001_init.sql',
      'infra/render.yaml',
      'package.json',
    ]);
  });
});
