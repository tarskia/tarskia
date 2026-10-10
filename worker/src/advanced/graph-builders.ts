import type { AdvancedBuildPromptRunner } from '../codex/advanced-thread-manager';
import type { DiagramPromptPackage } from '../codex/prompt-package';
import type { Logger } from '../logger';
import type {
  Diagnostic,
  DocumentInput,
  SchemaActivation,
  SchemaSemantics,
  SemanticDocument,
} from '../semantic';
import type { TokenUsageTotals } from '../token-usage';
import type { PreparedWorkspace } from '../workspace';
import type { GraphifyHints } from './graphify-hints';
import type { SchemaFlowCatalog } from './schema-flow-catalog';
import type {
  AreaPlan,
  FinalGraphReviewSummary,
  FlowBuildState,
  NodeRefinementResult,
  NodeRefinementState,
  NodeRefinementSurroundingContext,
  NodeRefinementTask,
  RepoCensus,
  SchemaRefCandidate,
  Wave1ReviewPatch,
  Wave1ReviewSummary,
} from './types';

export interface Level0BackboneBuilderInput {
  semantics: SchemaSemantics;
  workspace: PreparedWorkspace;
  repo: string;
  ref?: string;
  repoCensus: RepoCensus;
  graphifyHints?: GraphifyHints;
  areaPlan: AreaPlan;
  activeSchemaRefs: SchemaActivation[];
  candidateSchemaRefs: SchemaRefCandidate[];
  schemaFlowCatalog: SchemaFlowCatalog;
  schemaValidationCommand?: string;
  promptPackage: DiagramPromptPackage;
  logger: Logger;
  promptRunner?: AdvancedBuildPromptRunner;
  handoffArtifactPath?: string;
}

export interface Level0BackboneBuilderResult {
  rawYaml: string;
  doc: SemanticDocument;
  rawResponse: string;
  threadId: string | null;
  tokenUsage?: TokenUsageTotals;
}

export interface Level0BackboneBuilder {
  buildLevel0Backbone(input: Level0BackboneBuilderInput): Promise<Level0BackboneBuilderResult>;
}

export interface Level0BackboneRepairerInput extends Level0BackboneBuilderInput {
  previousBackboneYaml: string;
  diagnostics: Diagnostic[];
  flowBuildState: FlowBuildState;
  attempt: number;
}

export interface Level0BackboneRepairerResult {
  rawYaml: string;
  doc: SemanticDocument;
  rawResponse: string;
  threadId: string | null;
  tokenUsage?: TokenUsageTotals;
}

export interface Level0BackboneRepairer {
  repairLevel0Backbone(input: Level0BackboneRepairerInput): Promise<Level0BackboneRepairerResult>;
}

export interface Level0BackboneReviewerInput extends Level0BackboneBuilderInput {
  currentBackboneYaml: string;
  flowBuildState: FlowBuildState;
}

export interface Level0BackboneReviewerResult {
  rawYaml: string;
  doc: SemanticDocument;
  rawResponse: string;
  threadId: string | null;
  tokenUsage?: TokenUsageTotals;
}

export interface Level0BackboneReviewer {
  reviewLevel0Backbone(input: Level0BackboneReviewerInput): Promise<Level0BackboneReviewerResult>;
}

export interface Level0BackboneReviewerRepairerInput extends Level0BackboneBuilderInput {
  previousReviewYaml: string;
  diagnostics: Diagnostic[];
  flowBuildState: FlowBuildState;
  attempt: number;
}

export interface Level0BackboneReviewerRepairer {
  repairLevel0BackboneReview(
    input: Level0BackboneReviewerRepairerInput,
  ): Promise<Level0BackboneReviewerResult>;
}

export interface Wave1ReviewerInput extends Level0BackboneBuilderInput {
  level0BackboneYaml: string;
  flowBuildState: FlowBuildState;
  wave1DocumentYaml: string;
  wave1Summary: Wave1ReviewSummary;
}

export interface Wave1ReviewerResult {
  patch: Wave1ReviewPatch;
  rawResponse: string;
  threadId: string | null;
  tokenUsage?: TokenUsageTotals;
}

export interface Wave1Reviewer {
  reviewWave1(input: Wave1ReviewerInput): Promise<Wave1ReviewerResult>;
}

export interface Wave1ReviewerRepairerInput extends Wave1ReviewerInput {
  candidateWave1DocumentYaml?: string;
  previousPatch: Wave1ReviewPatch;
  diagnostics: Diagnostic[];
  attempt: number;
}

export interface Wave1ReviewerRepairer {
  repairWave1Review(input: Wave1ReviewerRepairerInput): Promise<Wave1ReviewerResult>;
}

export interface NodeRefinerInput {
  childrenCanExpand?: boolean;
  workspace: PreparedWorkspace;
  repo: string;
  ref?: string;
  repoCensus: RepoCensus;
  areaPlan: AreaPlan;
  task: NodeRefinementTask;
  activeSchemaRefs: SchemaActivation[];
  candidateSchemaRefs: SchemaRefCandidate[];
  allowedChildTypeIds: string[];
  relationMatrix: Record<string, Record<string, string[]>>;
  schemaFlowCatalog: SchemaFlowCatalog;
  surroundingContext: NodeRefinementSurroundingContext;
  validationCommand?: string;
  schemaValidationCommand?: string;
  promptPackage: DiagramPromptPackage;
  logger: Logger;
  promptRunner?: AdvancedBuildPromptRunner;
  handoffArtifactPath?: string;
}

export interface NodeRefinerResult {
  result: NodeRefinementResult;
  rawResponse: string;
  threadId: string | null;
  tokenUsage?: TokenUsageTotals;
}

export interface NodeRefiner {
  refineNode(input: NodeRefinerInput): Promise<NodeRefinerResult>;
}

export interface NodeRefinerRepairInput extends NodeRefinerInput {
  previousResult: NodeRefinementResult;
  diagnostics: Diagnostic[];
  attempt: number;
}

export interface NodeRefinerRepairer {
  repairNode(input: NodeRefinerRepairInput): Promise<NodeRefinerResult>;
}

export interface GraphCollatorInput {
  semantics: SchemaSemantics;
  workspace: PreparedWorkspace;
  repo: string;
  ref?: string;
  repoCensus: RepoCensus;
  graphifyHints?: GraphifyHints;
  areaPlan: AreaPlan;
  nodeRefinementState: NodeRefinementState;
  assembledDoc: SemanticDocument;
  level0Backbone: FlowBuildState;
  activeSchemaRefs: SchemaActivation[];
  schemaFlowCatalog: SchemaFlowCatalog;
  schemaValidationCommand?: string;
  promptPackage: DiagramPromptPackage;
  primaryDocumentInput: DocumentInput;
  logger: Logger;
  promptRunner?: AdvancedBuildPromptRunner;
  handoffArtifactPath?: string;
}

export interface GraphCollatorResult {
  rawYaml: string;
  doc: SemanticDocument;
  rawResponse: string;
  threadId: string | null;
  tokenUsage?: TokenUsageTotals;
}

export interface GraphCollator {
  collateGraph(input: GraphCollatorInput): Promise<GraphCollatorResult>;
}

export interface GraphCollatorRepairInput extends GraphCollatorInput {
  previousYaml: string;
  diagnostics: Diagnostic[];
  attempt: number;
}

export interface GraphCollatorRepairer {
  repairGraph(input: GraphCollatorRepairInput): Promise<GraphCollatorResult>;
}

export interface FinalGraphReviewerInput extends GraphCollatorInput {
  currentFinalGraphYaml: string;
  finalReviewSummary: FinalGraphReviewSummary;
}

export interface FinalGraphReviewerResult {
  rawYaml: string;
  doc: SemanticDocument;
  rawResponse: string;
  threadId: string | null;
  tokenUsage?: TokenUsageTotals;
}

export interface FinalGraphReviewer {
  reviewFinalGraph(input: FinalGraphReviewerInput): Promise<FinalGraphReviewerResult>;
}

export interface FinalGraphReviewerRepairerInput extends GraphCollatorInput {
  finalReviewSummary: FinalGraphReviewSummary;
  previousReviewYaml: string;
  diagnostics: Diagnostic[];
  attempt: number;
}

export interface FinalGraphReviewerRepairer {
  repairFinalGraphReview(input: FinalGraphReviewerRepairerInput): Promise<FinalGraphReviewerResult>;
}
