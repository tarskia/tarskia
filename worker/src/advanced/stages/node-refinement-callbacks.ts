import { writeWorkspaceArtifact, writeWorkspaceJsonArtifact } from '../../artifacts';
import { retainPartialDocument } from '../../codex/turn-policy';
import type { Diagnostic, SemanticDocument } from '../../semantic';
import { stageFingerprint } from '../checkpoint-inputs';
import type { NodeRefiner, NodeRefinerRepairer } from '../graph-builders';
import { resolveHandoffArtifacts } from '../handoff-artifacts';
import {
  buildCachedNodeRefinementEntry,
  loadCachedNodeRefinementEntry,
  writeCachedNodeRefinementEntry,
} from '../node-refinement-cache';
import {
  assembleRefinedDocument,
  buildInitialNodeRefinementState,
  runNodeRefinement,
} from '../node-refinement-engine';
import { validateIntermediateRefinedState } from '../node-refinement-validator';
import type { runLevel0Review } from './level0-review';
import {
  buildHandoffArtifact,
  NODE_REFINEMENT_HANDOFF_ARTIFACT,
  NODE_REFINEMENT_VALIDATION_CONTEXT_ARTIFACT,
  NODE_REFINEMENT_VALIDATION_HELPER_ARTIFACT,
  WAVE1_REVIEW_HANDOFF_ARTIFACT,
} from './shared';

export async function prepareNodeRefinementCallbacks(
  context: Awaited<ReturnType<typeof runLevel0Review>> & {
    resumedPartialNodeRefinement: import('../types').NodeRefinementState | undefined;
    refiner: NodeRefiner;
    repairer: NodeRefinerRepairer;
  },
) {
  const {
    options,
    resume,
    emitProgress,
    buildValidationHelperScript,
    census,
    promptPackage,
    advancedThreadManager,
    areaPlan,
    schemaSetManager,
    buildCurrentSchemaFlowCatalog,
    writeSchemaSetArtifacts,
    prepareSchemaValidationCommand,
    backbone,
    resumedPartialNodeRefinement,
    refiner,
    repairer,
  } = context;
  const nodeRefinementValidationCommand = `node out/${NODE_REFINEMENT_VALIDATION_HELPER_ARTIFACT}`;
  await writeWorkspaceArtifact(
    options.workspace,
    NODE_REFINEMENT_VALIDATION_HELPER_ARTIFACT,
    buildValidationHelperScript(
      'validate-node-refinement',
      NODE_REFINEMENT_VALIDATION_CONTEXT_ARTIFACT,
    ),
  );
  const startingState: import('../types').NodeRefinementState =
    resumedPartialNodeRefinement ??
    buildInitialNodeRefinementState({
      semantics: schemaSetManager.snapshot().runtime.semantics,
      level0Doc: backbone.level0BuildState.level0Doc,
      areaPlan,
      visibleResponsibilityIds: backbone.level0BuildState.visibleResponsibilityIds,
      maxDepth: options.nodeRefinementMaxDepth,
    });
  const writeNodeRefinementHandoff = async (
    state: import('../types').NodeRefinementState,
    summary: string,
  ) =>
    writeWorkspaceArtifact(
      options.workspace,
      NODE_REFINEMENT_HANDOFF_ARTIFACT,
      buildHandoffArtifact({
        title: 'Advanced Node-Refinement Handoff',
        workspaceRoot: options.workspace.jobRoot,
        summary,
        artifactPaths: resolveHandoffArtifacts(
          'node-refinement',
          options.workspace.workspaceOutputDir,
        ),
        extraSections: [
          {
            heading: 'Queue Summary',
            body: `- Pending tasks: ${state.queue.length}\n- Root nodes: ${state.rootNodeIds.length}\n- Active edge proposals: ${state.activeEdgeProposals.length}`,
          },
        ],
      }),
    );
  const writeWave1ReviewHandoff = async (
    state: import('../types').NodeRefinementState,
    summary: string,
  ) =>
    writeWorkspaceArtifact(
      options.workspace,
      WAVE1_REVIEW_HANDOFF_ARTIFACT,
      buildHandoffArtifact({
        title: 'Advanced Wave-1 Review Handoff',
        workspaceRoot: options.workspace.jobRoot,
        summary,
        artifactPaths: resolveHandoffArtifacts(
          'wave1-review',
          options.workspace.workspaceOutputDir,
        ),
        extraSections: [
          {
            heading: 'Wave Summary',
            body: `- Pending depth-1 tasks: ${state.queue.filter((task) => task.depth === 1).length}\n- Root nodes: ${state.rootNodeIds.length}\n- Reviewed depths: ${state.reviewedDepths.join(', ') || '(none)'}`,
          },
        ],
      }),
    );
  // Read the shared backbone at invocation time: wave-1 review can replace it
  // between the root pass and deeper refinement.
  const getSchemaContext = (): import('../node-refinement-engine').NodeRefinementSchemaContext => {
    const snapshot = schemaSetManager.snapshot();
    return {
      inputFingerprint: stageFingerprint(resume.inputs, 'node-refinement'),
      activeSchemaRefs: snapshot.activeSchemaRefs,
      candidateSchemaRefs: snapshot.candidateSchemaRefs,
      schema: snapshot.runtime.resolved.effectiveSchema,
      semantics: snapshot.runtime.semantics,
      schemaFlowCatalog: buildCurrentSchemaFlowCatalog(),
    };
  };
  const prepareValidationCommand = async (params: {
    baselineDiagnosticFingerprints: string[];
    state: import('../types').NodeRefinementState;
    task: import('../types').NodeRefinementTask;
    schemaContext: ReturnType<typeof getSchemaContext>;
  }) => {
    await writeWorkspaceJsonArtifact(
      options.workspace,
      NODE_REFINEMENT_VALIDATION_CONTEXT_ARTIFACT,
      {
        version: 1,
        baselineDiagnosticFingerprints: params.baselineDiagnosticFingerprints,
        task: params.task,
        state: params.state,
        baseDoc: backbone.level0BuildState.level0Doc,
        activeSchemaRefs: params.schemaContext.activeSchemaRefs,
        primaryDocumentInput: options.primaryDocumentInput,
      },
    );
    return nodeRefinementValidationCommand;
  };
  const validateRefinedState = (params: {
    state: import('../types').NodeRefinementState;
    assembledDoc: SemanticDocument;
    schemaContext: ReturnType<typeof getSchemaContext>;
  }) => {
    return validateIntermediateRefinedState({
      state: params.state,
      assembledDoc: params.assembledDoc,
      schemaContext: params.schemaContext,
      primaryDocumentInput: options.primaryDocumentInput,
    });
  };
  const acceptSuggestedSchemaRefs = (suggestedSchemaRefs: string[]) => {
    const decision = schemaSetManager.acceptSchemaRefs(suggestedSchemaRefs);
    if (decision.changed) {
      const snapshot = schemaSetManager.snapshot();
      backbone.level0BuildState = {
        ...backbone.level0BuildState,
        level0Doc: {
          ...backbone.level0BuildState.level0Doc,
          schemaRefs: [...snapshot.activeSchemaRefs],
        },
      };
    }
    return decision;
  };
  const persistNodeRefinementState = async (
    state: import('../types').NodeRefinementState,
    summary: string,
    diagnostics: Diagnostic[] = [],
  ) => {
    const artifactPath = await writeWorkspaceJsonArtifact(
      options.workspace,
      'analysis/node-refinement-state.json',
      state,
    );
    await writeSchemaSetArtifacts();
    retainPartialDocument({
      ...assembleRefinedDocument({
        semantics: getSchemaContext().semantics,
        baseDoc: backbone.level0BuildState.level0Doc,
        state,
      }),
      schemaRefs: getSchemaContext().activeSchemaRefs,
    });
    await writeNodeRefinementHandoff(state, summary);
    await emitProgress({
      advanced: {
        currentNodeRefinementArtifact: artifactPath,
      },
      activeStage: 'advanced/node-refinement',
      diagnostics,
    });
    return artifactPath;
  };
  await persistNodeRefinementState(startingState, 'Node refinement checkpoint initialized.');
  const nodeRefinementHandoffPath = await writeNodeRefinementHandoff(
    startingState,
    resumedPartialNodeRefinement
      ? 'Node refinement is resuming from a saved checkpoint. Reconstruct context from the saved state and referenced artifacts before continuing.'
      : 'Level-0 backbone is complete. Begin node refinement from the current saved state and referenced artifacts.',
  );
  const runNodeRefinementPass = async (
    initialState: import('../types').NodeRefinementState,
    stopBeforeDepth?: number,
  ) =>
    runNodeRefinement({
      workspace: options.workspace,
      repo: options.repo,
      ref: options.ref,
      repoCensus: census,
      areaPlan,
      baseDoc: backbone.level0BuildState.level0Doc,
      promptPackage,
      logger: options.logger,
      initialState,
      refiner,
      repairer,
      promptRunner: advancedThreadManager,
      handoffArtifactPath: nodeRefinementHandoffPath,
      stopBeforeDepth,
      getSchemaContext,
      loadCachedResult: async ({ state, task, schemaContext, surroundingContext }) => {
        const cachedResult = await loadCachedNodeRefinementEntry({
          workspace: options.workspace,
          nodeId: task.nodeId,
        });
        if (!cachedResult) {
          return undefined;
        }
        const expectedEntry = buildCachedNodeRefinementEntry({
          state,
          task,
          schemaContext,
          surroundingContext,
          result: cachedResult.result,
          rawResponse: cachedResult.rawResponse,
          diagnostics: cachedResult.diagnostics,
          repairAttemptCount: cachedResult.repairAttemptCount,
        });
        if (
          cachedResult.taskFingerprint !== expectedEntry.taskFingerprint ||
          cachedResult.schemaContextFingerprint !== expectedEntry.schemaContextFingerprint ||
          cachedResult.stateFingerprint !== expectedEntry.stateFingerprint
        ) {
          options.logger.info(
            `Ignoring cached node refinement for ${task.nodeId} because its fingerprint no longer matches the current context`,
          );
          return undefined;
        }
        return cachedResult;
      },
      prepareValidationCommand,
      prepareSchemaValidationCommand: async () => prepareSchemaValidationCommand(),
      validateAppliedState: ({ state, assembledDoc, schemaContext }) =>
        validateRefinedState({
          state,
          assembledDoc,
          schemaContext,
        }),
      acceptSuggestedSchemaRefs: ({ suggestedSchemaRefs }) =>
        acceptSuggestedSchemaRefs(suggestedSchemaRefs),
      onCheckpoint: async ({
        previousState,
        state,
        completedTask,
        result,
        rawResponse,
        diagnostics,
        repairAttemptCount,
        source,
        schemaContext,
        surroundingContext,
      }) => {
        await writeCachedNodeRefinementEntry({
          workspace: options.workspace,
          entry: buildCachedNodeRefinementEntry({
            state: previousState,
            task: completedTask,
            schemaContext,
            surroundingContext,
            result,
            rawResponse,
            diagnostics,
            repairAttemptCount,
          }),
        });
        await persistNodeRefinementState(
          state,
          `Node refinement last completed task: ${completedTask.nodeId}. Continue from the saved state and referenced artifacts.`,
          diagnostics,
        );
        options.logger.info(
          `Checkpointed node refinement after ${completedTask.nodeId} (${source}); remaining queue=${state.queue.length}`,
        );
      },
      onFailure: async ({ state, failedTask, diagnostics, rawResponse, repairAttemptCount }) => {
        const artifactPath = await writeWorkspaceJsonArtifact(
          options.workspace,
          'analysis/node-refinement-state.json',
          state,
        );
        await writeSchemaSetArtifacts();
        await writeWorkspaceJsonArtifact(
          options.workspace,
          'analysis/node-refinement.failure.json',
          {
            failedNodeId: failedTask.nodeId,
            repairAttemptCount,
            diagnostics,
            rawResponse,
          },
        );
        await writeNodeRefinementHandoff(
          state,
          `Node refinement failed while processing ${failedTask.nodeId}. Resume from the saved state and inspect the failure artifact before continuing.`,
        );
        await emitProgress({
          advanced: {
            currentNodeRefinementArtifact: artifactPath,
          },
          activeStage: 'advanced/node-refinement',
          diagnostics,
        });
      },
    });

  return {
    startingState,
    runNodeRefinementPass,
    writeWave1ReviewHandoff,
    getSchemaContext,
    validateRefinedState,
    persistNodeRefinementState,
    acceptSuggestedSchemaRefs,
  };
}
