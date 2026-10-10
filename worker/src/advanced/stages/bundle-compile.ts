import type { GenerateDiagramResult } from '../../ai-diagram-service';
import { AiDiagramServiceError } from '../../ai-diagram-service';
import { serializeDocument, sortDiagnostics } from '../../semantic';
import { addTokenUsageTotals } from '../../token-usage';
import type { runFinalReview } from './final-review';
import { validateSemanticDocument } from './shared';

export async function compileBundle(
  context: Awaited<ReturnType<typeof runFinalReview>>,
): Promise<GenerateDiagramResult> {
  let {
    options,
    run,
    emitProgress,
    beginStage,
    schemaRegistry,
    appDescription,
    nodeRefinementState,
    finalFlowDiagnostics,
    graph,
    graphResolvedSchemaIds,
    finalReviewResult,
    finalDiagnostics,
    finalDocument,
  } = context;
  await beginStage('bundle-compile');
  await emitProgress({
    activeStage: 'advanced/bundle-compile',
    threadId: finalReviewResult.threadId,
    repaired: run.repaired,
  });

  if (!finalDocument) {
    const compiledValidation = validateSemanticDocument({
      rawYaml: finalReviewResult.rawYaml,
      schemaRegistry,
      primaryDocumentInput: options.primaryDocumentInput,
    });
    finalDiagnostics = sortDiagnostics([
      ...compiledValidation.diagnostics,
      ...(compiledValidation.document ? finalFlowDiagnostics(compiledValidation.document) : []),
    ]);
    if (
      !compiledValidation.ok ||
      !compiledValidation.document ||
      finalDiagnostics.some((d) => d.severity === 'error')
    ) {
      throw new AiDiagramServiceError(
        'Reviewed final graph did not validate during bundle compile',
        finalDiagnostics,
        options.workspace,
        finalReviewResult.threadId,
        run.repaired,
      );
    }
    finalDocument = compiledValidation.document;
    graphResolvedSchemaIds = compiledValidation.resolvedSchemaIds;
  }

  await emitProgress({
    advanced: {
      lastCompletedStage: 'bundle-compile',
      currentGraphReviewCompleted: graph.currentGraphReviewCompleted,
    },
    resolvedSchemaIds: graphResolvedSchemaIds,
    diagnostics: sortDiagnostics([...finalDiagnostics, ...run.fallbackDiagnostics]),
    threadId: finalReviewResult.threadId,
    repaired: run.repaired,
  });
  return {
    finalYaml: serializeDocument(finalDocument).trimEnd() + '\n',
    document: finalDocument,
    threadId: finalReviewResult.threadId,
    repaired: run.repaired,
    diagnostics: sortDiagnostics([...finalDiagnostics, ...run.fallbackDiagnostics]),
    resolvedSchemaIds: graphResolvedSchemaIds,
    turnCount:
      run.areaPlanningTurnCount +
      run.level0TurnCount +
      nodeRefinementState.budgets.turnsUsed +
      run.graphTurnCount,
    tokenUsage: addTokenUsageTotals(run.totalTokenUsage, nodeRefinementState.budgets.tokenUsage),
    appDescription,
  };
}
