import { throwIfCancelled } from './cancellation';
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface TimingEntry {
  label: string;
  elapsedMs: number;
}

function formatTimestamp(date: Date): string {
  return date.toISOString();
}

function formatLogLine(level: 'INFO' | 'WARN' | 'ERROR', message: string): string {
  return `[${formatTimestamp(new Date())}] [${level}] ${message}`;
}

export function formatDuration(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return '0ms';
  }

  if (elapsedMs < 1000) {
    return `${Math.round(elapsedMs)}ms`;
  }

  const seconds = elapsedMs / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`;
  }
  if (seconds < 60) {
    return `${seconds.toFixed(0)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function formatTimingSummary(entries: TimingEntry[]): string {
  if (entries.length === 0) {
    return 'no completed sections';
  }
  return entries.map((entry) => `${entry.label}=${formatDuration(entry.elapsedMs)}`).join(', ');
}

export async function runTimedStep<T>(
  params: {
    logger: Logger;
    label: string;
    timings?: TimingEntry[];
    detail?: (result: T, elapsedMs: number) => string | undefined;
  },
  action: () => Promise<T>,
): Promise<T> {
  throwIfCancelled();
  const { logger, label, timings, detail } = params;
  logger.info(`Starting ${label}`);
  const startedAt = Date.now();

  try {
    const result = await action();
    throwIfCancelled();
    const elapsedMs = Date.now() - startedAt;
    timings?.push({ label, elapsedMs });
    const suffix = detail?.(result, elapsedMs);
    logger.info(
      `Completed ${label} in ${formatDuration(elapsedMs)}${suffix ? ` (${suffix})` : ''}`,
    );
    return result;
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    logger.error(`Failed ${label} after ${formatDuration(elapsedMs)}`);
    throw error;
  }
}

export function defaultLogger(): Logger {
  return {
    info: (message) => console.error(formatLogLine('INFO', message)),
    warn: (message) => console.warn(formatLogLine('WARN', message)),
    error: (message) => console.error(formatLogLine('ERROR', message)),
  };
}
