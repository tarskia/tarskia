import { AdvancedThreadManager } from '../../codex/advanced-thread-manager';
import type { preparePromptContext } from './prompt-context';

export async function setupThreads(context: Awaited<ReturnType<typeof preparePromptContext>>) {
  const { options, dependencies, codexAgentOptions, resume, emitProgress } = context;
  const advancedThreadManager = new AdvancedThreadManager({
    client: dependencies.advancedThreadClient,
    ...codexAgentOptions,
    workspaceRoot: options.workspace.jobRoot,
    logger: options.logger,
    persistedThreadId: resume.resumeState?.currentAdvancedThreadId ?? null,
    canResumePersistedThread:
      Boolean(resume.resumeState?.currentAdvancedThreadId) &&
      !resume.resumeState?.restartFrom &&
      resume.resumeState?.previousRepoRevision === options.workspace.repoRevision &&
      (resume.resumeState?.previousSchemaSourceRevision ?? null) ===
        (options.workspace.schemaSourceRevision ?? null),
    onThreadIdChanged: async (threadId) => {
      await emitProgress({
        threadId,
        advanced: {
          currentAdvancedThreadId: threadId,
        },
      });
    },
  });
  await emitProgress({
    advanced: {
      currentAdvancedThreadId: advancedThreadManager.getThreadId(),
    },
  });
  const backboneReviewThreadManager = new AdvancedThreadManager({
    client: dependencies.advancedThreadClient,
    ...codexAgentOptions,
    workspaceRoot: options.workspace.jobRoot,
    logger: options.logger,
    persistedThreadId: null,
    canResumePersistedThread: false,
  });
  const backboneReviewRepairThreadManager = new AdvancedThreadManager({
    client: dependencies.advancedThreadClient,
    ...codexAgentOptions,
    workspaceRoot: options.workspace.jobRoot,
    logger: options.logger,
    persistedThreadId: null,
    canResumePersistedThread: false,
  });
  const wave1ReviewThreadManager = new AdvancedThreadManager({
    client: dependencies.advancedThreadClient,
    ...codexAgentOptions,
    workspaceRoot: options.workspace.jobRoot,
    logger: options.logger,
    persistedThreadId: null,
    canResumePersistedThread: false,
  });
  const finalReviewThreadManager = new AdvancedThreadManager({
    client: dependencies.advancedThreadClient,
    ...codexAgentOptions,
    workspaceRoot: options.workspace.jobRoot,
    logger: options.logger,
    persistedThreadId: null,
    canResumePersistedThread: false,
  });
  const finalReviewRepairThreadManager = new AdvancedThreadManager({
    client: dependencies.advancedThreadClient,
    ...codexAgentOptions,
    workspaceRoot: options.workspace.jobRoot,
    logger: options.logger,
    persistedThreadId: null,
    canResumePersistedThread: false,
  });

  return {
    ...context,
    advancedThreadManager,
    backboneReviewThreadManager,
    backboneReviewRepairThreadManager,
    wave1ReviewThreadManager,
    finalReviewThreadManager,
    finalReviewRepairThreadManager,
  };
}
