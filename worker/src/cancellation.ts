import { AsyncLocalStorage } from 'node:async_hooks';

const signals = new AsyncLocalStorage<AbortSignal>();
export const currentCancellationSignal = () => signals.getStore();
export const throwIfCancelled = () => currentCancellationSignal()?.throwIfAborted();
export function withCancellation<T>(signal: AbortSignal | undefined, run: () => T): T {
  signal?.throwIfAborted();
  return signal ? signals.run(signal, run) : run();
}

export function installCancellationHandlers(controller: AbortController) {
  let exitCode: number | undefined;
  const interrupt = () => abort('SIGINT', 130);
  const terminate = () => abort('SIGTERM', 143);
  function abort(signal: string, code: number) {
    if (controller.signal.aborted) process.exit(code);
    exitCode = code;
    controller.abort(new Error(`Build interrupted by ${signal}`));
  }
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  return {
    get exitCode() {
      return exitCode;
    },
    dispose() {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    },
  };
}
