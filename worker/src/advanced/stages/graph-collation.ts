import path from 'node:path';
import { writeWorkspaceArtifact } from '../../artifacts';
import { isModelOutputParseError } from '../../codex/model-output-error';
import { findTurnBudgetError } from '../../codex/turn-policy';
import { runTimedStep } from '../../logger';
import { runRepairableStage } from '../../run-repairable-stage';
import { type Diagnostic, serializeDocument } from '../../semantic';
import { addTokenUsageTotals } from '../../token-usage';
import type { GraphCollator } from '../graph-builders';
import { decodePendingDocument } from '../pending-candidates';
import type { prepareGraphContext } from './graph-context';
import { buildModelOutputDiagnostic } from './shared';

export async function runGraphCollation(context: Awaited<ReturnType<typeof prepareGraphContext>>) {
  const {
    options,
    timings,
    resume,
    run,
    emitProgress,
    beginStage,
    census,
    graphifyHints,
    promptPackage,
    advancedThreadManager,
    areaPlan,
    schemaSetManager,
    buildCurrentSchemaFlowCatalog,
    prepareSchemaValidationCommand,
    backbone,
    nodeRefinementState,
    assembledDoc,
    graphCollator,
    stabilizeFinalGraphResult,
    writeGraphCollationHandoff,
    resumedGraph,
    resumedFinalReview,
  } = context;
  const pendingGraph = resumedGraph
    ? undefined
    : await resume.pendingCandidates.load('graph-collation', decodePendingDocument);
  const pendingFinalReview = resumedFinalReview
    ? undefined
    : await resume.pendingCandidates.load('final-review', decodePendingDocument);
  let pendingGraphModelOutputDiagnostics: Diagnostic[] = pendingGraph?.diagnostics ?? [];
  let graphResult: Awaited<ReturnType<GraphCollator['collateGraph']>> | undefined =
    resumedGraph ?? pendingGraph?.result;
  if (pendingGraph) await beginStage('graph-collation');
  let currentGraphResponseArtifactPath = resume.resumeState?.currentGraphResponseArtifact ?? null;
  let currentGraphReviewCompleted = Boolean(resumedFinalReview);
  if (!graphResult) {
    await beginStage('graph-collation');
    currentGraphResponseArtifactPath = null;
    try {
      graphResult = await runRepairableStage({
        maxAttempts: 1,
        attempt: () =>
          runTimedStep(
            {
              logger: options.logger,
              label: 'advanced graph collation turn',
              timings,
              detail: (result) =>
                `thread ${result.threadId ?? 'none'}, entities=${result.doc.entities.length}, relations=${result.doc.relations.length}`,
            },
            async () => {
              const handoffArtifactPath = await writeGraphCollationHandoff(
                'Node refinement is complete. Collate the assembled refined document into the final graph using the canonical artifacts referenced here.',
              );
              run.graphTurnCount += 1;
              const result = await graphCollator.collateGraph({
                semantics: schemaSetManager.snapshot().runtime.semantics,
                workspace: options.workspace,
                repo: options.repo,
                ref: options.ref,
                repoCensus: census,
                graphifyHints,
                areaPlan,
                nodeRefinementState,
                assembledDoc,
                level0Backbone: backbone.level0BuildState,
                activeSchemaRefs: schemaSetManager.snapshot().activeSchemaRefs,
                schemaFlowCatalog: buildCurrentSchemaFlowCatalog(),
                schemaValidationCommand: await prepareSchemaValidationCommand(),
                promptPackage,
                primaryDocumentInput: options.primaryDocumentInput,
                logger: options.logger,
                promptRunner: advancedThreadManager,
                handoffArtifactPath,
              });
              const artifactPath = await writeWorkspaceArtifact(
                options.workspace,
                'analysis/final-graph.yaml',
                result.rawYaml,
              );
              await writeWorkspaceArtifact(
                options.workspace,
                'analysis/final-graph.pre-review.yaml',
                result.rawYaml,
              );
              const responseArtifactPath = await writeWorkspaceArtifact(
                options.workspace,
                'analysis/final-graph.response.yaml',
                result.rawResponse,
              );
              await emitProgress({
                advanced: {
                  lastCompletedStage: 'graph-collation',
                  currentGraphArtifact: artifactPath,
                  currentGraphResponseArtifact: responseArtifactPath,
                  currentGraphReviewCompleted: false,
                  currentAdvancedThreadId: result.threadId,
                },
                threadId: result.threadId,
              });
              currentGraphResponseArtifactPath = responseArtifactPath;
              currentGraphReviewCompleted = false;
              run.totalTokenUsage = addTokenUsageTotals(run.totalTokenUsage, result.tokenUsage);
              return result;
            },
          ),
      });
    } catch (error) {
      if (findTurnBudgetError(error)) throw error;
      if (!isModelOutputParseError(error)) {
        throw error;
      }
      graphResult = {
        rawYaml: serializeDocument(assembledDoc).trim(),
        doc: assembledDoc,
        rawResponse: error.rawResponse,
        threadId: error.threadId,
      };
      pendingGraphModelOutputDiagnostics = [
        buildModelOutputDiagnostic({
          code: 'diagram.document.invalid_graph_output',
          message: `Graph collation output was not valid YAML: ${error.message}. Return only a semantic document YAML artifact.`,
        }),
      ];
      run.totalTokenUsage = addTokenUsageTotals(run.totalTokenUsage, error.tokenUsage);
      await writeWorkspaceArtifact(
        options.workspace,
        'analysis/final-graph.response.yaml',
        error.rawResponse,
      );
      currentGraphResponseArtifactPath = path.join(
        options.workspace.workspaceOutputDir,
        'analysis/final-graph.response.yaml',
      );
      currentGraphReviewCompleted = false;
      options.logger.warn(pendingGraphModelOutputDiagnostics[0].message);
    }
  }
  if (!graphResult) {
    throw new Error('Graph collation did not produce a candidate graph');
  }
  graphResult = stabilizeFinalGraphResult(graphResult, 'Graph collation');
  await resume.pendingCandidates.save('graph-collation', {
    rawYaml: graphResult.rawYaml,
    rawResponse: graphResult.rawResponse,
    repairCount: 0,
    diagnostics: pendingGraphModelOutputDiagnostics,
  });

  return {
    ...context,
    pendingFinalReview,
    graph: {
      graphResult,
      currentGraphResponseArtifactPath,
      currentGraphReviewCompleted,
      pendingGraphModelOutputDiagnostics,
    },
  };
}
