import type { ThreadOptions } from '@openai/codex-sdk';
import type { CodexClientLike, CodexThreadLike } from './diagram-agent';

export function createReadOnlyThread(
  client: CodexClientLike,
  options: Pick<ThreadOptions, 'workingDirectory' | 'model' | 'modelReasoningEffort'>,
  threadId?: string,
): CodexThreadLike {
  const threadOptions: ThreadOptions = {
    workingDirectory: options.workingDirectory,
    skipGitRepoCheck: true,
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
    networkAccessEnabled: false,
    webSearchMode: 'disabled',
    model: options.model,
    modelReasoningEffort: options.modelReasoningEffort ?? 'medium',
  };
  return threadId && client.resumeThread
    ? client.resumeThread(threadId, threadOptions)
    : client.startThread(threadOptions);
}
