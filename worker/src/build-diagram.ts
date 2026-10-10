import { promises as fs } from 'node:fs';
import path from 'node:path';
import { dump as dumpYaml } from 'js-yaml';
import { AdvancedAiDiagramService } from './advanced/advanced-ai-diagram-service';
import type { AreaPlanner } from './advanced/area-plan';
import { summarizeStageSettings } from './advanced/checkpoint-inputs';
import type {
  FinalGraphReviewer,
  FinalGraphReviewerRepairer,
  GraphCollator,
  GraphCollatorRepairer,
  Level0BackboneBuilder,
  Level0BackboneRepairer,
  Level0BackboneReviewer,
  Level0BackboneReviewerRepairer,
  NodeRefiner,
  NodeRefinerRepairer,
  Wave1Reviewer,
  Wave1ReviewerRepairer,
} from './advanced/graph-builders';
import type { GraphifyHintsBuilder, GraphifyHintsMode } from './advanced/graphify-hints';
import { dedupeSchemaActivations } from './advanced/schema-set';
import {
  type AdvancedCheckpointStage,
  type BuildMode,
  compareAdvancedCheckpointStage,
  normalizeBuildMode,
} from './advanced/types';
import {
  type AiDiagramService,
  AiDiagramServiceError,
  DefaultAiDiagramService,
} from './ai-diagram-service';
import { normalizeAppDescriptionText } from './app-description';
import {
  applyBuildMetadataToDocument,
  summarizeWorkerBuild,
  type WorkerBuildSummary,
} from './build-summary';
import { currentCancellationSignal, throwIfCancelled, withCancellation } from './cancellation';
import type { DiagramAgent } from './codex/diagram-agent';
import {
  currentTurnPolicy,
  findTurnBudgetError,
  retainPartialDocument,
  TurnPolicy,
  withTurnPolicy,
} from './codex/turn-policy';
import { UsageAccounting, withUsageAccounting } from './codex/usage-accounting';
import {
  assertGeneratedSchemaIdAvailable,
  buildGeneratedSchemaRef,
  deriveGeneratedSchemaId,
  type GeneratedSchemaResult,
  GeneratedSchemaService,
} from './generated-schema';
import { acquireJobLock } from './job-lock';
import {
  createInitialJobMetadata,
  deriveDefaultJobRoot,
  type GeneratedSchemaMetadata,
  isCompatibleResumeMetadata,
  type JobMetadata,
  readJobMetadata,
  serializeDiagnostics,
  writeJobMetadata,
} from './job-metadata';
import {
  defaultLogger,
  formatDuration,
  formatTimingSummary,
  type Logger,
  runTimedStep,
  type TimingEntry,
} from './logger';
import { resolvePathOption } from './path-option';
import { type ReasoningEffort, resolveReasoningEffort } from './reasoning-effort';
import { dedupeDocumentRelations } from './relation-deduplication';
import { redactLegacyRepositoryArtifacts, redactRepositorySpecifier } from './repository-identity';
import {
  DefaultRepositoryService,
  type RepositoryService,
  RepositoryServiceError,
} from './repository-service';
import {
  type BuildSecrets,
  emptyBuildSecrets,
  redactOutputDocument,
  type UnmaskedSecrets,
} from './secret-masking';
import {
  buildSchemaRuntimeFromCatalog,
  buildSchemaVersionCatalogFromRegistry,
  type Diagnostic,
  diagramDiagnostic,
  loadSchemaRegistry,
  serializeDocument,
} from './semantic';
import type { SourceRepositoryMetadata } from './source-repository';
import { parseYamlText } from './untrusted-yaml';
import type { PreparedWorkspace, PrepareWorkspaceOptions } from './workspace';
import { writeFileAtomic } from './write-file-atomic';

export interface BuildDiagramOptions extends PrepareWorkspaceOptions {
  signal?: AbortSignal;
  out: string;
  mode?: BuildMode;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  maxTurns?: number;
  turnTimeoutMinutes?: number;
  schemaOut?: string;
  schemaId?: string;
  restartFrom?: AdvancedCheckpointStage;
  stopAfter?: AdvancedCheckpointStage;
  nodeRefinementMaxDepth?: number;
  graphifyHintsMode?: GraphifyHintsMode;
}

export interface BuildDiagramResult {
  secrets: BuildSecrets;
  outputPath: string;
  workspace: PreparedWorkspace;
  threadId: string | null;
  repaired: boolean;
  diagnostics: Diagnostic[];
  resolvedSchemaIds: string[];
  mode: BuildMode;
  generatedSchema: GeneratedSchemaResult;
  buildSummary: WorkerBuildSummary;
}

export class BuildDiagramError extends Error {
  readonly diagnostics: Diagnostic[];
  readonly workspace?: PreparedWorkspace;
  readonly threadId: string | null;
  readonly repaired: boolean;
  readonly jobRoot?: string;

  constructor(
    message: string,
    diagnostics: Diagnostic[] = [],
    workspace?: PreparedWorkspace,
    threadId: string | null = null,
    repaired = false,
    jobRoot?: string,
    options?: { cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'BuildDiagramError';
    this.diagnostics = diagnostics;
    this.workspace = workspace;
    this.threadId = threadId;
    this.repaired = repaired;
    this.jobRoot = jobRoot;
  }
}

function toGeneratedSchemaMetadata(
  result: GeneratedSchemaResult,
  outputPath: string | null,
): GeneratedSchemaMetadata {
  return {
    ...result,
    outputPath,
    diagnostics: serializeDiagnostics(result.diagnostics),
  };
}

export async function buildDiagram(
  options: BuildDiagramOptions,
  dependencies: Parameters<typeof runBuildDiagram>[1] = {},
): Promise<BuildDiagramResult> {
  const signal = options.signal ?? currentCancellationSignal();
  signal?.throwIfAborted();
  normalizeBuildMode(options.mode);
  resolveReasoningEffort(options.reasoningEffort);
  const schemaSource = resolvePathOption(options.schemaSource, 'schema-source');
  if (options.schemaOut?.trim()) {
    resolvePathOption(options.schemaOut, 'schema-out');
    await assertGeneratedSchemaIdAvailable(
      deriveGeneratedSchemaId(options.repo, options.schemaId),
      schemaSource,
    );
  }
  signal?.throwIfAborted();
  const root = options.jobRoot?.trim()
    ? resolvePathOption(options.jobRoot, 'job-root')
    : deriveDefaultJobRoot(resolvePathOption(options.out, 'out'));
  const release = await acquireJobLock(root, (message) =>
    (dependencies.logger ?? defaultLogger()).warn(message),
  );
  try {
    return await withCancellation(signal, () =>
      withTurnPolicy(
        new TurnPolicy(
          options.maxTurns,
          resolveReasoningEffort(options.reasoningEffort),
          options.turnTimeoutMinutes,
        ),
        () => runBuildDiagram(options, dependencies),
      ),
    );
  } finally {
    await release();
  }
}

async function runBuildDiagram(
  options: BuildDiagramOptions,
  dependencies: {
    agent?: DiagramAgent;
    areaPlanner?: AreaPlanner;
    level0BackboneBuilder?: Level0BackboneBuilder;
    level0BackboneRepairer?: Level0BackboneRepairer;
    level0BackboneReviewer?: Level0BackboneReviewer;
    level0BackboneReviewerRepairer?: Level0BackboneReviewerRepairer;
    wave1Reviewer?: Wave1Reviewer;
    wave1ReviewerRepairer?: Wave1ReviewerRepairer;
    nodeRefiner?: NodeRefiner;
    nodeRefinerRepairer?: NodeRefinerRepairer;
    graphCollator?: GraphCollator;
    graphCollatorRepairer?: GraphCollatorRepairer;
    finalGraphReviewer?: FinalGraphReviewer;
    finalGraphReviewerRepairer?: FinalGraphReviewerRepairer;
    graphifyHintsBuilder?: GraphifyHintsBuilder;
    advancedThreadClient?: import('./codex/diagram-agent').CodexClientLike;
    logger?: Logger;
    repositoryService?: RepositoryService;
    aiDiagramService?: AiDiagramService;
    generatedSchemaService?: GeneratedSchemaService;
  } = {},
): Promise<BuildDiagramResult> {
  const rawRepo = options.repo;
  options = { ...options, repo: redactRepositorySpecifier(rawRepo) };
  const logger = dependencies.logger ?? defaultLogger();
  const repositoryService = dependencies.repositoryService ?? new DefaultRepositoryService();
  const normalizedMode = normalizeBuildMode(options.mode);
  const modelLabel = options.model?.trim() || 'Codex CLI default';
  const reasoningEffort = resolveReasoningEffort(options.reasoningEffort);
  const resolvedOutputPath = resolvePathOption(options.out, 'out');
  const resolvedSchemaOut = options.schemaOut?.trim()
    ? resolvePathOption(options.schemaOut, 'schema-out')
    : undefined;
  const resolvedSchemaId = resolvedSchemaOut
    ? deriveGeneratedSchemaId(options.repo, options.schemaId)
    : undefined;
  const resolvedSchemaRef = resolvedSchemaId
    ? buildGeneratedSchemaRef(resolvedSchemaId)
    : undefined;
  const resolvedSchemaSource = resolvePathOption(options.schemaSource, 'schema-source');
  const resolvedJobRoot =
    options.jobRoot?.trim() && options.jobRoot.trim().length > 0
      ? resolvePathOption(options.jobRoot, 'job-root')
      : deriveDefaultJobRoot(resolvedOutputPath);
  await redactLegacyRepositoryArtifacts(resolvedJobRoot);
  const previousMetadata = !options.hardRefresh
    ? await readJobMetadata(resolvedJobRoot)
    : undefined;
  let canResume =
    (normalizedMode === 'advanced' || previousMetadata?.status === 'budget-exhausted') &&
    isCompatibleResumeMetadata(previousMetadata, {
      mode: normalizedMode,
      repo: options.repo,
      ref: options.ref,
      generateSchema: Boolean(resolvedSchemaOut),
      schemaId: resolvedSchemaId ?? null,
      schemaOutPath: resolvedSchemaOut ?? null,
      schemaSource: resolvedSchemaSource,
      outputPath: resolvedOutputPath,
    });
  const aiDiagramService =
    dependencies.aiDiagramService ??
    (normalizedMode === 'advanced'
      ? new AdvancedAiDiagramService({
          areaPlanner: dependencies.areaPlanner,
          level0BackboneBuilder: dependencies.level0BackboneBuilder,
          level0BackboneRepairer: dependencies.level0BackboneRepairer,
          level0BackboneReviewer: dependencies.level0BackboneReviewer,
          level0BackboneReviewerRepairer: dependencies.level0BackboneReviewerRepairer,
          wave1Reviewer: dependencies.wave1Reviewer,
          wave1ReviewerRepairer: dependencies.wave1ReviewerRepairer,
          nodeRefiner: dependencies.nodeRefiner,
          nodeRefinerRepairer: dependencies.nodeRefinerRepairer,
          graphCollator: dependencies.graphCollator,
          graphCollatorRepairer: dependencies.graphCollatorRepairer,
          finalGraphReviewer: dependencies.finalGraphReviewer,
          finalGraphReviewerRepairer: dependencies.finalGraphReviewerRepairer,
          graphifyHintsBuilder: dependencies.graphifyHintsBuilder,
          advancedThreadClient: dependencies.advancedThreadClient,
        })
      : new DefaultAiDiagramService({ agent: dependencies.agent }));
  const generatedSchemaService =
    dependencies.generatedSchemaService ?? new GeneratedSchemaService();
  const canReuseGeneratedSchema =
    Boolean(previousMetadata?.generatedSchema?.status === 'succeeded') &&
    Boolean(previousMetadata?.generatedSchema?.artifactPath);
  const canResumeWithoutTargetRepoClone =
    canResume &&
    normalizedMode === 'advanced' &&
    Boolean(previousMetadata?.advanced?.lastCompletedStage) &&
    compareAdvancedCheckpointStage(
      'repo-census',
      previousMetadata?.advanced?.lastCompletedStage ?? 'repo-census',
    ) <= 0 &&
    (!resolvedSchemaOut || canReuseGeneratedSchema) &&
    (!options.restartFrom ||
      compareAdvancedCheckpointStage('repo-census', options.restartFrom) < 0);

  const startedAt = Date.now();
  const timings: TimingEntry[] = [];
  let buildSucceeded = false;
  let metadata: JobMetadata =
    canResume && previousMetadata
      ? {
          ...previousMetadata,
          mode: normalizedMode,
          model: options.model?.trim() || null,
          reasoningEffort,
          generateSchema: Boolean(resolvedSchemaOut),
          schemaId: resolvedSchemaId ?? null,
          schemaOutPath: resolvedSchemaOut ?? null,
          schemaSource: resolvedSchemaSource,
          outputPath: resolvedOutputPath,
          workspaceRoot: resolvedJobRoot,
          status: 'running',
          activeStage: 'repository-workspace-preparation',
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          finishedAt: null,
          failureMessage: null,
          threadId: null,
          repaired: false,
          resolvedSchemaIds: [],
          diagnostics: [],
          buildSummary: null,
          sourceRepository: previousMetadata.sourceRepository ?? null,
          generatedSchema:
            previousMetadata.generatedSchema &&
            previousMetadata.generatedSchema.schemaId === resolvedSchemaId
              ? {
                  ...previousMetadata.generatedSchema,
                  outputPath: resolvedSchemaOut ?? null,
                  usedByDiagram: false,
                }
              : resolvedSchemaId && resolvedSchemaRef
                ? {
                    status: resolvedSchemaOut ? 'failed' : 'not-requested',
                    schemaId: resolvedSchemaId,
                    schemaRef: resolvedSchemaRef,
                    artifactPath: null,
                    outputPath: resolvedSchemaOut ?? null,
                    repaired: false,
                    reused: false,
                    usedByDiagram: false,
                    threadId: null,
                    diagnostics: [],
                    failureMessage: resolvedSchemaOut ? 'Schema generation has not run yet' : null,
                  }
                : null,
          advanced: previousMetadata.advanced
            ? {
                ...previousMetadata.advanced,
                restartFrom: options.restartFrom ?? null,
              }
            : undefined,
        }
      : createInitialJobMetadata({
          mode: normalizedMode,
          repo: options.repo,
          ref: options.ref,
          model: options.model,
          reasoningEffort,
          generateSchema: Boolean(resolvedSchemaOut),
          schemaId: resolvedSchemaId,
          schemaRef: resolvedSchemaRef,
          schemaOutPath: resolvedSchemaOut,
          schemaSource: resolvedSchemaSource,
          outputPath: resolvedOutputPath,
          workspaceRoot: resolvedJobRoot,
          restartFrom: options.restartFrom,
          sourceRepository: previousMetadata?.sourceRepository ?? null,
        });

  let secrets = emptyBuildSecrets();
  const redactionDiagnostics: Diagnostic[] = [];
  const reportSecrets = (report: BuildSecrets, unmasked?: UnmaskedSecrets) => {
    secrets = {
      ...report,
      files: report.files.map((file) => ({ ...file, rules: [...file.rules] })),
    };
    options.onSecrets?.(secrets, unmasked);
  };
  const redactForOutput = async <T>(
    document: T,
    kind: 'diagram' | 'schema' = 'diagram',
  ): Promise<T> => {
    const redacted = await redactOutputDocument(document, { kind });
    for (const item of redacted.redactions) {
      const message = `Redacted a possible secret (${item.rule}) in ${item.location}`;
      logger.warn(message);
      redactionDiagnostics.push(
        diagramDiagnostic({
          phase: 'document',
          severity: 'warning',
          code: 'diagram.secret_redacted',
          message,
        }),
      );
    }
    reportSecrets({
      ...secrets,
      redactedFromOutput: secrets.redactedFromOutput + redacted.redactions.length,
    });
    return redacted.document;
  };
  let metadataWrites: Promise<void> = Promise.resolve();
  const persistMetadata = async (next: JobMetadata): Promise<void> => {
    metadata = {
      ...next,
      secrets: structuredClone(secrets),
      diagnostics: [
        ...next.diagnostics.filter((item) => item.code !== 'diagram.secret_redacted'),
        ...serializeDiagnostics(redactionDiagnostics),
      ],
      updatedAt: new Date().toISOString(),
    };
    const snapshot = metadata;
    const write = metadataWrites.then(() => writeJobMetadata(resolvedJobRoot, snapshot));
    metadataWrites = write.catch(() => {});
    await write;
  };
  const applyMetadataUpdate = async (update: {
    activeStage?: string | null;
    status?: JobMetadata['status'];
    failureMessage?: string | null;
    finishedAt?: string | null;
    workspaceRoot?: string;
    repoRevision?: string | null;
    sourceRepository?: SourceRepositoryMetadata | null;
    appDescription?: string | null;
    schemaSourceRevision?: string | null;
    threadId?: string | null;
    repaired?: boolean;
    diagnostics?: Diagnostic[];
    resolvedSchemaIds?: string[];
    buildSummary?: JobMetadata['buildSummary'];
    generatedSchema?: GeneratedSchemaResult;
    advanced?: Partial<NonNullable<JobMetadata['advanced']>>;
  }): Promise<void> => {
    await persistMetadata({
      ...metadata,
      activeStage: update.activeStage !== undefined ? update.activeStage : metadata.activeStage,
      status: update.status ?? metadata.status,
      failureMessage:
        update.failureMessage !== undefined ? update.failureMessage : metadata.failureMessage,
      finishedAt: update.finishedAt !== undefined ? update.finishedAt : metadata.finishedAt,
      workspaceRoot: update.workspaceRoot ?? metadata.workspaceRoot,
      repoRevision: update.repoRevision !== undefined ? update.repoRevision : metadata.repoRevision,
      sourceRepository:
        update.sourceRepository !== undefined ? update.sourceRepository : metadata.sourceRepository,
      appDescription:
        update.appDescription !== undefined ? update.appDescription : metadata.appDescription,
      schemaSourceRevision:
        update.schemaSourceRevision !== undefined
          ? update.schemaSourceRevision
          : metadata.schemaSourceRevision,
      threadId: update.threadId !== undefined ? update.threadId : metadata.threadId,
      repaired: update.repaired ?? metadata.repaired,
      diagnostics: update.diagnostics
        ? serializeDiagnostics(update.diagnostics)
        : metadata.diagnostics,
      resolvedSchemaIds: update.resolvedSchemaIds ?? metadata.resolvedSchemaIds,
      buildSummary:
        update.buildSummary !== undefined ? update.buildSummary : (metadata.buildSummary ?? null),
      generatedSchema:
        update.generatedSchema !== undefined
          ? toGeneratedSchemaMetadata(update.generatedSchema, resolvedSchemaOut ?? null)
          : (metadata.generatedSchema ?? null),
      advanced:
        metadata.advanced || update.advanced
          ? {
              stageRecords: update.advanced?.stageRecords ?? metadata.advanced?.stageRecords,
              lastCompletedStage:
                update.advanced?.lastCompletedStage !== undefined
                  ? update.advanced.lastCompletedStage
                  : (metadata.advanced?.lastCompletedStage ?? null),
              restartFrom:
                update.advanced?.restartFrom !== undefined
                  ? update.advanced.restartFrom
                  : (metadata.advanced?.restartFrom ?? null),
              currentAdvancedThreadId:
                update.advanced?.currentAdvancedThreadId !== undefined
                  ? update.advanced.currentAdvancedThreadId
                  : (metadata.advanced?.currentAdvancedThreadId ?? null),
              currentNodeRefinementArtifact:
                update.advanced?.currentNodeRefinementArtifact !== undefined
                  ? update.advanced.currentNodeRefinementArtifact
                  : (metadata.advanced?.currentNodeRefinementArtifact ?? null),
              currentGraphArtifact:
                update.advanced?.currentGraphArtifact !== undefined
                  ? update.advanced.currentGraphArtifact
                  : (metadata.advanced?.currentGraphArtifact ?? null),
              currentGraphResponseArtifact:
                update.advanced?.currentGraphResponseArtifact !== undefined
                  ? update.advanced.currentGraphResponseArtifact
                  : (metadata.advanced?.currentGraphResponseArtifact ?? null),
              currentGraphReviewCompleted:
                update.advanced?.currentGraphReviewCompleted !== undefined
                  ? update.advanced.currentGraphReviewCompleted
                  : (metadata.advanced?.currentGraphReviewCompleted ?? false),
            }
          : undefined,
    });
  };

  await persistMetadata(metadata);

  logger.info(
    `Starting ${normalizedMode} diagram build with model ${modelLabel}, reasoning effort ${reasoningEffort}`,
  );
  logger.info(`Job metadata: ${path.join(resolvedJobRoot, 'out', 'job-metadata.json')}`);
  if (canResume && previousMetadata?.advanced?.lastCompletedStage) {
    logger.info(
      `Resuming advanced run from checkpoint ${previousMetadata.advanced.lastCompletedStage}${
        options.restartFrom ? ` with restart from ${options.restartFrom}` : ''
      }`,
    );
  } else if (options.hardRefresh) {
    logger.info('Starting with hard refresh; existing advanced checkpoints will be ignored');
  }

  const usageAccounting = new UsageAccounting(metadata.usageAccounting, async (state) => {
    await persistMetadata({ ...metadata, usageAccounting: state });
  });
  let preparedWorkspace: PreparedWorkspace | undefined;
  let generatedSchema: GeneratedSchemaResult = {
    status: 'not-requested',
    schemaId: resolvedSchemaId ?? 'repo/diagram',
    schemaRef: resolvedSchemaRef ?? 'repo/diagram@0.1',
    artifactPath: null,
    repaired: false,
    reused: false,
    usedByDiagram: false,
    threadId: null,
    diagnostics: [],
    failureMessage: null,
  };
  try {
    let repositoryContext: Awaited<ReturnType<RepositoryService['prepareRepositoryContext']>>;
    try {
      repositoryContext = await runTimedStep(
        {
          logger,
          label: 'repository workspace preparation',
          timings,
          detail: (result) => `revision ${result.workspace.repoRevision}`,
        },
        () =>
          repositoryService.prepareRepositoryContext({
            repo: rawRepo,
            ref: options.ref,
            schemaSource: resolvedSchemaSource,
            jobRoot: resolvedJobRoot,
            hardRefresh: options.hardRefresh,
            logger,
            onSecrets: (report, unmasked) => {
              reportSecrets(report, unmasked);
            },
            resume:
              canResume && previousMetadata
                ? {
                    expectedRepoRevision: previousMetadata.repoRevision,
                    expectedSchemaSourceRevision: previousMetadata.schemaSourceRevision,
                    allowMissingTargetRepo: canResumeWithoutTargetRepoClone,
                    requiredArtifactPaths: canResumeWithoutTargetRepoClone
                      ? ['analysis/repo-census.json']
                      : undefined,
                  }
                : undefined,
          }),
      );
    } catch (error) {
      if (error instanceof RepositoryServiceError) {
        const causeMessage =
          error.cause instanceof Error ? error.cause.message : String(error.cause ?? error);
        logger.error(`Repository workspace preparation cause: ${causeMessage}`);
        throw new BuildDiagramError(error.message, [], undefined, null, false, resolvedJobRoot, {
          cause: error.cause,
        });
      }
      throw error;
    }

    const { workspace, primaryDocumentInput } = repositoryContext;
    preparedWorkspace = workspace;
    reportSecrets(workspace.secrets ?? secrets);
    if (workspace.analysisReusable === false) {
      canResume = false;
      metadata.advanced =
        normalizedMode === 'advanced'
          ? createInitialJobMetadata({
              mode: normalizedMode,
              repo: options.repo,
              schemaSource: resolvedSchemaSource,
              outputPath: resolvedOutputPath,
              workspaceRoot: resolvedJobRoot,
            }).advanced
          : undefined;
    }
    retainPartialDocument({
      version: '0.1.0',
      schemaRefs: [],
      entities: [],
      relations: [],
      inputs: [primaryDocumentInput],
    });
    const sourceRepository = repositoryContext.sourceRepository ?? metadata.sourceRepository;
    await applyMetadataUpdate({
      workspaceRoot: workspace.jobRoot,
      repoRevision: workspace.repoRevision,
      sourceRepository,
      schemaSourceRevision: workspace.schemaSourceRevision ?? null,
      activeStage:
        normalizedMode === 'advanced' ? 'advanced/prompt-contract-preparation' : 'basic/generation',
    });

    logger.info(`Prepared workspace at ${workspace.jobRoot}`);
    logger.info(`Target repo revision: ${workspace.repoRevision}`);
    if (workspace.schemaSourceRevision) {
      logger.info(`Schema source revision: ${workspace.schemaSourceRevision}`);
    }

    if (resolvedSchemaOut && resolvedSchemaId) {
      await applyMetadataUpdate({ activeStage: 'schema-generation' });
      generatedSchema = await withUsageAccounting(usageAccounting, () =>
        runTimedStep(
          {
            logger,
            label: 'schema generation',
            timings,
            detail: (result) => `${result.status}${result.reused ? ', reused' : ''}`,
          },
          () =>
            generatedSchemaService.prepareGeneratedSchema({
              workspace,
              repo: options.repo,
              ref: options.ref,
              model: options.model,
              reasoningEffort,
              schemaId: resolvedSchemaId,
              logger,
              resumeDraft:
                canResume &&
                previousMetadata?.status === 'budget-exhausted' &&
                previousMetadata.repoRevision === workspace.repoRevision &&
                previousMetadata.schemaSourceRevision === (workspace.schemaSourceRevision ?? null),
              resume:
                canResume && previousMetadata?.generatedSchema
                  ? {
                      artifactPath: previousMetadata.generatedSchema.artifactPath,
                      status: previousMetadata.generatedSchema.status,
                    }
                  : undefined,
            }),
        ),
      );
      if (generatedSchema.status !== 'succeeded') {
        throw new BuildDiagramError(
          generatedSchema.failureMessage ??
            `Failed to generate schema ${generatedSchema.schemaRef}`,
          generatedSchema.diagnostics,
          workspace,
          generatedSchema.threadId,
          generatedSchema.repaired,
          workspace.jobRoot,
        );
      }
      await applyMetadataUpdate({
        activeStage: normalizedMode === 'advanced' ? 'advanced/pipeline' : 'basic/generation',
        generatedSchema,
      });
    } else {
      await applyMetadataUpdate({ generatedSchema });
    }

    let diagramResult: Awaited<ReturnType<AiDiagramService['generateDiagram']>>;
    try {
      await applyMetadataUpdate({
        activeStage: normalizedMode === 'advanced' ? 'advanced/pipeline' : 'basic/generation',
      });
      diagramResult = await withUsageAccounting(usageAccounting, () =>
        runTimedStep(
          {
            logger,
            label: `${normalizedMode} diagram generation`,
            timings,
            detail: (result) =>
              `thread ${result.threadId ?? 'none'}, repaired=${result.repaired}, schemaRefs=${result.resolvedSchemaIds.length}`,
          },
          () =>
            aiDiagramService.generateDiagram({
              workspace,
              repo: options.repo,
              ref: options.ref,
              model: options.model,
              reasoningEffort,
              stopAfter: options.stopAfter,
              nodeRefinementMaxDepth: options.nodeRefinementMaxDepth,
              graphifyHintsMode:
                normalizedMode === 'advanced' ? (options.graphifyHintsMode ?? 'auto') : 'off',
              primaryDocumentInput,
              logger,
              onProgress: async (update) => {
                await applyMetadataUpdate({
                  activeStage: update.activeStage,
                  threadId: update.threadId,
                  repaired: update.repaired,
                  diagnostics: update.diagnostics,
                  resolvedSchemaIds: update.resolvedSchemaIds,
                  advanced: update.advanced,
                });
              },
              resume:
                canResume && previousMetadata?.advanced
                  ? {
                      pendingCandidates:
                        previousMetadata.status === 'budget-exhausted' && !options.restartFrom,
                      advanced: {
                        stageRecords: previousMetadata.advanced.stageRecords,
                        lastCompletedStage: previousMetadata.advanced.lastCompletedStage,
                        restartFrom: options.restartFrom ?? null,
                        previousRepoRevision: previousMetadata.repoRevision,
                        previousSchemaSourceRevision: previousMetadata.schemaSourceRevision,
                        currentAdvancedThreadId: previousMetadata.advanced.currentAdvancedThreadId,
                        currentNodeRefinementArtifact:
                          previousMetadata.advanced.currentNodeRefinementArtifact,
                        currentGraphArtifact: previousMetadata.advanced.currentGraphArtifact,
                        currentGraphResponseArtifact:
                          previousMetadata.advanced.currentGraphResponseArtifact,
                        currentGraphReviewCompleted:
                          previousMetadata.advanced.currentGraphReviewCompleted ?? false,
                      },
                    }
                  : canResume &&
                      normalizedMode === 'basic' &&
                      previousMetadata?.repoRevision === workspace.repoRevision &&
                      previousMetadata?.schemaSourceRevision ===
                        (workspace.schemaSourceRevision ?? null)
                    ? { basic: true }
                    : undefined,
            }),
        ),
      );
    } catch (error) {
      if (error instanceof AiDiagramServiceError) {
        throw new BuildDiagramError(
          error.message,
          error.diagnostics,
          error.workspace,
          error.threadId,
          error.repaired,
          error.workspace.jobRoot,
          { cause: error },
        );
      }
      throw error;
    }

    const documentWithSchemas = {
      ...diagramResult.document,
      schemaRefs: dedupeSchemaActivations([
        ...diagramResult.document.schemaRefs,
        ...(generatedSchema.status === 'succeeded'
          ? [{ schema: generatedSchema.schemaRef, layer: 0 }]
          : []),
      ]),
    };
    const registry = await loadSchemaRegistry(workspace.schemaRepoPath);
    const { runtime } = buildSchemaRuntimeFromCatalog({
      catalog: await buildSchemaVersionCatalogFromRegistry(registry),
      activations: documentWithSchemas.schemaRefs,
    });
    const undirectedTypes = new Set(
      runtime.resolved.effectiveSchema.relations
        .filter((relation) => relation.directed === false)
        .map((relation) => relation.id),
    );
    const finalDocument = dedupeDocumentRelations(documentWithSchemas, (type) =>
      undirectedTypes.has(type),
    );

    const builtAt = new Date().toISOString();
    const buildSummary = summarizeWorkerBuild({
      document: finalDocument,
      mode: normalizedMode,
      ...summarizeStageSettings(metadata.advanced?.stageRecords, modelLabel, reasoningEffort),
      builtAt,
      durationMs: Math.max(0, Date.parse(builtAt) - startedAt),
      turns: currentTurnPolicy()?.turns || diagramResult.turnCount,
      tokenUsage:
        usageAccounting.snapshot().reportedTurns > 0
          ? usageAccounting.snapshot().totals
          : diagramResult.tokenUsage,
    });
    const appDescription =
      normalizeAppDescriptionText(diagramResult.appDescription) ?? metadata.appDescription;
    const finalOutputDocument = await redactForOutput(
      applyBuildMetadataToDocument(finalDocument, {
        workerBuild: buildSummary,
        sourceRepository,
        appDescription,
      }),
    );
    generatedSchema = {
      ...generatedSchema,
      usedByDiagram: finalOutputDocument.schemaRefs.some(
        (activation) => activation.schema === generatedSchema.schemaRef,
      ),
    };
    const finalOutputYaml = `${serializeDocument(finalOutputDocument).trimEnd()}\n`;
    if (resolvedSchemaOut && generatedSchema.artifactPath) {
      await fs.mkdir(path.dirname(resolvedSchemaOut), { recursive: true });
      const rawSchema = await fs.readFile(generatedSchema.artifactPath, 'utf8');
      const schema = parseYamlText(rawSchema);
      const priorRedactions = secrets.redactedFromOutput;
      const redactedSchema = await redactForOutput(schema, 'schema');
      await writeFileAtomic(
        resolvedSchemaOut,
        secrets.redactedFromOutput === priorRedactions
          ? rawSchema
          : dumpYaml(redactedSchema, { noRefs: true, lineWidth: -1 }),
      );
      generatedSchema = {
        ...generatedSchema,
        artifactPath: resolvedSchemaOut,
      };
    }

    await applyMetadataUpdate({
      activeStage: 'output-artifact-write',
      threadId: diagramResult.threadId,
      repaired: diagramResult.repaired,
      diagnostics: diagramResult.diagnostics,
      resolvedSchemaIds: diagramResult.resolvedSchemaIds,
      sourceRepository,
      appDescription,
      generatedSchema,
      buildSummary,
    });
    throwIfCancelled();
    const partialOutputPath = derivePartialOutputPath(resolvedOutputPath);
    const stopped = normalizedMode === 'advanced' && Boolean(options.stopAfter);
    const destination = stopped ? partialOutputPath : resolvedOutputPath;
    const outputPath = await runTimedStep(
      {
        logger,
        label: 'output artifact write',
        timings,
        detail: (resolvedPath) => resolvedPath,
      },
      async () => {
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await writeFileAtomic(destination, finalOutputYaml);
        if (!stopped) await fs.rm(partialOutputPath, { force: true });
        return destination;
      },
    );
    await applyMetadataUpdate({
      activeStage: null,
      status: stopped ? 'stopped' : 'succeeded',
      failureMessage: null,
      finishedAt: builtAt,
      threadId: diagramResult.threadId,
      repaired: diagramResult.repaired,
      diagnostics: diagramResult.diagnostics,
      resolvedSchemaIds: diagramResult.resolvedSchemaIds,
      sourceRepository,
      appDescription,
      generatedSchema,
      buildSummary,
    });

    logger.info(`Wrote validated diagram to ${outputPath}`);
    logger.info(`Job artifacts available at ${workspace.workspaceOutputDir}`);
    buildSucceeded = true;

    return {
      secrets,
      outputPath,
      workspace,
      threadId: diagramResult.threadId,
      repaired: diagramResult.repaired,
      diagnostics: [...diagramResult.diagnostics, ...redactionDiagnostics],
      resolvedSchemaIds: diagramResult.resolvedSchemaIds,
      mode: normalizedMode,
      generatedSchema,
      buildSummary,
    };
  } catch (error) {
    const budgetError = findTurnBudgetError(error);
    const policy = currentTurnPolicy();
    if (budgetError && preparedWorkspace && policy?.partialDocument) {
      throwIfCancelled();
      const document = await redactForOutput(policy.partialDocument);
      const outputPath = derivePartialOutputPath(resolvedOutputPath);
      const builtAt = new Date().toISOString();
      const buildSummary = summarizeWorkerBuild({
        document,
        mode: normalizedMode,
        model: modelLabel,
        reasoningEffort,
        builtAt,
        durationMs: Math.max(0, Date.parse(builtAt) - startedAt),
        turns: policy.turns,
        tokenUsage: usageAccounting.snapshot().totals,
      });
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await writeFileAtomic(outputPath, `${serializeDocument(document).trimEnd()}\n`);
      await applyMetadataUpdate({
        status: 'budget-exhausted',
        failureMessage: null,
        finishedAt: builtAt,
      });
      logger.info(budgetError.message);
      buildSucceeded = true;
      return {
        secrets,
        outputPath,
        workspace: preparedWorkspace,
        threadId: metadata.threadId ?? null,
        repaired: metadata.repaired ?? false,
        diagnostics: [...redactionDiagnostics],
        resolvedSchemaIds: metadata.resolvedSchemaIds ?? [],
        mode: normalizedMode,
        generatedSchema,
        buildSummary,
      };
    }
    const failureMessage = error instanceof Error ? error.message : String(error);
    try {
      await applyMetadataUpdate({
        status: currentCancellationSignal()?.aborted ? 'interrupted' : 'failed',
        failureMessage,
        finishedAt: new Date().toISOString(),
        diagnostics: error instanceof BuildDiagramError ? error.diagnostics : undefined,
        threadId: error instanceof BuildDiagramError ? error.threadId : undefined,
        repaired: error instanceof BuildDiagramError ? error.repaired : undefined,
      });
    } catch (metadataError) {
      logger.error(
        `Failed to write job metadata: ${
          metadataError instanceof Error ? metadataError.message : String(metadataError)
        }`,
      );
    }
    if (error instanceof BuildDiagramError) throw error;
    throw new BuildDiagramError(
      failureMessage,
      [],
      preparedWorkspace,
      metadata.threadId ?? null,
      metadata.repaired ?? false,
      resolvedJobRoot,
      { cause: error },
    );
  } finally {
    if (timings.length > 0) {
      logger.info(`Build section timings: ${formatTimingSummary(timings)}`);
    }
    const elapsed = formatDuration(Date.now() - startedAt);
    if (buildSucceeded) {
      logger.info(`Build completed in ${elapsed}`);
    } else {
      logger.error(`Build failed after ${elapsed}`);
    }
  }
}

export function derivePartialOutputPath(outputPath: string): string {
  const extension = path.extname(outputPath);
  return extension
    ? `${outputPath.slice(0, -extension.length)}.partial${extension}`
    : `${outputPath}.partial.yaml`;
}
