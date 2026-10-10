import { AiDiagramServiceError } from '../../ai-diagram-service';
import { writeWorkspaceArtifact, writeWorkspaceJsonArtifact } from '../../artifacts';
import { isModelOutputParseError } from '../../codex/model-output-error';
import { findTurnBudgetError, retainPartialDocument } from '../../codex/turn-policy';
import { runTimedStep } from '../../logger';
import { runRepairableStage } from '../../run-repairable-stage';
import {
  type Diagnostic,
  diagramDiagnostic,
  serializeDocument,
  sortDiagnostics,
  type validateDiagramYaml,
} from '../../semantic';
import { addTokenUsageTotals } from '../../token-usage';
import { restoreBackboneCheckpoint } from '../checkpoint-resume';
import { resolveVisibleResponsibilityIdsFromPlan } from '../concept-plan';
import {
  buildContinuationAttemptMap,
  buildFlowBuildState,
  buildFlowRepairDiagnostics,
  serializeDocumentFlowAnalysisArtifact,
  serializeFlowBuildStateArtifact,
} from '../flow-build-state';
import { decodePendingDocument } from '../pending-candidates';
import { dedupeSchemaActivations } from '../schema-set';
import type { FlowBuildState } from '../types';
import type { runAreaPlan } from './area-plan';
import {
  buildModelOutputDiagnostic,
  createEmptySemanticDocument,
  formatLevel0RepairPassCount,
  isFatalBackboneDiagnostic,
  MAX_LEVEL0_BACKBONE_REPAIR_ATTEMPTS,
  validateSemanticDocument,
} from './shared';

export async function runLevel0Backbone(context: Awaited<ReturnType<typeof runAreaPlan>>) {
  const {
    options,
    timings,
    resume,
    run,
    emitProgress,
    beginStage,
    census,
    graphifyHints,
    schemaRegistry,
    promptPackage,
    advancedThreadManager,
    writePreRefinementHandoff,
    areaPlan,
    schemaSetManager,
    buildCurrentSchemaFlowCatalog,
    writeSchemaSetArtifacts,
    prepareSchemaValidationCommand,
    level0BackboneBuilder,
    level0BackboneRepairer,
  } = context;
  await emitProgress({ activeStage: 'advanced/level0-backbone' });
  const resumedLevel0Backbone = await restoreBackboneCheckpoint(context);

  const pendingBackbone = resumedLevel0Backbone
    ? undefined
    : await resume.pendingCandidates.load('level0-backbone', decodePendingDocument);
  let pendingLevel0ModelOutputDiagnostics: Diagnostic[] = pendingBackbone?.diagnostics ?? [];
  let initialBackboneResult = resumedLevel0Backbone ?? pendingBackbone?.result;
  if (pendingBackbone) await beginStage('level0-backbone');
  if (!initialBackboneResult) {
    await beginStage('level0-backbone');
    await writeSchemaSetArtifacts();
    try {
      initialBackboneResult = await runTimedStep(
        {
          logger: options.logger,
          label: 'advanced level-0 backbone turn',
          timings,
          detail: (result) =>
            `thread ${result.threadId ?? 'none'}, entities=${result.doc.entities.length}, relations=${result.doc.relations.length}`,
        },
        async () => {
          const handoffArtifactPath = await writePreRefinementHandoff({
            summary:
              'Concept planning is complete. Review the concept plan and current schema activations to draft the level-0 backbone.',
            activeSchemaRefs: schemaSetManager.snapshot().activeSchemaRefs,
            includeAreaPlan: true,
          });
          run.level0TurnCount += 1;
          const result = await level0BackboneBuilder.buildLevel0Backbone({
            semantics: schemaSetManager.snapshot().runtime.semantics,
            workspace: options.workspace,
            repo: options.repo,
            ref: options.ref,
            repoCensus: census,
            graphifyHints,
            areaPlan,
            activeSchemaRefs: schemaSetManager.snapshot().activeSchemaRefs,
            candidateSchemaRefs: schemaSetManager.snapshot().candidateSchemaRefs,
            schemaFlowCatalog: buildCurrentSchemaFlowCatalog(),
            schemaValidationCommand: await prepareSchemaValidationCommand(),
            promptPackage,
            logger: options.logger,
            promptRunner: advancedThreadManager,
            handoffArtifactPath,
          });
          await writeWorkspaceArtifact(
            options.workspace,
            'analysis/level0-backbone.yaml',
            result.rawYaml,
          );
          await writeWorkspaceArtifact(
            options.workspace,
            'analysis/level0-backbone.response.yaml',
            result.rawResponse,
          );
          run.totalTokenUsage = addTokenUsageTotals(run.totalTokenUsage, result.tokenUsage);
          return result;
        },
      );
    } catch (error) {
      if (findTurnBudgetError(error)) throw error;
      if (!isModelOutputParseError(error)) {
        throw error;
      }
      const fallbackDoc = createEmptySemanticDocument(schemaSetManager.snapshot().activeSchemaRefs);
      initialBackboneResult = {
        rawYaml: serializeDocument(fallbackDoc).trim(),
        doc: fallbackDoc,
        rawResponse: error.rawResponse,
        threadId: error.threadId,
      };
      pendingLevel0ModelOutputDiagnostics = [
        buildModelOutputDiagnostic({
          code: 'diagram.document.invalid_backbone_output',
          message: `Level-0 backbone output was not valid YAML: ${error.message}. Return only a semantic document YAML artifact.`,
        }),
      ];
      run.totalTokenUsage = addTokenUsageTotals(run.totalTokenUsage, error.tokenUsage);
      await writeWorkspaceArtifact(
        options.workspace,
        'analysis/level0-backbone.response.yaml',
        error.rawResponse,
      );
      options.logger.warn(pendingLevel0ModelOutputDiagnostics[0].message);
    }
  }

  let level0BackboneResult = initialBackboneResult;

  let repoOwnedResponsibilityIds = resolveVisibleResponsibilityIdsFromPlan({
    level0Doc: level0BackboneResult.doc,
    plan: areaPlan,
  });
  let continuationAttempts = new Map<string, number>();
  let initialBuildState: FlowBuildState | undefined;
  let effectiveLevel0Schema:
    | NonNullable<ReturnType<typeof validateDiagramYaml>['effectiveSchema']>
    | undefined;
  let level0ResolvedSchemaIds: string[] = [];
  let level0RepairAttemptCount = pendingBackbone?.repairCount ?? 0;
  let level0Diagnostics: Diagnostic[] = [];

  await runRepairableStage({
    maxRepairs: MAX_LEVEL0_BACKBONE_REPAIR_ATTEMPTS,
    repairCount: () => level0RepairAttemptCount,
    acceptAdvisoriesAtLimit: true,
    evaluate: async () => {
      repoOwnedResponsibilityIds = resolveVisibleResponsibilityIdsFromPlan({
        level0Doc: level0BackboneResult.doc,
        plan: areaPlan,
      });
      await resume.pendingCandidates.save('level0-backbone', {
        rawYaml: level0BackboneResult.rawYaml,
        rawResponse: level0BackboneResult.rawResponse,
        repairCount: level0RepairAttemptCount,
        diagnostics: pendingLevel0ModelOutputDiagnostics,
      });
      const proposedLevel0Document = {
        ...level0BackboneResult.doc,
        schemaRefs: dedupeSchemaActivations([
          ...schemaSetManager.snapshot().activeSchemaRefs,
          ...level0BackboneResult.doc.schemaRefs,
        ]),
      };
      const level0Validation = validateSemanticDocument({
        rawYaml: serializeDocument(proposedLevel0Document),
        schemaRegistry,
        primaryDocumentInput: options.primaryDocumentInput,
      });
      const backboneSchemaSetDecision = level0Validation.document
        ? schemaSetManager.acceptSchemaRefs(
            level0Validation.document.schemaRefs.map((activation) => activation.schema),
          )
        : {
            changed: false,
            acceptedSchemaRefs: [],
            rejectedSchemaRefs: [],
          };
      const schemaSetSnapshot = schemaSetManager.snapshot();
      const normalizedLevel0Document = level0Validation.document
        ? {
            ...level0Validation.document,
            schemaRefs: [...schemaSetSnapshot.activeSchemaRefs],
          }
        : undefined;
      level0ResolvedSchemaIds = schemaSetSnapshot.activeSchemaRefs.map(
        (activation) => activation.schema,
      );
      const analyzedLevel0 =
        level0Validation.ok &&
        normalizedLevel0Document &&
        schemaSetSnapshot.runtime.resolved.effectiveSchema
          ? buildFlowBuildState({
              level0Doc: normalizedLevel0Document,
              effectiveSchema: schemaSetSnapshot.runtime.resolved.effectiveSchema,
              repoOwnedResponsibilityIds,
              continuationAttempts,
            })
          : undefined;

      if (analyzedLevel0) {
        initialBuildState = analyzedLevel0.state;
        effectiveLevel0Schema = schemaSetSnapshot.runtime.resolved.effectiveSchema;
        await writeWorkspaceJsonArtifact(
          options.workspace,
          'analysis/flow-analysis.json',
          serializeDocumentFlowAnalysisArtifact(analyzedLevel0.analysis),
        );
        await writeWorkspaceJsonArtifact(
          options.workspace,
          'analysis/flow-build-state.json',
          serializeFlowBuildStateArtifact(analyzedLevel0.state),
        );
      }

      const schemaSetDiagnostics: Diagnostic[] = backboneSchemaSetDecision.rejectedSchemaRefs.map(
        (schemaRef) =>
          diagramDiagnostic({
            phase: 'document',
            severity: 'error',
            code: 'diagram.document.schema_ref_not_accepted',
            message: `Schema ref ${schemaRef} is not accepted by the active schema-set rules`,
          }),
      );

      const flowDiagnostics =
        analyzedLevel0 && initialBuildState
          ? buildFlowRepairDiagnostics({
              flowBuildState: initialBuildState,
              analysis: analyzedLevel0.analysis,
              effectiveSchema: effectiveLevel0Schema!,
            })
          : [];
      const hasFlowRepairErrors = flowDiagnostics.some(
        (diagnostic) => diagnostic.severity === 'error',
      );
      const diagnostics = sortDiagnostics([
        ...pendingLevel0ModelOutputDiagnostics,
        ...level0Validation.diagnostics,
        ...schemaSetDiagnostics,
        ...flowDiagnostics,
      ]);
      level0Diagnostics = diagnostics;
      const fatalBackboneDiagnostics = diagnostics.filter(isFatalBackboneDiagnostic);
      const stopAfterBackbone = options.stopAfter === 'level0-backbone';
      const needsRepair =
        pendingLevel0ModelOutputDiagnostics.length > 0 ||
        !level0Validation.ok ||
        backboneSchemaSetDecision.rejectedSchemaRefs.length > 0 ||
        (!stopAfterBackbone &&
          (hasFlowRepairErrors ||
            Boolean(initialBuildState && initialBuildState.activeFrontier.length > 0)));
      const canAcceptWithAdvisoriesOnly =
        !stopAfterBackbone &&
        level0RepairAttemptCount >= MAX_LEVEL0_BACKBONE_REPAIR_ATTEMPTS &&
        fatalBackboneDiagnostics.length === 0;

      return {
        valid: !needsRepair && Boolean(initialBuildState && effectiveLevel0Schema),
        advisoryOnly:
          !stopAfterBackbone &&
          fatalBackboneDiagnostics.length === 0 &&
          Boolean(initialBuildState && effectiveLevel0Schema),
        checkpointAccepted: Boolean(
          resumedLevel0Backbone && initialBuildState && effectiveLevel0Schema,
        ),

        accept: async () => {
          level0BackboneResult = {
            ...level0BackboneResult,
            doc: initialBuildState!.level0Doc,
            rawYaml: serializeDocument(initialBuildState!.level0Doc).trim(),
          };
          if (canAcceptWithAdvisoriesOnly) {
            options.logger.warn(
              `Accepting level-0 backbone with unresolved advisory diagnostics after ${formatLevel0RepairPassCount(MAX_LEVEL0_BACKBONE_REPAIR_ATTEMPTS)}: ${diagnostics.map((diagnostic) => diagnostic.code).join(', ')}`,
            );
          }
          if (!resumedLevel0Backbone) {
            await writeWorkspaceArtifact(
              options.workspace,
              'analysis/level0-backbone.pre-review.yaml',
              level0BackboneResult.rawYaml,
            );
            await writeWorkspaceArtifact(
              options.workspace,
              'analysis/level0-backbone.yaml',
              level0BackboneResult.rawYaml,
            );
          }
          if (!resumedLevel0Backbone) await writeSchemaSetArtifacts();
          await emitProgress({
            advanced: {
              ...(resumedLevel0Backbone ? {} : { lastCompletedStage: 'level0-backbone' as const }),
            },
            resolvedSchemaIds: level0ResolvedSchemaIds,
          });
        },
        exhausted: () => {
          throw new AiDiagramServiceError(
            `Advanced level-0 backbone did not validate after ${formatLevel0RepairPassCount(MAX_LEVEL0_BACKBONE_REPAIR_ATTEMPTS)}`,
            diagnostics,
            options.workspace,
            level0BackboneResult.threadId,
            level0RepairAttemptCount > 0,
          );
        },
        repair: async () => {
          if (initialBuildState) {
            continuationAttempts = buildContinuationAttemptMap(
              continuationAttempts,
              initialBuildState.activeFrontier,
            );
          }

          try {
            const repairResult = await runTimedStep(
              {
                logger: options.logger,
                label: `advanced level-0 repair turn ${level0RepairAttemptCount + 1}/${MAX_LEVEL0_BACKBONE_REPAIR_ATTEMPTS}`,
                timings,
                detail: (result) =>
                  `thread ${result.threadId ?? 'none'}, entities=${result.doc.entities.length}, relations=${result.doc.relations.length}`,
              },
              async () => {
                const handoffArtifactPath = await writePreRefinementHandoff({
                  summary:
                    'A level-0 backbone draft exists but needs repair. Read the current backbone artifact, concept plan, and prompt contract before repairing.',
                  activeSchemaRefs: schemaSetManager.snapshot().activeSchemaRefs,
                  includeAreaPlan: true,
                  includeBackbone: true,
                });
                run.level0TurnCount += 1;
                const result = await level0BackboneRepairer.repairLevel0Backbone({
                  semantics: schemaSetManager.snapshot().runtime.semantics,
                  workspace: options.workspace,
                  repo: options.repo,
                  ref: options.ref,
                  repoCensus: census,
                  graphifyHints,
                  areaPlan,
                  activeSchemaRefs: schemaSetManager.snapshot().activeSchemaRefs,
                  candidateSchemaRefs: schemaSetManager.snapshot().candidateSchemaRefs,
                  schemaFlowCatalog: buildCurrentSchemaFlowCatalog(),
                  schemaValidationCommand: await prepareSchemaValidationCommand(),
                  promptPackage,
                  logger: options.logger,
                  promptRunner: advancedThreadManager,
                  handoffArtifactPath,
                  previousBackboneYaml: level0BackboneResult.rawYaml,
                  diagnostics,
                  flowBuildState:
                    initialBuildState ??
                    ({
                      level0Doc: level0BackboneResult.doc,
                      level0EdgeIds: [],
                      activeFrontier: [],
                      terminatedNodes: [],
                      refinementQueue: [],
                      edgeBindings: [],
                      visibleResponsibilityIds: [],
                    } satisfies FlowBuildState),
                  attempt: level0RepairAttemptCount + 1,
                });
                await writeWorkspaceArtifact(
                  options.workspace,
                  'analysis/level0-backbone.yaml',
                  result.rawYaml,
                );
                await writeWorkspaceArtifact(
                  options.workspace,
                  `analysis/level0-backbone.repair-${level0RepairAttemptCount + 1}.response.yaml`,
                  result.rawResponse,
                );
                run.totalTokenUsage = addTokenUsageTotals(run.totalTokenUsage, result.tokenUsage);
                return result;
              },
            );

            level0BackboneResult = repairResult;
            pendingLevel0ModelOutputDiagnostics = [];
          } catch (error) {
            if (findTurnBudgetError(error)) throw error;
            if (!isModelOutputParseError(error)) {
              throw error;
            }
            pendingLevel0ModelOutputDiagnostics = [
              buildModelOutputDiagnostic({
                code: 'diagram.document.invalid_backbone_output',
                message: `Level-0 backbone repair output was not valid YAML: ${error.message}. Return only a semantic document YAML artifact.`,
              }),
            ];
            run.totalTokenUsage = addTokenUsageTotals(run.totalTokenUsage, error.tokenUsage);
            await writeWorkspaceArtifact(
              options.workspace,
              `analysis/level0-backbone.repair-${level0RepairAttemptCount + 1}.response.yaml`,
              error.rawResponse,
            );
            level0BackboneResult = {
              ...level0BackboneResult,
              rawResponse: error.rawResponse,
              threadId: error.threadId,
            };
            options.logger.warn(pendingLevel0ModelOutputDiagnostics[0].message);
          }
          level0RepairAttemptCount += 1;
          run.repaired = true;
        },
      };
    },
  });

  if (!initialBuildState || !effectiveLevel0Schema) {
    throw new AiDiagramServiceError(
      'Advanced level-0 backbone analysis did not produce a usable flow state',
      [],
      options.workspace,
      level0BackboneResult.threadId,
      level0RepairAttemptCount > 0,
    );
  }

  const level0BuildState = initialBuildState;
  retainPartialDocument(level0BuildState.level0Doc);

  return {
    ...context,
    backbone: {
      level0BackboneResult,
      repoOwnedResponsibilityIds,
      continuationAttempts,
      effectiveLevel0Schema,
      level0ResolvedSchemaIds,
      level0Diagnostics,
      level0BuildState,
    },
  };
}
