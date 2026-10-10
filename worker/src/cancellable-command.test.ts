import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { execFileCancellable } from './cancellable-command';
import { withCancellation } from './cancellation';

it('aborts a subprocess tree, including a grandchild that ignores SIGTERM', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'abort-tree-'));
  const pidFile = path.join(root, 'pids');
  try {
    const grandchild = `process.on('SIGTERM',()=>{}); require('fs').writeFileSync(${JSON.stringify(pidFile)}, process.ppid+','+process.pid); setInterval(()=>{},1000);`;
    const script = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], {stdio: 'inherit'}); setInterval(()=>{},1000);`;
    const controller = new AbortController();
    const pending = withCancellation(controller.signal, () =>
      execFileCancellable(process.execPath, ['-e', script]),
    );
    const assertion = expect(pending).rejects.toThrow('stop tree');
    await expect.poll(async () => fs.readFile(pidFile, 'utf8').catch(() => '')).not.toBe('');
    const pids = (await fs.readFile(pidFile, 'utf8')).split(',').map(Number);
    controller.abort(new Error('stop tree'));
    await assertion;
    for (const pid of pids)
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
    await fs.rm(root, { recursive: true, force: true });
  }
});
it('does not launch a command when already cancelled', async () => {
  const controller = new AbortController();
  controller.abort(new Error('stop'));
  expect(() => execFileCancellable('missing-program', [], { signal: controller.signal })).toThrow(
    'stop',
  );
});
