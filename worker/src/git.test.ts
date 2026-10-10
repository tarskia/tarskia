import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { workerGit, workerGitEnv, workerGitTimeoutMs } from './git';

describe('worker git process boundary', () => {
  it('passes only the approved environment and fixed noninteractive controls', () => {
    const allowed = {
      PATH: '/bin',
      HOME: '/home/user',
      USER: 'user',
      LANG: 'C',
      LC_ALL: 'C',
      lc_messages: 'C',
      TMPDIR: '/tmp',
      SSH_AUTH_SOCK: '/agent',
      HTTPS_PROXY: 'proxy',
      http_proxy: 'proxy',
      NO_PROXY: 'localhost',
    };
    expect(
      workerGitEnv({
        ...allowed,
        SECRET_TOKEN: 'secret',
        GIT_DIR: '/elsewhere',
        GIT_WORK_TREE: '/elsewhere',
        GIT_CONFIG_PARAMETERS: 'unsafe',
        GIT_SSL_NO_VERIFY: '1',
        GIT_SSH_COMMAND: 'unsafe',
        SSH_ASKPASS: 'unsafe',
        UV_INDEX_URL: 'unsafe',
      }),
    ).toEqual({
      ...allowed,
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
      GIT_LFS_SKIP_SMUDGE: '1',
      GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
    });
  });
  it('uses a bounded default and validates overrides', () => {
    expect(workerGitTimeoutMs({})).toBe(600000);
    expect(workerGitTimeoutMs({ TARSKIA_GIT_TIMEOUT_MS: '1234' })).toBe(1234);
    for (const value of ['', '0', '-1', 'Infinity', 'NaN', '2.5', '2147483648']) {
      expect(() => workerGitTimeoutMs({ TARSKIA_GIT_TIMEOUT_MS: value })).toThrow(
        'positive integer',
      );
    }
  });
  it('bounds wall-clock runtime even while git emits output', async () => {
    const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'git-timeout-'));
    try {
      await fs.writeFile(
        path.join(bin, 'git'),
        '#!/usr/bin/env node\nsetInterval(() => process.stdout.write("progress\\n"), 10);\n',
        { mode: 0o755 },
      );
      const git = workerGit(undefined, {
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        TARSKIA_GIT_TIMEOUT_MS: '150',
      });
      await expect(git.raw(['--version'])).rejects.toMatchObject({ plugin: 'timeout' });
    } finally {
      await fs.rm(bin, { recursive: true, force: true });
    }
  });
});

it('terminates an active git operation on root abort', async () => {
  const { withCancellation } = await import('./cancellation');
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'git-abort-'));
  try {
    const ready = path.join(bin, 'ready');
    await fs.writeFile(
      path.join(bin, 'git'),
      `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(() => {}, 1000);\n`,
      { mode: 0o755 },
    );
    const controller = new AbortController();
    const pending = withCancellation(controller.signal, () =>
      workerGit(undefined, { PATH: `${bin}${path.delimiter}${process.env.PATH}` }).raw([
        '--version',
      ]),
    );
    const assertion = expect(pending).rejects.toMatchObject({ plugin: 'abort' });
    await expect.poll(async () => fs.readFile(ready, 'utf8').catch(() => '')).not.toBe('');
    const pid = Number(await fs.readFile(ready, 'utf8'));
    controller.abort(new Error('stop'));
    await assertion;
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
  } finally {
    await fs.rm(bin, { recursive: true, force: true });
  }
});
