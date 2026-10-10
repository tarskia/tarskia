import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { StageRecords } from './advanced/checkpoint-inputs';
import type { GraphifyHintsMode } from './advanced/graphify-hints';
import type { AdvancedCheckpointStage } from './advanced/types';
import { writeWorkspaceArtifact, writeWorkspaceJsonArtifact } from './artifacts';
import { CodexDiagramAgent, type DiagramAgent } from './codex/diagram-agent';
import { buildDiagramPromptPackage } from './codex/prompt-package';
import { retainPartialDocument } from './codex/turn-policy';
import { serializeDiagnostics } from './job-metadata';
import {
  formatDuration,
  formatTimingSummary,
  type Logger,
  runTimedStep,
  type TimingEntry,
} from './logger';
import type { ReasoningEffort } from './reasoning-effort';
import { runRepairableStage } from './run-repairable-stage';
import {
  type Diagnostic,
  type DocumentInput,
  loadSchemaRegistry,
  parseDocument,
  type SemanticDocument,
  STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
  serializeDocument,
  sortDiagnostics,
  validateDiagramYaml,
} from './semantic';
import { buildDiagramSynthesisContract } from './semantic/diagram-synthesis-contract';
import {
  addTokenUsageTotals,
  emptyTokenUsageTotals,
  type TokenUsageTotals,
  tokenUsageFromSdkUsage,
} from './token-usage';
import type { PreparedWorkspace } from './workspace';

export interface GenerateDiagramOptions {
  workspace: PreparedWorkspace;
  repo: string;
  ref?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  stopAfter?: AdvancedCheckpointStage;
  nodeRefinementMaxDepth?: number;
  graphifyHintsMode?: GraphifyHintsMode;
  primaryDocumentInput: DocumentInput;
  logger: Logger;
  onProgress?: (update: DiagramGenerationProgressUpdate) => Promise<void> | void;
  resume?: DiagramGenerationResumeOptions;
}

export interface GenerateDiagramResult {
  finalYaml: string;
  document: SemanticDocument;
  threadId: string | null;
  repaired: boolean;
  diagnostics: Diagnostic[];
  resolvedSchemaIds: string[];
  turnCount: number;
  tokenUsage: TokenUsageTotals;
  appDescription?: string | null;
}

export interface DiagramGenerationProgressUpdate {
  activeStage?: string | null;
  threadId?: string | null;
  repaired?: boolean;
  diagnostics?: Diagnostic[];
  resolvedSchemaIds?: string[];
  advanced?: {
    stageRecords?: StageRecords;
    lastCompletedStage?: AdvancedCheckpointStage | null;
    currentAdvancedThreadId?: string | null;
    currentNodeRefinementArtifact?: string | null;
    currentGraphArtifact?: string | null;
    currentGraphResponseArtifact?: string | null;
    currentGraphReviewCompleted?: boolean;
  };
}

export interface DiagramGenerationResumeOptions {
  basic?: boolean;
  pendingCandidates?: boolean;
  advanced?: {
    stageRecords?: StageRecords;
    lastCompletedStage: AdvancedCheckpointStage | null;
    restartFrom: AdvancedCheckpointStage | null;
    previousRepoRevision: string | null;
    previousSchemaSourceRevision: string | null;
    currentAdvancedThreadId: string | null;
    currentNodeRefinementArtifact: string | null;
    currentGraphArtifact: string | null;
    currentGraphResponseArtifact: string | null;
    currentGraphReviewCompleted: boolean;
  };
}

export interface AiDiagramService {
  generateDiagram(options: GenerateDiagramOptions): Promise<GenerateDiagramResult>;
}

export class AiDiagramServiceError extends Error {
  readonly diagnostics: Diagnostic[];
  readonly workspace: PreparedWorkspace;
  readonly threadId: string | null;
  readonly repaired: boolean;

  constructor(
    message: string,
    diagnostics: Diagnostic[],
    workspace: PreparedWorkspace,
    threadId: string | null,
    repaired: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AiDiagramServiceError';
    this.diagnostics = diagnostics;
    this.workspace = workspace;
    this.threadId = threadId;
    this.repaired = repaired;
  }
}

const MAX_REPAIR_ATTEMPTS = 3;

function formatRepairPassCount(count: number): string {
  return `${count} repair ${count === 1 ? 'pass' : 'passes'}`;
}

async function writeDiagnosticsArtifact(
  workspace: PreparedWorkspace,
  fileName: string,
  diagnostics: Diagnostic[],
): Promise<string> {
  return writeWorkspaceJsonArtifact(workspace, fileName, serializeDiagnostics(diagnostics));
}

export class DefaultAiDiagramService implements AiDiagramService {
  private readonly agent?: DiagramAgent;

  constructor(dependencies: { agent?: DiagramAgent } = {}) {
    this.agent = dependencies.agent;
  }

  private resolveAgent(model?: string, reasoningEffort?: ReasoningEffort): DiagramAgent {
    return this.agent ?? new CodexDiagramAgent({ model, modelReasoningEffort: reasoningEffort });
  }

  async generateDiagram(options: GenerateDiagramOptions): Promise<GenerateDiagramResult> {
    const { workspace, repo, ref, model, reasoningEffort, primaryDocumentInput, logger } = options;
    const startedAt = Date.now();
    const timings: TimingEntry[] = [];
    let turnCount = 0;
    let tokenUsage = emptyTokenUsageTotals();
    try {
      const schemaRegistry = await runTimedStep(
        {
          logger,
          label: 'basic schema registry load',
          timings,
          detail: (result) => `${result.modulesById.size} modules`,
        },
        () => loadSchemaRegistry(workspace.schemaRepoPath),
      );
      const promptPackage = await runTimedStep(
        {
          logger,
          label: 'basic prompt contract preparation',
          timings,
        },
        async () => {
          const result = buildDiagramPromptPackage(buildDiagramSynthesisContract(schemaRegistry));
          await writeWorkspaceArtifact(workspace, 'meta-ontology.md', result.metaOntologyMarkdown);
          await writeWorkspaceArtifact(workspace, 'prompt-contract.md', result.renderedContract);
          await writeWorkspaceArtifact(workspace, 'schema-catalog.json', result.schemaCatalogJson);
          return result;
        },
      );

      const agent = this.resolveAgent(model, reasoningEffort);
      let saved: { yaml: string; repairAttemptCount: number } | undefined;
      const checkpointName = 'basic-draft-checkpoint.json';
      if (options.resume?.basic) {
        try {
          const candidate: unknown = JSON.parse(
            await fs.readFile(path.join(workspace.workspaceOutputDir, checkpointName), 'utf8'),
          );
          if (
            !candidate ||
            typeof candidate !== 'object' ||
            !('yaml' in candidate) ||
            typeof candidate.yaml !== 'string' ||
            !('repairAttemptCount' in candidate) ||
            typeof candidate.repairAttemptCount !== 'number' ||
            !Number.isSafeInteger(candidate.repairAttemptCount) ||
            candidate.repairAttemptCount < 0 ||
            candidate.repairAttemptCount > MAX_REPAIR_ATTEMPTS
          )
            throw new Error('invalid basic draft checkpoint shape');
          saved = { yaml: candidate.yaml, repairAttemptCount: candidate.repairAttemptCount };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            logger.warn(
              `Recomputing basic draft: ${checkpointName}: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
      }
      const checkpoint = async (yaml: string, repairAttemptCount: number) => {
        await writeWorkspaceJsonArtifact(workspace, checkpointName, { yaml, repairAttemptCount });
        try {
          retainPartialDocument(parseDocument(yaml));
        } catch {
          /* Invalid draft remains resumable repair input, not partial diagram content. */
        }
      };
      const draft = saved
        ? { yaml: saved.yaml, threadId: null, usage: null }
        : await runTimedStep(
            {
              logger,
              label: 'basic draft turn',
              timings,
              detail: (result) => `thread ${result.threadId ?? 'none'}`,
            },
            () =>
              agent.analyzeAndDraftDiagram({
                workspaceRoot: workspace.jobRoot,
                targetRepoPath: workspace.targetRepoPath,
                schemaRepoPath: workspace.schemaRepoPath,
                repoUrl: repo,
                ref,
                repoRevision: workspace.repoRevision,
                promptPackage,
              }),
          );
      if (!saved) turnCount += 1;
      tokenUsage = addTokenUsageTotals(tokenUsage, tokenUsageFromSdkUsage(draft.usage));
      await checkpoint(draft.yaml, saved?.repairAttemptCount ?? 0);
      await writeWorkspaceArtifact(workspace, 'draft.yaml', draft.yaml);

      let validation = await runTimedStep(
        {
          logger,
          label: 'basic draft validation',
          timings,
          detail: (result) =>
            result.ok
              ? `resolved ${result.resolvedSchemaIds.length} schema refs`
              : `${result.diagnostics.length} diagnostics`,
        },
        async () =>
          validateDiagramYaml({
            yaml: draft.yaml,
            schemaRegistry,
            documentInputs: [primaryDocumentInput],
            validationOptions: STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
          }),
      );
      let finalThreadId = draft.threadId;
      let repaired = false;
      let currentYaml = draft.yaml;
      let repairAttemptCount = saved?.repairAttemptCount ?? 0;

      await runRepairableStage({
        maxRepairs: MAX_REPAIR_ATTEMPTS,
        repairCount: () => repairAttemptCount,
        evaluate: () => ({
          valid: validation.ok,
          // Final validation below owns the diagnostic artifact and failure message.
          accept: () => undefined,
          exhausted: () => undefined,
          repair: async () => {
            repaired = true;
            const diagnostics = sortDiagnostics(validation.diagnostics);
            logger.warn(
              `${
                repairAttemptCount === 0 ? 'Initial draft' : `Repair pass ${repairAttemptCount}`
              } failed validation with ${diagnostics.length} diagnostic(s); running repair pass ${
                repairAttemptCount + 1
              } of ${MAX_REPAIR_ATTEMPTS}`,
            );
            await writeDiagnosticsArtifact(
              workspace,
              repairAttemptCount === 0
                ? 'draft-diagnostics.json'
                : `repair-${repairAttemptCount}-diagnostics.json`,
              diagnostics,
            );

            const repairedTurn = await runTimedStep(
              {
                logger,
                label: `basic repair turn ${repairAttemptCount + 1}/${MAX_REPAIR_ATTEMPTS}`,
                timings,
                detail: (result) => `thread ${result.threadId ?? 'none'}`,
              },
              () =>
                agent.repairDiagram({
                  workspaceRoot: workspace.jobRoot,
                  targetRepoPath: workspace.targetRepoPath,
                  schemaRepoPath: workspace.schemaRepoPath,
                  repoUrl: repo,
                  ref,
                  repoRevision: workspace.repoRevision,
                  promptPackage,
                  previousYaml: currentYaml,
                  diagnostics,
                }),
            );
            turnCount += 1;
            tokenUsage = addTokenUsageTotals(
              tokenUsage,
              tokenUsageFromSdkUsage(repairedTurn.usage),
            );
            repairAttemptCount += 1;
            currentYaml = repairedTurn.yaml;
            await checkpoint(currentYaml, repairAttemptCount);
            await writeWorkspaceArtifact(
              workspace,
              `repair-${repairAttemptCount}.yaml`,
              repairedTurn.yaml,
            );
            validation = await runTimedStep(
              {
                logger,
                label: `basic repair validation ${repairAttemptCount}/${MAX_REPAIR_ATTEMPTS}`,
                timings,
                detail: (result) =>
                  result.ok
                    ? `resolved ${result.resolvedSchemaIds.length} schema refs`
                    : `${result.diagnostics.length} diagnostics`,
              },
              async () =>
                validateDiagramYaml({
                  yaml: repairedTurn.yaml,
                  schemaRegistry,
                  documentInputs: [primaryDocumentInput],
                  validationOptions: STRICT_WORKER_GENERATED_DIAGRAM_VALIDATION_OPTIONS,
                }),
            );
            finalThreadId = repairedTurn.threadId;
          },
        }),
      });

      if (!validation.ok || !validation.document) {
        const diagnostics = sortDiagnostics(validation.diagnostics);
        await writeDiagnosticsArtifact(workspace, 'final-diagnostics.json', diagnostics);
        throw new AiDiagramServiceError(
          `Generated diagram did not validate after ${formatRepairPassCount(MAX_REPAIR_ATTEMPTS)}`,
          diagnostics,
          workspace,
          finalThreadId,
          repaired,
        );
      }

      const finalYaml = serializeDocument(validation.document);
      await writeWorkspaceArtifact(workspace, 'final.yaml', finalYaml);

      return {
        finalYaml,
        document: validation.document,
        threadId: finalThreadId,
        repaired,
        diagnostics: validation.diagnostics,
        resolvedSchemaIds: validation.resolvedSchemaIds,
        turnCount,
        tokenUsage,
      };
    } finally {
      if (timings.length > 0) {
        logger.info(`Basic pipeline timings: ${formatTimingSummary(timings)}`);
      }
      logger.info(`Basic pipeline finished in ${formatDuration(Date.now() - startedAt)}`);
    }
  }
}
