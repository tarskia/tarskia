import type { AdvancedBuildPromptRunner } from '../../codex/advanced-thread-manager';
import { isModelOutputParseError } from '../../codex/model-output-error';
import type { DiagramPromptPackage } from '../../codex/prompt-package';
import { findTurnBudgetError } from '../../codex/turn-policy';
import type { Logger } from '../../logger';
import {
  type Diagnostic,
  diagnosticFingerprint,
  diagramDiagnostic,
  type SemanticDocument,
  sortDiagnostics,
} from '../../semantic';
import { addTokenUsageTotals } from '../../token-usage';
import type { PreparedWorkspace } from '../../workspace';
import type { NodeRefiner, NodeRefinerRepairer } from '../graph-builders';
import type { CachedNodeRefinementEntry } from '../node-refinement-cache';
import type {
  AreaPlan,
  NodeRefinementResult,
  NodeRefinementState,
  NodeRefinementSurroundingContext,
  NodeRefinementTask,
  RepoCensus,
} from '../types';
import { assembleRefinedDocument } from './application';
import { evaluateNodeRefinementCandidate } from './candidate';
import {
  buildNodeRefinementModelOutputDiagnostics,
  createEmptyNodeRefinementResult,
  isFatalNodeRefinementDiagnostic,
  shouldRepairNodeRefinementDiagnostics,
} from './candidate-diagnostics';
import {
  buildPrunedLocalRelationDiagnostics,
  collectInvalidLocalRelations,
  formatInvalidLocalRelationSummary,
  pruneInvalidLocalRelations,
} from './edge-pruning';
import { buildRelationMatrix } from './initial-state';
import {
  MAX_NODE_REFINEMENT_REPAIR_ATTEMPTS,
  type NodeRefinementSchemaContext,
} from './schema-context';
import { canExpandRefinementChildren } from './soft-expansion';
import { buildNodeRefinementSurroundingContext } from './surrounding-context';
import { refreshNodeRefinementTask } from './task-refresh';

export async function runNodeRefinement(params: {
  workspace: PreparedWorkspace;
  repo: string;
  ref?: string;
  repoCensus: RepoCensus;
  areaPlan: AreaPlan;
  baseDoc: SemanticDocument;
  promptPackage: DiagramPromptPackage;
  logger: Logger;
  initialState: NodeRefinementState;
  refiner: NodeRefiner;
  repairer?: NodeRefinerRepairer;
  getSchemaContext: () => NodeRefinementSchemaContext;
  promptRunner?: AdvancedBuildPromptRunner;
  handoffArtifactPath?: string;
  loadCachedResult?: (params: {
    state: NodeRefinementState;
    task: NodeRefinementTask;
    schemaContext: NodeRefinementSchemaContext;
    surroundingContext: NodeRefinementSurroundingContext;
  }) => Promise<CachedNodeRefinementEntry | undefined> | CachedNodeRefinementEntry | undefined;
  acceptSuggestedSchemaRefs?: (params: {
    task: NodeRefinementTask;
    suggestedSchemaRefs: string[];
  }) => {
    changed: boolean;
    acceptedSchemaRefs: string[];
    rejectedSchemaRefs: string[];
  };
  validateAppliedState?: (params: {
    state: NodeRefinementState;
    task: NodeRefinementTask;
    assembledDoc: SemanticDocument;
    schemaContext: NodeRefinementSchemaContext;
  }) => Promise<Diagnostic[]> | Diagnostic[];
  prepareValidationCommand?: (params: {
    state: NodeRefinementState;
    task: NodeRefinementTask;
    schemaContext: NodeRefinementSchemaContext;
    baselineDiagnosticFingerprints: string[];
  }) => Promise<string | undefined> | string | undefined;
  prepareSchemaValidationCommand?: (params: {
    state: NodeRefinementState;
    task: NodeRefinementTask;
    schemaContext: NodeRefinementSchemaContext;
  }) => Promise<string | undefined> | string | undefined;
  onCheckpoint?: (params: {
    previousState: NodeRefinementState;
    state: NodeRefinementState;
    completedTask: NodeRefinementTask;
    result: NodeRefinementResult;
    rawResponse: string | null;
    diagnostics: Diagnostic[];
    repairAttemptCount: number;
    source: 'computed' | 'cached';
    schemaContext: NodeRefinementSchemaContext;
    surroundingContext: NodeRefinementSurroundingContext;
  }) => Promise<void> | void;
  onFailure?: (params: {
    state: NodeRefinementState;
    failedTask: NodeRefinementTask;
    diagnostics: Diagnostic[];
    rawResponse: string | null;
    repairAttemptCount: number;
    error: unknown;
  }) => Promise<void> | void;
  stopBeforeDepth?: number;
}): Promise<NodeRefinementState> {
  let state: NodeRefinementState = {
    ...params.initialState,
    queue: [...params.initialState.queue],
    tasksByNodeId: { ...params.initialState.tasksByNodeId },
    nodesById: { ...params.initialState.nodesById },
    refinementsByNodeId: { ...params.initialState.refinementsByNodeId },
    edgeContracts: [...params.initialState.edgeContracts],
    activeEdgeProposals: [...params.initialState.activeEdgeProposals],
    reviewedDepths: [...params.initialState.reviewedDepths],
    budgets: { ...params.initialState.budgets },
  };
  let currentGlobalDiagnostics: Diagnostic[] = [];

  if (params.validateAppliedState) {
    const initialSchemaContext = params.getSchemaContext();
    currentGlobalDiagnostics = sortDiagnostics(
      await params.validateAppliedState({
        state,
        task: {
          nodeId: '__initial__',
          nodeTypeId: '__initial__',
          nodeName: 'initial',
          scope: ['.'],
          evidence: [],
          depth: 0,
          inboundEdges: [],
          outboundEdges: [],
        },
        assembledDoc: {
          ...assembleRefinedDocument({
            semantics: initialSchemaContext.semantics,
            baseDoc: params.baseDoc,
            state,
          }),
          schemaRefs: initialSchemaContext.activeSchemaRefs,
        },
        schemaContext: initialSchemaContext,
      }),
    );
  }

  while (state.queue.length > 0) {
    const queuedTask = state.queue[0];
    if (!queuedTask) {
      break;
    }
    const task = refreshNodeRefinementTask(state, queuedTask);
    if (params.stopBeforeDepth !== undefined && task.depth >= params.stopBeforeDepth) {
      params.logger.info(
        `Stopping node refinement before depth ${params.stopBeforeDepth}; next queued task ${task.nodeId} is at depth ${task.depth}`,
      );
      break;
    }
    state = {
      ...state,
      queue: state.queue.slice(1),
      tasksByNodeId: { ...state.tasksByNodeId, [task.nodeId]: task },
    };
    if (task.depth >= state.budgets.maxDepth) {
      params.logger.info(
        `Skipping refinement for ${task.nodeId} at depth ${task.depth} because maxDepth=${state.budgets.maxDepth} was reached`,
      );
      continue;
    }
    const pendingRepair =
      state.pendingRepair?.nodeId === task.nodeId ? state.pendingRepair : undefined;
    delete state.pendingRepair;
    let pendingCandidate: NodeRefinementState['pendingRepair'];
    let diagnostics: Diagnostic[] = [];
    let refinementTurn:
      | Awaited<ReturnType<NodeRefiner['refineNode']>>
      | Awaited<ReturnType<NonNullable<typeof params.repairer>['repairNode']>>
      | undefined;
    let candidateState: NodeRefinementState | undefined;
    let candidateGlobalDiagnostics: Diagnostic[] = currentGlobalDiagnostics;
    let repairAttempt = 0;
    let acceptedResult: NodeRefinementResult | undefined;
    let acceptedSource: 'computed' | 'cached' = 'computed';
    const previousState: NodeRefinementState = {
      ...state,
      queue: [...state.queue],
      tasksByNodeId: { ...state.tasksByNodeId },
      nodesById: { ...state.nodesById },
      refinementsByNodeId: { ...state.refinementsByNodeId },
      edgeContracts: [...state.edgeContracts],
      activeEdgeProposals: [...state.activeEdgeProposals],
      reviewedDepths: [...state.reviewedDepths],
      budgets: { ...state.budgets },
    };

    try {
      const schemaContext = params.getSchemaContext();
      const surroundingContext = buildNodeRefinementSurroundingContext({
        state,
        task,
      });
      let policyBudgets = { ...state.budgets };
      const buildDiagnosticsForResult = async (candidateResult: NodeRefinementResult) => {
        const evaluation = await evaluateNodeRefinementCandidate({
          state: { ...state, budgets: policyBudgets },
          task,
          result: candidateResult,
          baseDoc: params.baseDoc,
          schemaContext,
          logger: params.logger,
          baselineDiagnosticFingerprints: currentGlobalDiagnostics.map(diagnosticFingerprint),
          validateAppliedState: params.validateAppliedState
            ? (nextState, assembledDoc) =>
                params.validateAppliedState!({
                  state: nextState,
                  task,
                  assembledDoc,
                  schemaContext,
                })
            : undefined,
        });
        evaluation.nextState.budgets.turnsUsed = state.budgets.turnsUsed;
        evaluation.nextState.budgets.tokenUsage = state.budgets.tokenUsage;
        return {
          diagnostics: evaluation.diagnostics,
          result: evaluation.result,
          candidateState: evaluation.nextState,
          globalDiagnostics: params.validateAppliedState
            ? evaluation.globalDiagnostics
            : currentGlobalDiagnostics,
        };
      };

      const cachedResult = await params.loadCachedResult?.({
        state,
        task,
        schemaContext,
        surroundingContext,
      });
      if (cachedResult) {
        let normalizedCachedResult = cachedResult.result;
        ({
          diagnostics,
          candidateState,
          globalDiagnostics: candidateGlobalDiagnostics,
          result: normalizedCachedResult,
        } = await buildDiagnosticsForResult(normalizedCachedResult));
        const fatalCachedDiagnostics = diagnostics.filter(isFatalNodeRefinementDiagnostic);
        if (fatalCachedDiagnostics.length === 0) {
          acceptedResult = normalizedCachedResult;
          acceptedSource = 'cached';
          refinementTurn = {
            result: normalizedCachedResult,
            rawResponse: cachedResult.rawResponse ?? '',
            threadId: null,
          };
          params.logger.info(
            `Replayed cached node refinement for ${task.nodeId}; remaining queue=${state.queue.length}`,
          );
        } else {
          params.logger.warn(
            `Discarded cached node refinement for ${task.nodeId} because it no longer validates: ${fatalCachedDiagnostics.map((diagnostic) => diagnostic.code).join(', ')}`,
          );
        }
      }

      if (!acceptedResult) {
        const relationMatrix = buildRelationMatrix({
          schema: schemaContext.schema,
          semantics: schemaContext.semantics,
          parentTypeId: task.nodeTypeId,
          schemaActivations: schemaContext.activeSchemaRefs,
        });
        let validationCommand = await params.prepareValidationCommand?.({
          state,
          task,
          schemaContext,
          baselineDiagnosticFingerprints: currentGlobalDiagnostics.map(diagnosticFingerprint),
        });
        const schemaValidationCommand = await params.prepareSchemaValidationCommand?.({
          state,
          task,
          schemaContext,
        });
        const allowedChildTypeIds = Object.keys(relationMatrix);
        params.logger.info(
          `Refining node depth=${task.depth} id=${task.nodeId} type=${task.nodeTypeId} queue_remaining=${state.queue.length}`,
        );
        let result = createEmptyNodeRefinementResult();
        let lastAcceptable:
          | {
              result: NodeRefinementResult;
              state: NodeRefinementState;
              diagnostics: Diagnostic[];
              globalDiagnostics: Diagnostic[];
              turn: NonNullable<typeof refinementTurn>;
            }
          | undefined;
        const rememberAcceptable = () => {
          if (
            candidateState &&
            refinementTurn &&
            !diagnostics.some((item) => item.severity === 'error')
          ) {
            lastAcceptable = {
              result,
              state: candidateState,
              diagnostics,
              globalDiagnostics: candidateGlobalDiagnostics,
              turn: refinementTurn,
            };
          }
        };

        if (pendingRepair) {
          repairAttempt = pendingRepair.repairAttempt;
          if (pendingRepair.lastAcceptable) {
            refinementTurn = pendingRepair.lastAcceptable;
            result = refinementTurn.result;
            ({
              diagnostics,
              candidateState,
              globalDiagnostics: candidateGlobalDiagnostics,
              result,
            } = await buildDiagnosticsForResult(result));
            rememberAcceptable();
          }
          refinementTurn = pendingRepair;
          result = pendingRepair.result;
          ({
            diagnostics,
            candidateState,
            globalDiagnostics: candidateGlobalDiagnostics,
            result,
          } = await buildDiagnosticsForResult(result));
          // Parse errors are not reproducible by validating the placeholder result.
          diagnostics = sortDiagnostics([
            ...diagnostics,
            ...pendingRepair.diagnostics.filter(
              (item) => item.code === 'diagram.node_refinement.invalid_model_output',
            ),
          ]);
          rememberAcceptable();
        } else
          try {
            refinementTurn = await params.refiner.refineNode({
              workspace: params.workspace,
              repo: params.repo,
              ref: params.ref,
              repoCensus: params.repoCensus,
              areaPlan: params.areaPlan,
              task,
              childrenCanExpand: canExpandRefinementChildren(task, state),
              activeSchemaRefs: schemaContext.activeSchemaRefs,
              candidateSchemaRefs: schemaContext.candidateSchemaRefs,
              allowedChildTypeIds,
              relationMatrix,
              schemaFlowCatalog: schemaContext.schemaFlowCatalog,
              surroundingContext,
              validationCommand,
              schemaValidationCommand,
              promptPackage: params.promptPackage,
              logger: params.logger,
              promptRunner: params.promptRunner,
              handoffArtifactPath: params.handoffArtifactPath,
            });
            state.budgets.tokenUsage = addTokenUsageTotals(
              state.budgets.tokenUsage,
              refinementTurn.tokenUsage,
            );
            result = refinementTurn.result;
            ({
              diagnostics,
              candidateState,
              globalDiagnostics: candidateGlobalDiagnostics,
              result,
            } = await buildDiagnosticsForResult(result));
            state.budgets.turnsUsed += 1;
            candidateState.budgets.turnsUsed = state.budgets.turnsUsed;
            rememberAcceptable();
          } catch (error) {
            if (!isModelOutputParseError(error)) {
              throw error;
            }
            state.budgets.turnsUsed += 1;
            state.budgets.tokenUsage = addTokenUsageTotals(
              state.budgets.tokenUsage,
              error.tokenUsage,
            );
            refinementTurn = {
              result,
              rawResponse: error.rawResponse,
              threadId: error.threadId,
            };
            diagnostics = buildNodeRefinementModelOutputDiagnostics({
              task,
              error,
            });
            candidateState = undefined;
            candidateGlobalDiagnostics = currentGlobalDiagnostics;
          }

        while (
          shouldRepairNodeRefinementDiagnostics(diagnostics) &&
          repairAttempt < MAX_NODE_REFINEMENT_REPAIR_ATTEMPTS
        ) {
          if (!params.repairer) {
            break;
          }
          pendingCandidate = {
            nodeId: task.nodeId,
            result,
            rawResponse: refinementTurn?.rawResponse ?? '',
            threadId: refinementTurn?.threadId ?? null,
            diagnostics,
            repairAttempt,
            lastAcceptable: lastAcceptable
              ? {
                  result: lastAcceptable.result,
                  rawResponse: lastAcceptable.turn.rawResponse,
                  threadId: lastAcceptable.turn.threadId,
                }
              : undefined,
          };
          try {
            policyBudgets = { ...state.budgets };
            validationCommand = await params.prepareValidationCommand?.({
              state,
              task,
              schemaContext,
              baselineDiagnosticFingerprints: currentGlobalDiagnostics.map(diagnosticFingerprint),
            });
            refinementTurn = await params.repairer.repairNode({
              workspace: params.workspace,
              repo: params.repo,
              ref: params.ref,
              repoCensus: params.repoCensus,
              areaPlan: params.areaPlan,
              task,
              childrenCanExpand: canExpandRefinementChildren(task, state),
              activeSchemaRefs: schemaContext.activeSchemaRefs,
              candidateSchemaRefs: schemaContext.candidateSchemaRefs,
              allowedChildTypeIds,
              relationMatrix,
              schemaFlowCatalog: schemaContext.schemaFlowCatalog,
              surroundingContext,
              validationCommand,
              schemaValidationCommand,
              promptPackage: params.promptPackage,
              logger: params.logger,
              promptRunner: params.promptRunner,
              handoffArtifactPath: params.handoffArtifactPath,
              previousResult: result,
              diagnostics,
              attempt: repairAttempt + 1,
            });
            state.budgets.tokenUsage = addTokenUsageTotals(
              state.budgets.tokenUsage,
              refinementTurn.tokenUsage,
            );
            result = refinementTurn.result;
            ({
              diagnostics,
              candidateState,
              globalDiagnostics: candidateGlobalDiagnostics,
              result,
            } = await buildDiagnosticsForResult(result));
            state.budgets.turnsUsed += 1;
            candidateState.budgets.turnsUsed = state.budgets.turnsUsed;
            rememberAcceptable();
          } catch (error) {
            if (!isModelOutputParseError(error)) {
              throw error;
            }
            state.budgets.turnsUsed += 1;
            state.budgets.tokenUsage = addTokenUsageTotals(
              state.budgets.tokenUsage,
              error.tokenUsage,
            );
            refinementTurn = {
              result,
              rawResponse: error.rawResponse,
              threadId: error.threadId,
            };
            diagnostics = buildNodeRefinementModelOutputDiagnostics({
              task,
              error,
            });
            candidateState = undefined;
            candidateGlobalDiagnostics = currentGlobalDiagnostics;
            if (lastAcceptable) {
              repairAttempt += 1;
              break;
            }
          }
          repairAttempt += 1;
        }
        if (
          repairAttempt > 0 &&
          lastAcceptable &&
          shouldRepairNodeRefinementDiagnostics(diagnostics)
        ) {
          const fallback = diagramDiagnostic({
            phase: 'document',
            severity: 'warning',
            code: 'diagram.node_refinement.repair_fallback',
            entityId: task.nodeId,
            message: `Kept the last acceptable refinement for ${task.nodeId} after repair failed to improve it.`,
          });
          params.logger.warn(fallback.message);
          result = lastAcceptable.result;
          candidateState = {
            ...lastAcceptable.state,
            budgets: {
              ...lastAcceptable.state.budgets,
              turnsUsed: state.budgets.turnsUsed,
              tokenUsage: state.budgets.tokenUsage,
            },
          };
          candidateGlobalDiagnostics = lastAcceptable.globalDiagnostics;
          refinementTurn = lastAcceptable.turn;
          diagnostics = sortDiagnostics([...lastAcceptable.diagnostics, fallback]);
        }
        const invalidLocalRelations =
          diagnostics.some(isFatalNodeRefinementDiagnostic) &&
          !diagnostics.some(
            (diagnostic) => diagnostic.code === 'diagram.node_refinement.ambiguous_inherited_edge',
          )
            ? collectInvalidLocalRelations({
                result,
                schema: schemaContext.schema,
                semantics: schemaContext.semantics,
              })
            : [];
        if (invalidLocalRelations.length > 0) {
          params.logger.warn(
            `Dropping ${invalidLocalRelations.length} invalid local relation${invalidLocalRelations.length === 1 ? '' : 's'} under ${task.nodeId} after repair attempts: ${invalidLocalRelations
              .slice(0, 5)
              .map(formatInvalidLocalRelationSummary)
              .join('; ')}${invalidLocalRelations.length > 5 ? '; ...' : ''}`,
          );
          result = pruneInvalidLocalRelations({
            result,
            schema: schemaContext.schema,
            semantics: schemaContext.semantics,
          });
          ({
            diagnostics,
            candidateState,
            globalDiagnostics: candidateGlobalDiagnostics,
            result,
          } = await buildDiagnosticsForResult(result));
          diagnostics = sortDiagnostics([
            ...diagnostics,
            ...buildPrunedLocalRelationDiagnostics({
              task,
              invalidRelations: invalidLocalRelations,
            }),
          ]);
        }
        acceptedResult = result;
      }

      const fatalDiagnostics = diagnostics.filter(isFatalNodeRefinementDiagnostic);
      if (fatalDiagnostics.length > 0) {
        const message = diagnostics.map((diagnostic) => diagnostic.message).join('; ');
        throw new Error(`Node refinement for ${task.nodeId} failed validation: ${message}`);
      }
      if (diagnostics.length > 0) {
        params.logger.warn(
          `Accepting node refinement for ${task.nodeId} with unresolved advisory diagnostics: ${diagnostics.map((diagnostic) => diagnostic.code).join(', ')}`,
        );
      }

      const finalResult = acceptedResult;
      // A nonfatal accepted result has an evaluated state; parse failures are fatal above.
      state = candidateState!;
      currentGlobalDiagnostics = candidateGlobalDiagnostics;

      if (finalResult.suggestedSchemaRefs && finalResult.suggestedSchemaRefs.length > 0) {
        const decision = params.acceptSuggestedSchemaRefs?.({
          task,
          suggestedSchemaRefs: finalResult.suggestedSchemaRefs,
        });
        if (decision?.rejectedSchemaRefs.length) {
          params.logger.warn(
            `Rejected suggested schema refs from ${task.nodeId}: ${decision.rejectedSchemaRefs.join(', ')}`,
          );
        }
        if (decision?.changed) {
          params.logger.info(
            `Activated additional schema refs after refining ${task.nodeId}: ${decision.acceptedSchemaRefs.join(', ')}`,
          );
          if (params.validateAppliedState) {
            const nextSchemaContext = params.getSchemaContext();
            currentGlobalDiagnostics = sortDiagnostics(
              await params.validateAppliedState({
                state,
                task,
                assembledDoc: {
                  ...assembleRefinedDocument({
                    semantics: nextSchemaContext.semantics,
                    baseDoc: params.baseDoc,
                    state,
                  }),
                  schemaRefs: nextSchemaContext.activeSchemaRefs,
                },
                schemaContext: nextSchemaContext,
              }),
            );
          }
        }
      }

      await params.onCheckpoint?.({
        previousState,
        state,
        completedTask: task,
        result: finalResult,
        rawResponse: refinementTurn?.rawResponse ?? null,
        diagnostics,
        repairAttemptCount: repairAttempt,
        source: acceptedSource,
        schemaContext,
        surroundingContext,
      });
    } catch (error) {
      const resumableState: NodeRefinementState = {
        ...state,
        queue: [task, ...state.queue],
        ...(findTurnBudgetError(error) && pendingCandidate
          ? { pendingRepair: pendingCandidate }
          : {}),
      };
      try {
        await params.onFailure?.({
          state: resumableState,
          failedTask: task,
          diagnostics,
          rawResponse: refinementTurn?.rawResponse ?? null,
          repairAttemptCount: repairAttempt,
          error,
        });
      } catch (checkpointError) {
        params.logger.warn(
          `Could not persist node-refinement failure: ${checkpointError instanceof Error ? checkpointError.message : String(checkpointError)}`,
        );
      }
      throw error;
    }
  }

  return state;
}
