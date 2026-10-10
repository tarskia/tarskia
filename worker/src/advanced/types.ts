import type { Diagnostic, ResolvedFlowRole, SchemaActivation, SemanticDocument } from '../semantic';
import type { TokenUsageTotals } from '../token-usage';

export const ADVANCED_CHECKPOINT_STAGES = [
  'repo-census',
  'area-plan',
  'level0-backbone',
  'level0-review',
  'node-refinement',
  'graph-collation',
  'final-review',
  'bundle-compile',
] as const;
export type AdvancedCheckpointStage = (typeof ADVANCED_CHECKPOINT_STAGES)[number];

const ADVANCED_CHECKPOINT_STAGE_RANK = new Map(
  ADVANCED_CHECKPOINT_STAGES.map((stage, index) => [stage, index]),
);

export function parseAdvancedCheckpointStage(
  value?: string | null,
): AdvancedCheckpointStage | undefined {
  const normalized = value?.trim().toLowerCase();
  return ADVANCED_CHECKPOINT_STAGES.find((stage) => stage === normalized);
}

export function compareAdvancedCheckpointStage(
  left: AdvancedCheckpointStage,
  right: AdvancedCheckpointStage,
): number {
  return (
    (ADVANCED_CHECKPOINT_STAGE_RANK.get(left) ?? Number.MAX_SAFE_INTEGER) -
    (ADVANCED_CHECKPOINT_STAGE_RANK.get(right) ?? Number.MAX_SAFE_INTEGER)
  );
}

export type ResponsibilityConfidence = 'low' | 'medium' | 'high';
export type ExplorationPolicy = 'finish-or-split' | 'finish-only';
export type ResponsibilityEdgeDirection = 'inbound' | 'outbound';
export type FlowBoundarySide = 'ingress' | 'egress';
export type FlowTerminationReason = 'boundary' | 'exhausted';
export type NodeQueueDecision = 'leaf' | 'expand';
export type GroupMode = 'mixed' | 'typed';

export const NODE_REFINEMENT_SOFT_LIMITS = {
  maxChildrenPerNode: 8,
  maxExpandableChildrenPerNode: 5,
} as const;
export type ResponsibilityEdgeStatus =
  | 'unresolved'
  | 'proposed'
  | 'matched'
  | 'superseded'
  | 'blocked';
export type EdgeProposalSpecificity = 'root' | 'actor';
export type EdgeExpectationStatus =
  | 'open'
  | 'partially-proposed'
  | 'matched'
  | 'conflicted'
  | 'finalized';

export interface RepoCensusFileEntry {
  path: string;
  directory: string;
  fileName: string;
  extension: string | null;
  language: string;
  lineCount: number;
  byteCount: number;
}

export interface RepoCensusDirectorySummary {
  path: string;
  fileCount: number;
  lineCount: number;
  languages: Record<string, number>;
}

export interface RepoCensusManifest {
  path: string;
  kind: string;
}

export interface RepoCensusSignal {
  path: string;
  kind: string;
  confidence: ResponsibilityConfidence;
  reason: string;
}

export interface RepoCensusSummary {
  totalFiles: number;
  totalDirectories: number;
  totalLines: number;
  languages: Record<string, number>;
  topLevelPaths: RepoCensusDirectorySummary[];
}

export interface RepoCensus {
  repoUrl: string;
  requestedRef?: string;
  repoRevision: string;
  repoRoot: string;
  generatedAt: string;
  summary: RepoCensusSummary;
  directories: RepoCensusDirectorySummary[];
  manifests: RepoCensusManifest[];
  signals: RepoCensusSignal[];
  files: RepoCensusFileEntry[];
}

export type ConceptKind =
  | 'frontend'
  | 'service'
  | 'async-plane'
  | 'runtime-plane'
  | 'datastore'
  | 'protocol-surface'
  | 'shared-kernel'
  | 'integration'
  | 'external'
  | 'unknown';

export interface ConceptPlanEvidence {
  path: string;
  reason: string;
}

export interface SchemaRefCandidate {
  schemaRef: string;
  suggestedLayer: number;
  rationale: string;
  evidence: ConceptPlanEvidence[];
}

export interface AdvisoryConcept {
  id: string;
  kind: ConceptKind;
  title: string;
  paths: string[];
  rationale: string;
  evidence: ConceptPlanEvidence[];
  groupingHints: string[];
  openQuestions: string[];
}

export interface ConceptPlan {
  repoSummary: string;
  galleryDescription?: string;
  initialSchemaActivations: SchemaActivation[];
  candidateSchemaRefs: SchemaRefCandidate[];
  keyConcepts?: AdvisoryConcept[];
  areas?: AdvisoryConcept[];
}

export type AreaPlanEvidence = ConceptPlanEvidence;
export type PlannedArea = AdvisoryConcept;
export type AreaPlan = ConceptPlan;

export interface ResponsibilityEdgeLocalProposal {
  ownerLocalId: string;
  specificity: EdgeProposalSpecificity;
  depth: number;
  confidence: ResponsibilityConfidence;
  rationale: string;
  evidence: ConceptPlanEvidence[];
  absoluteChildId?: string;
  relationTypeId?: string;
}

export interface ResponsibilityEdgeState {
  expectationId: string;
  direction: ResponsibilityEdgeDirection;
  kind: string;
  summary: string;
  otherResponsibilityId: string;
  evidence: ConceptPlanEvidence[];
  localProposal?: ResponsibilityEdgeLocalProposal;
  status: ResponsibilityEdgeStatus;
}

export interface ResponsibilityWorkItem {
  id: string;
  parentId?: string;
  lineage: string[];
  namespace: string;
  title: string;
  responsibility: string;
  scope: string[];
  evidence: ConceptPlanEvidence[];
  exclusions: string[];
  openQuestions: string[];
  confidence: ResponsibilityConfidence;
  incidentEdges: ResponsibilityEdgeState[];
  depth: number;
  policy: ExplorationPolicy;
  minimumFinishedDepth: number;
}

export interface ResponsibilityStub {
  id: string;
  title: string;
  responsibility: string;
  namespace: string;
  lineage: string[];
  depth: number;
}

export interface ChildResponsibilityHypothesis {
  slug: string;
  title: string;
  responsibility: string;
  scope: string[];
  evidence: ConceptPlanEvidence[];
  exclusions: string[];
  openQuestions: string[];
  confidence: ResponsibilityConfidence;
}

export interface EdgeRoutingDecision {
  expectationId: string;
  childSlugs: string[];
  rationale: string;
}

export interface NewExpectationClaim {
  direction: ResponsibilityEdgeDirection;
  otherResponsibility: string;
  kind: string;
  summary: string;
  confidence: ResponsibilityConfidence;
  evidence: AreaPlanEvidence[];
  ownerLocalId?: string;
  rationale?: string;
}

export interface SplitResponsibilityResult {
  decision: 'split';
  rationale: string;
  children: ChildResponsibilityHypothesis[];
  expectationRouting: EdgeRoutingDecision[];
  newExpectations: NewExpectationClaim[];
}

export interface LocalActorSpec {
  localId: string;
  role: string;
  title: string;
  responsibility: string;
  kindHint: string;
  evidence: AreaPlanEvidence[];
  children?: LocalActorSpec[];
}

export interface LocalRelationSpec {
  localId: string;
  kind: string;
  summary: string;
  fromLocalId: string;
  toLocalId: string;
  evidence: AreaPlanEvidence[];
}

export interface ExpectationOwnership {
  expectationId: string;
  ownerLocalId: string;
  specificity: EdgeProposalSpecificity;
  rationale: string;
  confidence: ResponsibilityConfidence;
  evidence: AreaPlanEvidence[];
}

export interface FinishedResponsibilitySpec {
  workItemId: string;
  lineage: string[];
  namespace: string;
  title: string;
  responsibility: string;
  summary: string;
  scope: string[];
  evidence: AreaPlanEvidence[];
  exclusions: string[];
  openQuestions: string[];
  confidence: ResponsibilityConfidence;
  root: LocalActorSpec;
  actors: LocalActorSpec[];
  internalRelations: LocalRelationSpec[];
  inboundOwnership: ExpectationOwnership[];
  outboundOwnership: ExpectationOwnership[];
  completion: {
    reason: 'sufficiently-coherent' | 'budget-forced';
    whyNotSplitFurther: string;
  };
}

export interface FinishResponsibilityResult {
  decision: 'finish';
  rationale: string;
  spec: FinishedResponsibilitySpec;
  newExpectations: NewExpectationClaim[];
}

export type ExploreResponsibilityResult = SplitResponsibilityResult | FinishResponsibilityResult;

export interface EdgeExpectationSide {
  responsibilityId: string;
  proposal?: ResponsibilityEdgeLocalProposal;
  status: ResponsibilityEdgeStatus;
  candidateResponsibilityIds?: string[];
}

export interface EdgeExpectationHistoryEntry {
  kind: 'created' | 'routed' | 'proposed' | 'matched' | 'superseded';
  responsibilityId: string;
  detail: string;
  atDepth: number;
}

export interface EdgeExpectation {
  id: string;
  kind: string;
  summary: string;
  confidence: ResponsibilityConfidence;
  evidence: AreaPlanEvidence[];
  source: EdgeExpectationSide;
  target: EdgeExpectationSide;
  status: EdgeExpectationStatus;
  history: EdgeExpectationHistoryEntry[];
}

export interface LinkedCrossResponsibilityEdge {
  expectationId: string;
  kind: string;
  summary: string;
  confidence: ResponsibilityConfidence;
  evidence: AreaPlanEvidence[];
  sourceResponsibilityId: string;
  sourceLocalId: string;
  targetResponsibilityId: string;
  targetLocalId: string;
}

export interface Level0PathFrontierEntry {
  entityId: string;
  entityTypeId: string;
  side: FlowBoundarySide;
  flowRole: ResolvedFlowRole;
  mayTerminate: boolean;
  attemptCount: number;
}

export interface TerminatedFlowNode {
  entityId: string;
  entityTypeId: string;
  side: FlowBoundarySide;
  reason: FlowTerminationReason;
}

export interface InheritedBoundaryEdge {
  edgeId: string;
  relationTypeId?: string;
  sourceId: string;
  sourceTypeId?: string;
  targetId: string;
  targetTypeId?: string;
}

export interface InheritedBoundaryFlow {
  containerId: string;
  inboundEdges: InheritedBoundaryEdge[];
  outboundEdges: InheritedBoundaryEdge[];
  ancestorDoc: SemanticDocument;
}

export interface RefinedEndpointBinding {
  level0EdgeId: string;
  expectationId: string;
  endpoint: 'from' | 'to';
  responsibilityId: string;
  localId: string;
}

export interface RefinementResult {
  containerId: string;
  bindings: RefinedEndpointBinding[];
}

export interface FlowBuildState {
  level0Doc: SemanticDocument;
  level0EdgeIds: string[];
  activeFrontier: Level0PathFrontierEntry[];
  terminatedNodes: TerminatedFlowNode[];
  refinementQueue: InheritedBoundaryFlow[];
  edgeBindings: RefinedEndpointBinding[];
  visibleResponsibilityIds: string[];
}

export interface RefinableEdgeContract {
  id: string;
  refines?: string;
  relationTypeId?: string;
  description?: string;
  sourceId: string;
  sourceTypeId?: string;
  targetId: string;
  targetTypeId?: string;
  evidence: AreaPlanEvidence[];
  provenancePath?: string;
}

export interface InheritedNodeEdgeContract extends RefinableEdgeContract {
  side: FlowBoundarySide;
}

export interface NodeRefinementTask {
  nodeId: string;
  nodeTypeId: string;
  nodeName?: string;
  parentNodeId?: string;
  groupMode?: GroupMode;
  groupTypeId?: string;
  scope: string[];
  evidence: AreaPlanEvidence[];
  depth: number;
  inboundEdges: InheritedNodeEdgeContract[];
  outboundEdges: InheritedNodeEdgeContract[];
}

export interface NodeRefinementContextNodeLabel {
  id: string;
  name?: string;
  typeId: string;
}

export interface NodeRefinementContextNodeSummary extends NodeRefinementContextNodeLabel {
  scope: string[];
  directChildren: NodeRefinementContextNodeLabel[];
}

export interface NodeRefinementNearbyConceptSummary extends NodeRefinementContextNodeLabel {
  scope: string[];
  reasons: string[];
}

export interface NodeRefinementSurroundingContext {
  ancestorChain: NodeRefinementContextNodeSummary[];
  acceptedSiblings: NodeRefinementContextNodeLabel[];
  nearbyAcceptedConcepts: NodeRefinementNearbyConceptSummary[];
}

export interface ChildNodeSpec {
  localId: string;
  name: string;
  description?: string;
  typeId: string;
  props?: Record<string, unknown>;
  responsibility?: string;
  scope: string[];
  evidence: AreaPlanEvidence[];
  queueDecision: NodeQueueDecision;
  groupMode?: GroupMode;
  groupTypeId?: string;
}

export interface ChildRelationSpec {
  localId: string;
  typeId: string;
  description?: string;
  fromLocalId: string;
  toLocalId: string;
  evidence: AreaPlanEvidence[];
}

export interface InheritedEdgeRefinement {
  edgeId: string;
  relationTypeId?: string;
  fromChildLocalId?: string;
  toChildLocalId?: string;
}

export interface InheritedEdgeProposal {
  edgeId: string;
  endpoint: 'from' | 'to';
  childLocalId: string;
  relationTypeId?: string;
}

export interface NodeRefinementResult {
  parseDiagnostics?: Diagnostic[];
  edgeReferenceDiagnostics?: Diagnostic[];
  children: ChildNodeSpec[];
  relations: ChildRelationSpec[];
  edgeRefinements: InheritedEdgeRefinement[];
  edgeProposals?: InheritedEdgeProposal[];
  suggestedSchemaRefs?: string[];
  description?: string;
  openQuestions?: string[];
}

export interface Wave1ReviewRefinementPatch {
  children?: ChildNodeSpec[];
  relations?: ChildRelationSpec[];
  edgeRefinements?: InheritedEdgeRefinement[];
  edgeProposals?: InheritedEdgeProposal[];
  suggestedSchemaRefs?: string[];
  description?: string;
  openQuestions?: string[];
}

export interface RefinedChildNode {
  id: string;
  parentId?: string;
  localId: string;
  name?: string;
  description?: string;
  typeId: string;
  props?: Record<string, unknown>;
  scope: string[];
  evidence: AreaPlanEvidence[];
  queueDecision: NodeQueueDecision;
  groupMode?: GroupMode;
  groupTypeId?: string;
}

export interface AppliedNodeRefinement {
  nodeId: string;
  description?: string;
  children: RefinedChildNode[];
  relations: RefinableEdgeContract[];
  edgeRefinements: Array<{
    edgeId: string;
    refinedEdgeId: string;
    relationTypeId?: string;
    sourceId: string;
    targetId: string;
  }>;
  edgeProposals: Array<{
    edgeId: string;
    endpoint: 'from' | 'to';
    relationTypeId?: string;
    childId: string;
    childLocalId: string;
    childTypeId: string;
  }>;
  openQuestions: string[];
}

export interface ActiveEdgeProposal {
  edgeId: string;
  endpoint: 'from' | 'to';
  relationTypeId?: string;
  childId: string;
  childLocalId: string;
  childTypeId: string;
  ownerNodeId: string;
}

export interface PendingNodeRefinementRepair {
  nodeId: string;
  result: NodeRefinementResult;
  rawResponse: string;
  threadId: string | null;
  diagnostics: Diagnostic[];
  repairAttempt: number;
  lastAcceptable?: {
    result: NodeRefinementResult;
    rawResponse: string;
    threadId: string | null;
  };
}

export interface NodeRefinementState {
  pendingRepair?: PendingNodeRefinementRepair;
  rootNodeIds: string[];
  queue: NodeRefinementTask[];
  tasksByNodeId: Record<string, NodeRefinementTask>;
  nodesById: Record<string, RefinedChildNode>;
  refinementsByNodeId: Record<string, AppliedNodeRefinement>;
  edgeContracts: RefinableEdgeContract[];
  activeEdgeProposals: ActiveEdgeProposal[];
  reviewedDepths: number[];
  budgets: ExplorationBudgetState;
}

export interface Wave1ReviewEntityUpdate {
  typeId?: string;
  name?: string;
  description?: string;
  props?: Record<string, unknown>;
  evidence?: AreaPlanEvidence[];
}

export interface Wave1ReviewVisibleRelationSpec {
  id: string;
  typeId?: string;
  description?: string;
  fromId: string;
  toId: string;
  evidence: AreaPlanEvidence[];
}

export interface Wave1ReviewRootEdit {
  rootId: string;
  removeRoot?: boolean;
  root?: Wave1ReviewEntityUpdate;
  refinement?: Wave1ReviewRefinementPatch;
}

export interface Wave1ReviewPatch {
  rootEdits?: Wave1ReviewRootEdit[];
  replaceRootRelations?: Wave1ReviewVisibleRelationSpec[];
  addVisibleRelations?: Wave1ReviewVisibleRelationSpec[];
  updateVisibleRelations?: Wave1ReviewVisibleRelationSpec[];
  removeVisibleRelationIds?: string[];
  suggestedSchemaRefs?: string[];
}

export interface Wave1ReviewRootSummary {
  rootId: string;
  typeId: string;
  name?: string;
  description?: string;
  scope: string[];
  evidence: AreaPlanEvidence[];
  queuedForRefinement: boolean;
  directChildren: Array<{
    id: string;
    localId: string;
    name?: string;
    typeId: string;
    queueDecision: NodeQueueDecision;
    scope: string[];
    evidence: AreaPlanEvidence[];
  }>;
  refinement?: {
    description?: string;
    openQuestions: string[];
    relations: ChildRelationSpec[];
    edgeRefinements: InheritedEdgeRefinement[];
    edgeProposals: InheritedEdgeProposal[];
  };
}

export interface Wave1ReviewSummary {
  rootIds: string[];
  roots: Wave1ReviewRootSummary[];
  rootRelations: Wave1ReviewVisibleRelationSpec[];
  visibleRelations: Wave1ReviewVisibleRelationSpec[];
  activeEdgeProposals: ActiveEdgeProposal[];
  pendingDepth1NodeIds: string[];
  pendingDepth1QueueDecisionByNodeId: Record<string, NodeQueueDecision>;
  reviewedDepths: number[];
}

export interface FinalGraphReviewSummary {
  assembledDocument: {
    entityCount: number;
    relationCount: number;
  };
  candidateFinalGraph: {
    entityCount: number;
    relationCount: number;
  };
  removedEntityIds: string[];
  reparentedEntityIds: string[];
  removedRelationIds: string[];
  rewrittenRelationIds: string[];
  candidateMissingRelationEndpointIds: string[];
}

export interface ExplorationBudgetState {
  maxDepth: number;
  /** Legacy checkpoint fields are accepted but never enforce a build limit. */
  maxTurns?: number;
  maxWorkItems?: number;
  turnsUsed: number;
  workItemsCreated: number;
  tokenUsage: TokenUsageTotals;
}

export interface ExplorationState {
  rootWorkItemIds: string[];
  queue: ResponsibilityWorkItem[];
  splitTree: Record<string, string[]>;
  workItemsById: Record<string, ResponsibilityWorkItem>;
  finishedResponsibilities: FinishedResponsibilitySpec[];
  expectations: EdgeExpectation[];
  budgets: ExplorationBudgetState;
}
