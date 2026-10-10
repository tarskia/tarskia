import { simpleGit } from 'simple-git';
import { currentCancellationSignal, throwIfCancelled } from './cancellation';

const PASSTHROUGH_KEYS = new Set([
  'path',
  'home',
  'user',
  'lang',
  'tmpdir',
  'ssh_auth_sock',
  'http_proxy',
  'https_proxy',
  'no_proxy',
]);
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export function workerGitEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (PASSTHROUGH_KEYS.has(key.toLowerCase()) || /^lc_/i.test(key)) env[key] = value;
  }
  return {
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    GIT_LFS_SKIP_SMUDGE: '1',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
  };
}

export function workerGitTimeoutMs(source: NodeJS.ProcessEnv = process.env): number {
  const raw = source.DIAGRAM_WORKER_GIT_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new Error(
      'DIAGRAM_WORKER_GIT_TIMEOUT_MS must be a positive integer no greater than 2147483647',
    );
  }
  return value;
}

export function workerGit(baseDir?: string, source: NodeJS.ProcessEnv = process.env) {
  throwIfCancelled();
  return simpleGit({
    abort: currentCancellationSignal(),
    ...(baseDir ? { baseDir } : {}),
    // The SSH command is our fixed constant, never inherited or user-supplied.
    unsafe: { allowUnsafeSshCommand: true },
    timeout: { block: workerGitTimeoutMs(source), stdOut: false, stdErr: false },
  }).env(workerGitEnv(source));
}
