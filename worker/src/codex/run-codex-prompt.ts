import type { ThreadItem, Usage } from '@openai/codex-sdk';
import { currentCancellationSignal } from '../cancellation';
import type { ReasoningEffort } from '../reasoning-effort';
import type { CodexThreadLike } from './diagram-agent';

import { currentTurnPolicy } from './turn-policy';
import { currentUsageAccounting } from './usage-accounting';

export function resolveTurnTimeoutMs(effort: ReasoningEffort = 'medium', minutes?: number): number {
  if (minutes !== undefined) return minutes * 60_000;
  return (
    { minimal: 5, low: 5, medium: 5, high: 15, xhigh: 15, max: 30, ultra: 30, persistent: 30 }[
      effort
    ] * 60_000
  );
}

export class CodexTurnTimeoutError extends Error {}

async function runAccountedTurn(
  thread: CodexThreadLike,
  prompt: string,
  signal: AbortSignal,
): Promise<RunCodexPromptResult> {
  const accounting = currentUsageAccounting();
  signal.throwIfAborted();
  await accounting.beforeTurn();
  signal.throwIfAborted();
  currentTurnPolicy()?.beforeTurn();
  if (!thread.runStreamed) {
    const result = await thread.run(prompt, { signal });
    return {
      ...result,
      usage: result.usage ? await accounting.record(thread.id, result.usage) : null,
    };
  }
  const { events } = await thread.runStreamed(prompt, { signal });
  const items: ThreadItem[] = [];
  let threadId = thread.id;
  let finalResponse = '';
  let usage: Usage | null = null;
  for await (const event of events) {
    if (event.type === 'thread.started') {
      threadId = event.thread_id;
    } else if (event.type === 'item.completed') {
      items.push(event.item);
      if (event.item.type === 'agent_message') finalResponse = event.item.text;
    } else if (event.type === 'turn.completed') {
      // Persist before the next event: process exit/abort or parsing may still fail.
      usage = await accounting.record(threadId, event.usage);
    } else if (event.type === 'turn.failed') {
      // The SDK failure event contains no usage. A later cumulative report can
      // recover it; otherwise the unknown cost cannot be estimated reliably.
      throw new Error(event.error.message);
    }
  }
  return { finalResponse, items, usage };
}

function formatDuration(ms: number): string {
  if (ms % 60000 === 0) {
    return `${ms / 60000}m`;
  }
  if (ms % 1000 === 0) {
    return `${ms / 1000}s`;
  }
  return `${ms}ms`;
}

export interface RunCodexPromptOptions {
  operation: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  reasoningEffort?: ReasoningEffort;
  /** Recreate the adapter's thread; repair prompts must contain their own context. */
  freshThread?: () => CodexThreadLike | Promise<CodexThreadLike>;
  onTimeoutAttempt?: (params: {
    attempt: number;
    maxAttempts: number;
    timeoutMs: number;
    operation: string;
  }) => void;
}

export interface RunCodexPromptResult {
  finalResponse: string;
  items: ThreadItem[];
  usage: Usage | null;
}

export async function runCodexPrompt(
  thread: CodexThreadLike,
  prompt: string,
  options: RunCodexPromptOptions,
): Promise<RunCodexPromptResult> {
  const rootSignal = options.signal ?? currentCancellationSignal();
  const timeoutMs =
    options.timeoutMs ??
    currentTurnPolicy()?.timeoutMs ??
    resolveTurnTimeoutMs(options.reasoningEffort);
  const retries = Math.min(1, Math.max(0, options.retries ?? 1));
  const maxAttempts = retries + 1;
  let lastTimeoutError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    rootSignal?.throwIfAborted();
    const controller = new AbortController();
    const signal = rootSignal
      ? AbortSignal.any([rootSignal, controller.signal])
      : controller.signal;
    const timeout =
      timeoutMs === 0
        ? undefined
        : setTimeout(() => {
            controller.abort(
              new Error(
                `Codex turn timed out after ${formatDuration(timeoutMs)} during ${options.operation} (attempt ${attempt}/${maxAttempts})`,
              ),
            );
          }, timeoutMs);
    timeout?.unref?.();

    try {
      const result = await runAccountedTurn(thread, prompt, signal);
      rootSignal?.throwIfAborted();
      return result;
    } catch (error) {
      rootSignal?.throwIfAborted();
      if (controller.signal.aborted) {
        const reason =
          controller.signal.reason instanceof Error
            ? controller.signal.reason.message
            : `Codex turn timed out after ${formatDuration(timeoutMs)} during ${options.operation} (attempt ${attempt}/${maxAttempts})`;
        options.onTimeoutAttempt?.({
          attempt,
          maxAttempts,
          timeoutMs,
          operation: options.operation,
        });
        lastTimeoutError = new Error(reason, { cause: error });
        if (attempt < maxAttempts) {
          if (options.freshThread) thread = await options.freshThread();
          continue;
        }
        throw new CodexTurnTimeoutError(
          `${reason}; exhausted ${retries} ${retries === 1 ? 'retry' : 'retries'}`,
          {
            cause: lastTimeoutError,
          },
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    lastTimeoutError?.message ?? `Codex turn failed unexpectedly during ${options.operation}`,
    { cause: lastTimeoutError },
  );
}
