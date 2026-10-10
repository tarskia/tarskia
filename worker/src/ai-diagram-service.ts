import type { StageRecords } from './advanced/checkpoint-inputs';
import type { GraphifyHintsMode } from './advanced/graphify-hints';
import type { AdvancedCheckpointStage } from './advanced/types';
import type { Logger } from './logger';
import type { ReasoningEffort } from './reasoning-effort';
import type { Diagnostic, DocumentInput, SemanticDocument } from './semantic';
import type { TokenUsageTotals } from './token-usage';
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
