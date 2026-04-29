import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const cacheDir = path.join(rootDir, '.cache');
const lockDir = path.join(cacheDir, 'build-semantics.lock');
const semanticsDir = path.join(rootDir, 'packages', 'diagram-semantics');
const srcDir = path.join(semanticsDir, 'src');
const distFiles = [
  path.join(semanticsDir, 'dist', 'index.js'),
  path.join(semanticsDir, 'dist', 'index.d.ts'),
];
const inputFiles = [
  path.join(semanticsDir, 'package.json'),
  path.join(semanticsDir, 'tsconfig.json'),
];
const lockTimeoutMs = 120_000;
const staleLockMs = 10 * 60_000;
const pollIntervalMs = 150;

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function getNewestMtimeMs(targetPath) {
  const stat = await fs.stat(targetPath);
  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  let newest = stat.mtimeMs;
  for (const entry of entries) {
    const childPath = path.join(targetPath, entry.name);
    const childNewest = await getNewestMtimeMs(childPath);
    if (childNewest > newest) {
      newest = childNewest;
    }
  }
  return newest;
}

async function isBuildFresh() {
  const outputsExist = await Promise.all(distFiles.map((filePath) => pathExists(filePath)));
  if (outputsExist.some((exists) => !exists)) {
    return false;
  }

  const inputPaths = [...inputFiles, srcDir];
  const newestInput = Math.max(
    ...(await Promise.all(inputPaths.map((filePath) => getNewestMtimeMs(filePath)))),
  );
  const oldestOutput = Math.min(
    ...(await Promise.all(distFiles.map((filePath) => getNewestMtimeMs(filePath)))),
  );
  return oldestOutput >= newestInput;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readLockMetadata() {
  try {
    const raw = await fs.readFile(path.join(lockDir, 'meta.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function maybeClearStaleLock() {
  const metadata = await readLockMetadata();
  if (!metadata) {
    return;
  }

  const startedAt = typeof metadata.startedAt === 'number' ? metadata.startedAt : 0;
  if (Date.now() - startedAt < staleLockMs && isProcessAlive(metadata.pid)) {
    return;
  }

  await fs.rm(lockDir, { recursive: true, force: true });
}

async function acquireLock() {
  await fs.mkdir(cacheDir, { recursive: true });
  const deadline = Date.now() + lockTimeoutMs;

  while (Date.now() < deadline) {
    try {
      await fs.mkdir(lockDir);
      await fs.writeFile(
        path.join(lockDir, 'meta.json'),
        JSON.stringify(
          {
            pid: process.pid,
            startedAt: Date.now(),
          },
          null,
          2,
        ),
        'utf8',
      );
      return;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
        await maybeClearStaleLock();
        await sleep(pollIntervalMs);
        continue;
      }
      throw error;
    }
  }

  throw new Error('Timed out waiting for the diagram-semantics build lock');
}

async function releaseLock() {
  await fs.rm(lockDir, { recursive: true, force: true });
}

async function runBuild() {
  await acquireLock();
  try {
    if (await isBuildFresh()) {
      return;
    }

    await new Promise((resolve, reject) => {
      const child = spawn('npm', ['run', 'build', '--workspace', '@tarskia/diagram-semantics'], {
        cwd: rootDir,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`diagram-semantics build failed with exit code ${code ?? 'unknown'}`));
      });
      child.on('error', reject);
    });
  } finally {
    await releaseLock();
  }
}

await runBuild();
