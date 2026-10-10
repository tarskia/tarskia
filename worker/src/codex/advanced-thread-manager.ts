import path from 'node:path';
import { Codex, type CodexOptions, type ThreadOptions } from '@openai/codex-sdk';
import type { Logger } from '../logger';
import type { CodexClientLike, CodexThreadLike } from './diagram-agent';
import { createReadOnlyThread } from './read-only-thread';
import {
  CodexTurnTimeoutError,
  type RunCodexPromptResult,
  runCodexPrompt,
} from './run-codex-prompt';

export type AdvancedThreadScope =
  | 'pre-refinement'
  | 'backbone-review'
  | 'wave1-review'
  | 'node-refinement'
  | 'graph-collation'
  | 'final-review';

export interface AdvancedBuildPromptRunner {
  runPrompt(params: {
    prompt: string;
    operation: string;
    scope: AdvancedThreadScope;
    handoffArtifactPath?: string;
    timeoutMs?: number;
  }): Promise<RunCodexPromptResult & { threadId: string | null }>;
  getThreadId(): string | null;
  isScopePrimed(scope: AdvancedThreadScope): boolean;
}

export interface AdvancedThreadManagerOptions {
  client?: CodexClientLike;
  clientOptions?: CodexOptions;
  model?: string;
  modelReasoningEffort?: ThreadOptions['modelReasoningEffort'];
  workspaceRoot: string;
  logger: Logger;
  persistedThreadId?: string | null;
  canResumePersistedThread: boolean;
  turnTimeoutMs?: number;
  onThreadIdChanged?: (threadId: string | null) => Promise<void> | void;
}

function collectErrorMessages(error: unknown): string[] {
  if (!(error instanceof Error)) {
    return [String(error)];
  }
  const messages = [error.message];
  const cause = error.cause;
  if (cause instanceof Error) {
    messages.push(...collectErrorMessages(cause));
  }
  return messages;
}

export function isMissingRolloutError(error: unknown): boolean {
  const message = collectErrorMessages(error).join('\n').toLowerCase();
  return message.includes('thread/resume') && message.includes('no rollout found');
}

function toWorkspaceRelativePath(workspaceRoot: string, targetPath: string): string {
  const relative = path.relative(workspaceRoot, targetPath);
  return relative.split(path.sep).join('/') || '.';
}

function buildHandoffPrefix(params: {
  workspaceRoot: string;
  scope: AdvancedThreadScope;
  handoffArtifactPath?: string;
}): string {
  if (!params.handoffArtifactPath) {
    return '';
  }
  const label =
    params.scope === 'pre-refinement'
      ? 'pre-refinement'
      : params.scope === 'backbone-review'
        ? 'backbone-review'
        : params.scope === 'wave1-review'
          ? 'wave1-review'
          : params.scope === 'node-refinement'
            ? 'node-refinement'
            : params.scope === 'graph-collation'
              ? 'graph-collation'
              : 'final-review';
  return [
    `Before continuing the ${label} stage, read the current deterministic handoff artifact and the canonical artifacts it references.`,
    `- Handoff artifact: ${toWorkspaceRelativePath(params.workspaceRoot, params.handoffArtifactPath)}`,
    'Treat the handoff artifact and referenced canonical artifacts as authoritative for this build. If they conflict with earlier conversation context, prefer the artifacts.',
    '',
  ].join('\n');
}

export class AdvancedThreadManager implements AdvancedBuildPromptRunner {
  private readonly client: CodexClientLike;
  private readonly options: AdvancedThreadManagerOptions;
  private thread: CodexThreadLike | undefined;
  private persistedThreadId: string | null;
  private readonly seenScopes = new Set<AdvancedThreadScope>();

  constructor(options: AdvancedThreadManagerOptions) {
    this.options = options;
    this.client = options.client ?? new Codex(options.clientOptions);
    this.persistedThreadId =
      options.canResumePersistedThread && options.persistedThreadId
        ? options.persistedThreadId
        : null;
  }

  getThreadId(): string | null {
    return this.thread?.id ?? this.persistedThreadId ?? null;
  }

  isScopePrimed(scope: AdvancedThreadScope): boolean {
    return this.seenScopes.has(scope);
  }

  private async updateThreadId(threadId: string | null): Promise<void> {
    this.persistedThreadId = threadId;
    await this.options.onThreadIdChanged?.(threadId);
  }

  private async invalidateThread(reason: string): Promise<void> {
    if (!this.thread && !this.persistedThreadId) {
      return;
    }
    this.thread = undefined;
    this.seenScopes.clear();
    this.options.logger.warn(`Invalidating advanced Codex thread: ${reason}`);
    await this.updateThreadId(null);
  }

  private async ensureThread(): Promise<CodexThreadLike> {
    if (this.thread) {
      return this.thread;
    }
    if (this.persistedThreadId && this.client.resumeThread) {
      const thread = createReadOnlyThread(
        this.client,
        {
          workingDirectory: this.options.workspaceRoot,
          model: this.options.model,
          modelReasoningEffort: this.options.modelReasoningEffort,
        },
        this.persistedThreadId,
      );
      this.thread = thread;
      await this.updateThreadId(thread.id ?? this.persistedThreadId);
      return thread;
    }
    const thread = createReadOnlyThread(this.client, {
      workingDirectory: this.options.workspaceRoot,
      model: this.options.model,
      modelReasoningEffort: this.options.modelReasoningEffort,
    });
    this.thread = thread;
    await this.updateThreadId(thread.id);
    return thread;
  }

  async runPrompt(params: {
    prompt: string;
    operation: string;
    scope: AdvancedThreadScope;
    handoffArtifactPath?: string;
    timeoutMs?: number;
  }): Promise<RunCodexPromptResult & { threadId: string | null }> {
    const execute = async (allowRecovery: boolean) => {
      const thread = await this.ensureThread();
      const needsHandoff = !this.seenScopes.has(params.scope);
      const prompt = needsHandoff
        ? `${buildHandoffPrefix({
            workspaceRoot: this.options.workspaceRoot,
            scope: params.scope,
            handoffArtifactPath: params.handoffArtifactPath,
          })}${params.prompt}`
        : params.prompt;
      try {
        const turn = await runCodexPrompt(thread, prompt, {
          operation: params.operation,
          retries: 0,
          reasoningEffort: this.options.modelReasoningEffort,
          timeoutMs: params.timeoutMs ?? this.options.turnTimeoutMs,
          onTimeoutAttempt: ({ attempt, maxAttempts, timeoutMs, operation }) => {
            const retryNote =
              attempt < maxAttempts
                ? ` Retrying (${maxAttempts - attempt} attempts remaining).`
                : ' No retry attempts remain.';
            this.options.logger.warn(
              `Codex turn timed out after ${timeoutMs}ms during ${operation} (attempt ${attempt}/${maxAttempts}).${retryNote}`,
            );
          },
        });
        this.seenScopes.add(params.scope);
        return {
          ...turn,
          threadId: thread.id,
        };
      } catch (error) {
        if (
          !allowRecovery ||
          !(isMissingRolloutError(error) || error instanceof CodexTurnTimeoutError)
        ) {
          throw error;
        }
        if (error instanceof CodexTurnTimeoutError && !params.handoffArtifactPath) {
          this.options.logger.warn(
            'Retrying timeout on the same thread: no handoff artifact is available to restore prior context.',
          );
          return execute(false);
        }
        await this.invalidateThread(
          error instanceof CodexTurnTimeoutError
            ? 'advanced stage turn timed out'
            : 'rollout disappeared during advanced stage turn',
        );
        return execute(false);
      }
    };

    return execute(true);
  }
}
