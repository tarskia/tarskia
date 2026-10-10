import { type ExecFileOptions, spawn } from 'node:child_process';
import { currentCancellationSignal } from './cancellation';

/** A separate process group lets cancellation terminate uv and its Python children. */
export function execFileCancellable(
  file: string,
  args: string[],
  options: ExecFileOptions & { signal?: AbortSignal } = {},
): Promise<{ stdout: string; stderr: string }> {
  const signal = options.signal ?? currentCancellationSignal();
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let reason: Error | undefined;
    let stopped: Promise<void> | undefined;
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    let bytes = 0;
    const kill = (value: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, value);
        else child.kill(value);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(value);
      }
    };
    const onExit = () => kill('SIGKILL');
    process.once('exit', onExit);
    const stop = (error: Error) => {
      if (reason) return;
      reason = error;
      kill('SIGTERM');
      // Keep this timer alive even after the parent exits: descendants may ignore TERM.
      stopped = new Promise<void>((resolve) =>
        setTimeout(() => {
          kill('SIGKILL');
          process.off('exit', onExit);
          resolve();
        }, 250),
      );
    };
    const collect = (chunks: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > (options.maxBuffer ?? 1024 * 1024))
        stop(new Error('Command output exceeded maxBuffer'));
      else chunks.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    const abort = () =>
      stop(signal?.reason instanceof Error ? signal.reason : new Error('Command interrupted'));
    const timeout = options.timeout
      ? setTimeout(
          () => stop(new Error(`Command timed out after ${options.timeout}ms`)),
          options.timeout,
        )
      : undefined;
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (!reason) process.off('exit', onExit);
    };
    child.on('error', async (error) => {
      cleanup();
      await stopped;
      reject(reason ?? error);
    });
    child.on('close', async (code) => {
      cleanup();
      await stopped;
      const result = {
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      };
      if (reason) reject(reason);
      else if (code !== 0)
        reject(
          Object.assign(new Error(`Command failed: ${file} (exit ${code})\n${result.stderr}`), {
            code,
            ...result,
          }),
        );
      else resolve(result);
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
