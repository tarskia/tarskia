import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { writeFileAtomic } from './write-file-atomic';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

it('publishes complete contents only after syncing, and cleans up a failed rename', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-write-'));
  directories.push(directory);
  const destination = path.join(directory, 'checkpoint.json');
  await fs.writeFile(destination, 'old complete contents', { mode: 0o600 });
  const next = 'new complete contents'.repeat(10000);
  const open = fs.open.bind(fs);
  const sync = vi.fn();
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const file = await open(...args);
    const originalSync = file.sync.bind(file);
    vi.spyOn(file, 'sync').mockImplementation(async () => {
      await originalSync();
      sync();
    });
    return file;
  });
  const rename = vi.spyOn(fs, 'rename').mockImplementationOnce(async (source, target) => {
    expect(path.dirname(String(source))).toBe(directory);
    expect(String(source)).toMatch(new RegExp(`\\.${process.pid}\\..+\\.tmp$`));
    expect(target).toBe(destination);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(source, 'utf8')).toBe(next);
    expect(await fs.readFile(destination, 'utf8')).toBe('old complete contents');
    throw new Error('simulated interruption before rename');
  });
  await expect(writeFileAtomic(destination, next)).rejects.toThrow('simulated interruption');
  expect(await fs.readFile(destination, 'utf8')).toBe('old complete contents');
  expect(await fs.readdir(directory)).toEqual(['checkpoint.json']);
  rename.mockRestore();
  await writeFileAtomic(destination, next);
  expect(await fs.readFile(destination, 'utf8')).toBe(next);
  expect((await fs.stat(destination)).mode & 0o777).toBe(0o600);
  expect(await fs.readdir(directory)).toEqual(['checkpoint.json']);
});

it('exclusive publication never replaces a committed checkpoint', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-exclusive-'));
  directories.push(directory);
  const destination = path.join(directory, 'checkpoint');
  await writeFileAtomic(destination, 'original', { exclusive: true });
  await expect(
    writeFileAtomic(destination, 'replacement', { exclusive: true }),
  ).rejects.toMatchObject({ code: 'EEXIST' });
  expect(await fs.readFile(destination, 'utf8')).toBe('original');
  expect(await fs.readdir(directory)).toEqual(['checkpoint']);
});
