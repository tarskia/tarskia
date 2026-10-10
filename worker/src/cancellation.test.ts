import { expect, it, vi } from 'vitest';
import { installCancellationHandlers } from './cancellation';

it.each([
  ['SIGINT', 130],
  ['SIGTERM', 143],
] as const)('handles %s once gracefully and immediately exits on a second signal', (signal, code) => {
  const before = process.listenerCount(signal);
  const controller = new AbortController();
  const handlers = installCancellationHandlers(controller);
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('immediate exit');
  });
  try {
    process.emit(signal);
    expect(controller.signal.aborted).toBe(true);
    expect(handlers.exitCode).toBe(code);
    expect(exit).not.toHaveBeenCalled();
    expect(() => process.emit(signal)).toThrow('immediate exit');
    expect(exit).toHaveBeenCalledWith(code);
  } finally {
    handlers.dispose();
    exit.mockRestore();
  }
  expect(process.listenerCount(signal)).toBe(before);
});
