import { promises as fs } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { acquireJobLock } from './job-lock';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'job-lock-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it('excludes concurrent normal owners and releases ownership', async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () => acquireJobLock(root, vi.fn())),
  );
  const successes = results.filter((r) => r.status === 'fulfilled');
  expect(successes).toHaveLength(1);
  const metadata = JSON.parse(await fs.readFile(path.join(root, '.lock'), 'utf8'));
  expect(metadata).toMatchObject({
    pid: process.pid,
    hostname: hostname(),
    startedAt: expect.any(String),
  });
  await successes[0].value();
  const release = await acquireJobLock(root, vi.fn());
  await expect(acquireJobLock(root, vi.fn())).rejects.toThrow(
    `another build is using ${root} (pid ${process.pid}).`,
  );
  await release();
  await expect(fs.access(path.join(root, '.lock'))).rejects.toThrow();
});
it('serializes competing stale replacements without deleting the new owner', async () => {
  await fs.writeFile(
    path.join(root, '.lock'),
    JSON.stringify({ pid: 2147483647, hostname: hostname(), startedAt: 'old' }),
  );
  const warn = vi.fn();
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, () => acquireJobLock(root, warn)),
  );
  const successes = results.filter((r) => r.status === 'fulfilled');
  expect(successes).toHaveLength(1);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(JSON.parse(await fs.readFile(path.join(root, '.lock'), 'utf8')).pid).toBe(process.pid);
  await successes[0].value();
});
it('never steals foreign-host or unreadable locks', async () => {
  await fs.writeFile(
    path.join(root, '.lock'),
    JSON.stringify({ pid: 2147483647, hostname: 'another-host', startedAt: 'old' }),
  );
  await expect(acquireJobLock(root, vi.fn())).rejects.toThrow('another build');
  await fs.writeFile(path.join(root, '.lock'), '');
  await expect(acquireJobLock(root, vi.fn())).rejects.toThrow('lock unreadable');
});
