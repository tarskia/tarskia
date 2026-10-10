import { writeWorkspaceArtifact } from '../../artifacts';
import { CodexFinalGraphReviewer } from '../../codex/final-graph-reviewer';
import { CodexGraphCollator } from '../../codex/graph-collator';
import { retainPartialDocument } from '../../codex/turn-policy';
import { type Diagnostic, type SemanticDocument, serializeDocument } from '../../semantic';
import { restoreGraphCheckpoints } from '../checkpoint-resume';
import { detectFinalGraphRegression } from '../final-review';
import { buildFlowBuildState, buildFlowRepairDiagnostics } from '../flow-build-state';
import { resolveHandoffArtifacts } from '../handoff-artifacts';
import type { runNodeRefinementStage } from './node-refinement';
import {
  buildHandoffArtifact,
  FINAL_REVIEW_HANDOFF_ARTIFACT,
  formatSchemaActivations,
  GRAPH_COLLATION_HANDOFF_ARTIFACT,
  validateSemanticDocument,
} from './shared';

export async function prepareGraphContext(
  context: Awaited<ReturnType<typeof runNodeRefinementStage>>,
) {
  const {
    options,
    dependencies,
    codexAgentOptions,
    run,
    emitProgress,
    schemaRegistry,
    schemaSetManager,
    backbone,
    assembledDoc,
  } = context;
  const graphCollator = dependencies.graphCollator ?? new CodexGraphCollator(codexAgentOptions);
  const finalGraphReviewer =
    dependencies.finalGraphReviewer ?? new CodexFinalGraphReviewer(codexAgentOptions);
  const finalGraphReviewerRepairer =
    dependencies.finalGraphReviewerRepairer ?? new CodexFinalGraphReviewer(codexAgentOptions);
  const validateGraph = (doc: SemanticDocument) =>
    validateSemanticDocument({
      rawYaml: serializeDocument(doc),
      schemaRegistry,
      primaryDocumentInput: options.primaryDocumentInput,
    }).diagnostics;
  const finalFlowDiagnostics = (doc: SemanticDocument): Diagnostic[] => {
    const effectiveSchema = schemaSetManager.snapshot().runtime.resolved.effectiveSchema;
    if (!effectiveSchema) return [];
    const flow = buildFlowBuildState({
      level0Doc: doc,
      effectiveSchema,
      repoOwnedResponsibilityIds: backbone.repoOwnedResponsibilityIds,
      continuationAttempts: backbone.continuationAttempts,
    });
    return buildFlowRepairDiagnostics({
      flowBuildState: flow.state,
      analysis: flow.analysis,
      effectiveSchema,
    });
  };
  retainPartialDocument(assembledDoc);
  const stabilizeFinalGraphResult = <T extends { rawYaml: string; doc: SemanticDocument }>(
    result: T,
    stage: string,
    inputDoc = assembledDoc,
  ): T => {
    const regression = detectFinalGraphRegression({
      assembledDoc: inputDoc,
      candidateDoc: result.doc,
      inputDiagnostics: [...validateGraph(inputDoc), ...finalFlowDiagnostics(inputDoc)],
      validate: validateGraph,
    });
    for (const diagnostic of regression.diagnostics) {
      options.logger.warn(`${stage}: ${diagnostic.message}`);
      run.fallbackDiagnostics.push(diagnostic);
    }
    if (regression.diagnostics.length) run.repaired = true;
    return {
      ...result,
      doc: regression.document,
      rawYaml: serializeDocument(regression.document).trim(),
    };
  };
  const writeGraphCollationHandoff = async (summary: string, diagnostics: Diagnostic[] = []) =>
    writeWorkspaceArtifact(
      options.workspace,
      GRAPH_COLLATION_HANDOFF_ARTIFACT,
      buildHandoffArtifact({
        title: 'Advanced Graph-Collation Handoff',
        workspaceRoot: options.workspace.jobRoot,
        summary,
        artifactPaths: resolveHandoffArtifacts(
          'graph-collation',
          options.workspace.workspaceOutputDir,
        ),
        extraSections: [
          {
            heading: 'Active Schema Activations',
            body: formatSchemaActivations(schemaSetManager.snapshot().activeSchemaRefs),
          },
          ...(diagnostics.length > 0
            ? [
                {
                  heading: 'Current Validation Diagnostics',
                  body: diagnostics
                    .map(
                      (diagnostic) =>
                        `- [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`,
                    )
                    .join('\n'),
                },
              ]
            : []),
        ],
      }),
    );
  const writeFinalReviewHandoff = async (
    summary: string,
    diagnostics: Diagnostic[] = [],
    handoffOptions: { includeCandidateFinalGraph?: boolean } = {},
  ) =>
    writeWorkspaceArtifact(
      options.workspace,
      FINAL_REVIEW_HANDOFF_ARTIFACT,
      buildHandoffArtifact({
        title: 'Advanced Final-Review Handoff',
        workspaceRoot: options.workspace.jobRoot,
        summary,
        artifactPaths: resolveHandoffArtifacts(
          'final-review',
          options.workspace.workspaceOutputDir,
          handoffOptions,
        ),
        extraSections: [
          {
            heading: 'Active Schema Activations',
            body: formatSchemaActivations(schemaSetManager.snapshot().activeSchemaRefs),
          },
          ...(diagnostics.length > 0
            ? [
                {
                  heading: 'Current Validation Diagnostics',
                  body: diagnostics
                    .map(
                      (diagnostic) =>
                        `- [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`,
                    )
                    .join('\n'),
                },
              ]
            : []),
        ],
      }),
    );

  await emitProgress({ activeStage: 'advanced/graph-collation' });
  const { resumedGraph, resumedFinalReview } = await restoreGraphCheckpoints(context);

  return {
    ...context,
    graphCollator,
    finalGraphReviewer,
    finalGraphReviewerRepairer,
    validateGraph,
    finalFlowDiagnostics,
    stabilizeFinalGraphResult,
    writeGraphCollationHandoff,
    writeFinalReviewHandoff,
    resumedGraph,
    resumedFinalReview,
  };
}
