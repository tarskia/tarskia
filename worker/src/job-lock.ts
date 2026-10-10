import { randomUUID } from 'node:crypto';
import { promises as fs, readFileSync, unlinkSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { ConfigError } from './cli-errors';
import { ensureJobRoot } from './job-root';

interface Owner {
  pid: number;
  hostname: string;
  startedAt: string;
  token?: string;
}
function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
export async function acquireJobLock(jobRoot: string, warn: (message: string) => void) {
  await ensureJobRoot(jobRoot);
  const file = path.join(jobRoot, '.lock');
  const guard = `${file}.reclaim`;
  const owner: Owner = {
    pid: process.pid,
    hostname: hostname(),
    startedAt: new Date().toISOString(),
    token: randomUUID(),
  };
  async function create() {
    const handle = await fs.open(file, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(owner));
      await handle.sync();
    } catch (error) {
      await fs.unlink(file);
      throw error;
    } finally {
      await handle.close();
    }
  }
  async function read(): Promise<Owner> {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) {
      throw new ConfigError(
        `another build is using ${jobRoot} (lock unreadable; inspect ${file} before removing it).`,
        { cause: error },
      );
    }
  }
  const stale = (value: Owner) =>
    value.hostname === hostname() &&
    Number.isSafeInteger(value.pid) &&
    value.pid > 0 &&
    !isAlive(value.pid);
  const contention = (value: Owner) =>
    new ConfigError(`another build is using ${jobRoot} (pid ${value.pid}).`);
  try {
    await create();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const previous = await read();
    if (!stale(previous)) throw contention(previous);
    let claim: Awaited<ReturnType<typeof fs.open>>;
    try {
      claim = await fs.open(guard, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      throw new ConfigError(
        `another build is recovering ${jobRoot}; if no build is running, remove ${guard} and retry.`,
      );
    }
    try {
      // Serialize stale removers and re-read: another contender may already own .lock.
      const current = await read();
      if (!stale(current)) throw contention(current);
      await fs.unlink(file);
      warn(`Replacing stale job lock at ${file} (pid ${current.pid}).`);
      try {
        await create();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw contention(await read());
        throw error;
      }
    } finally {
      await claim.close();
      await fs.unlink(guard);
    }
  }
  const onExit = () => {
    try {
      if (JSON.parse(readFileSync(file, 'utf8')).token === owner.token) unlinkSync(file);
    } catch {
      /* The process is exiting; a stale lock is safely recoverable. */
    }
  };
  process.once('exit', onExit);
  return async () => {
    process.off('exit', onExit);
    const current = await read();
    if (current.token === owner.token) await fs.unlink(file);
  };
}
