import { fileURLToPath } from 'node:url';
import type {
  AiDiagramService,
  GenerateDiagramOptions,
  GenerateDiagramResult,
} from '../ai-diagram-service';
import { AiDiagramServiceError } from '../ai-diagram-service';
import type { CodexClientLike } from '../codex/diagram-agent';
import { findTurnBudgetError } from '../codex/turn-policy';
import { formatDuration, formatTimingSummary } from '../logger';
import { serializeDocument } from '../semantic';
import type { AreaPlanner } from './area-plan';
import { prepareResume } from './checkpoint-preparation';
import type {
  FinalGraphReviewer,
  FinalGraphReviewerRepairer,
  GraphCollator,
  GraphCollatorRepairer,
  Level0BackboneBuilder,
  Level0BackboneRepairer,
  Level0BackboneReviewer,
  Level0BackboneReviewerRepairer,
  NodeRefiner,
  NodeRefinerRepairer,
  Wave1Reviewer,
  Wave1ReviewerRepairer,
} from './graph-builders';
import type { GraphifyHintsBuilder } from './graphify-hints';
import { runAreaPlan } from './stages/area-plan';
import { compileBundle } from './stages/bundle-compile';
import { runCensus } from './stages/census';
import { runFinalReview } from './stages/final-review';
import { runGraphCollation } from './stages/graph-collation';
import { prepareGraphContext } from './stages/graph-context';
import { prepareStageArtifacts } from './stages/handoffs';
import { runLevel0Backbone } from './stages/level0-backbone';
import { runLevel0Review } from './stages/level0-review';
import { runNodeRefinementStage } from './stages/node-refinement';
import {
  type AdvancedPipelineDependencies,
  createPipelineContext,
} from './stages/pipeline-context';
import { preparePromptContext } from './stages/prompt-context';
import { setupThreads } from './stages/thread-setup';

function buildValidationHelperScript(command: string, contextArtifact: string): string {
  const cliPath = fileURLToPath(import.meta.url);
  return [
    "import { spawn } from 'node:child_process';",
    '',
    `const cliPath = ${JSON.stringify(cliPath)};`,
    `const contextPath = ${JSON.stringify(`out/${contextArtifact}`)};`,
    '',
    'const child = spawn(process.execPath, [',
    '  cliPath,',
    "  'internal',",
    `  '${command}',`,
    "  '--job-root',",
    '  process.cwd(),',
    "  '--context',",
    '  contextPath,',
    "], { stdio: ['pipe', 'pipe', 'pipe'] });",
    '',
    'process.stdin.pipe(child.stdin);',
    'child.stdout.pipe(process.stdout);',
    'child.stderr.pipe(process.stderr);',
    "child.on('exit', (code) => process.exit(code ?? 1));",
  ].join('\n');
}

export class AdvancedAiDiagramService implements AiDiagramService {
  private readonly areaPlanner?: AreaPlanner;
  private readonly level0BackboneBuilder?: Level0BackboneBuilder;
  private readonly level0BackboneRepairer?: Level0BackboneRepairer;
  private readonly level0BackboneReviewer?: Level0BackboneReviewer;
  private readonly level0BackboneReviewerRepairer?: Level0BackboneReviewerRepairer;
  private readonly wave1Reviewer?: Wave1Reviewer;
  private readonly wave1ReviewerRepairer?: Wave1ReviewerRepairer;
  private readonly nodeRefiner?: NodeRefiner;
  private readonly nodeRefinerRepairer?: NodeRefinerRepairer;
  private readonly graphCollator?: GraphCollator;
  private readonly graphCollatorRepairer?: GraphCollatorRepairer;
  private readonly finalGraphReviewer?: FinalGraphReviewer;
  private readonly finalGraphReviewerRepairer?: FinalGraphReviewerRepairer;
  private readonly graphifyHintsBuilder?: GraphifyHintsBuilder;
  private readonly advancedThreadClient?: CodexClientLike;

  constructor(dependencies: AdvancedPipelineDependencies = {}) {
    this.areaPlanner = dependencies.areaPlanner;
    this.level0BackboneBuilder = dependencies.level0BackboneBuilder;
    this.level0BackboneRepairer = dependencies.level0BackboneRepairer;
    this.level0BackboneReviewer = dependencies.level0BackboneReviewer;
    this.level0BackboneReviewerRepairer = dependencies.level0BackboneReviewerRepairer;
    this.wave1Reviewer = dependencies.wave1Reviewer;
    this.wave1ReviewerRepairer = dependencies.wave1ReviewerRepairer;
    this.nodeRefiner = dependencies.nodeRefiner;
    this.nodeRefinerRepairer = dependencies.nodeRefinerRepairer;
    this.graphCollator = dependencies.graphCollator;
    this.graphCollatorRepairer = dependencies.graphCollatorRepairer;
    this.finalGraphReviewer = dependencies.finalGraphReviewer;
    this.finalGraphReviewerRepairer = dependencies.finalGraphReviewerRepairer;
    this.graphifyHintsBuilder = dependencies.graphifyHintsBuilder;
    this.advancedThreadClient = dependencies.advancedThreadClient;
  }

  async generateDiagram(options: GenerateDiagramOptions): Promise<GenerateDiagramResult> {
    const context = createPipelineContext(
      options,
      {
        areaPlanner: this.areaPlanner,
        level0BackboneBuilder: this.level0BackboneBuilder,
        level0BackboneRepairer: this.level0BackboneRepairer,
        level0BackboneReviewer: this.level0BackboneReviewer,
        level0BackboneReviewerRepairer: this.level0BackboneReviewerRepairer,
        wave1Reviewer: this.wave1Reviewer,
        wave1ReviewerRepairer: this.wave1ReviewerRepairer,
        nodeRefiner: this.nodeRefiner,
        nodeRefinerRepairer: this.nodeRefinerRepairer,
        graphCollator: this.graphCollator,
        graphCollatorRepairer: this.graphCollatorRepairer,
        finalGraphReviewer: this.finalGraphReviewer,
        finalGraphReviewerRepairer: this.finalGraphReviewerRepairer,
        graphifyHintsBuilder: this.graphifyHintsBuilder,
        advancedThreadClient: this.advancedThreadClient,
      },
      buildValidationHelperScript,
    );
    const { run, timings, startedAt } = context;
    try {
      const resumed = await prepareResume(context);
      const census = await runCensus(resumed);
      const prompt = await preparePromptContext(census);
      const threads = await setupThreads(prompt);
      const artifacts = await prepareStageArtifacts(threads);
      const plan = await runAreaPlan(artifacts);
      const built = await runLevel0Backbone(plan);
      {
        const { backbone } = built;
        if (options.stopAfter === 'level0-backbone') {
          return {
            finalYaml: serializeDocument(backbone.level0BuildState.level0Doc).trimEnd() + '\n',
            document: backbone.level0BuildState.level0Doc,
            threadId: backbone.level0BackboneResult.threadId,
            repaired: run.repaired,
            diagnostics: backbone.level0Diagnostics,
            resolvedSchemaIds: backbone.level0ResolvedSchemaIds,
            turnCount: run.areaPlanningTurnCount + run.level0TurnCount,
            tokenUsage: run.totalTokenUsage,
          };
        }
      }
      const reviewed = await runLevel0Review(built);
      {
        const { backbone } = reviewed;
        if (options.stopAfter === 'level0-review') {
          return {
            finalYaml: serializeDocument(backbone.level0BuildState.level0Doc).trimEnd() + '\n',
            document: backbone.level0BuildState.level0Doc,
            threadId: backbone.level0BackboneResult.threadId,
            repaired: run.repaired,
            diagnostics: backbone.level0Diagnostics,
            resolvedSchemaIds: backbone.level0ResolvedSchemaIds,
            turnCount: run.areaPlanningTurnCount + run.level0TurnCount,
            tokenUsage: run.totalTokenUsage,
          };
        }
      }
      const refined = await runNodeRefinementStage(reviewed);
      const graphContext = await prepareGraphContext(refined);
      const collated = await runGraphCollation(graphContext);
      const final = await runFinalReview(collated);
      return await compileBundle(final);
    } catch (error) {
      if (findTurnBudgetError(error)) throw error;
      if (error instanceof AiDiagramServiceError) {
        error.diagnostics.push(
          ...run.fallbackDiagnostics.filter((item) => !error.diagnostics.includes(item)),
        );
        throw error;
      }
      throw new AiDiagramServiceError(
        error instanceof Error
          ? `Failed to generate advanced analysis artifacts: ${error.message}`
          : 'Failed to generate advanced analysis artifacts',
        [...run.fallbackDiagnostics],
        options.workspace,
        error &&
          typeof error === 'object' &&
          'threadId' in error &&
          typeof error.threadId === 'string'
          ? error.threadId
          : run.currentThreadId,
        false,
        { cause: error },
      );
    } finally {
      if (timings.length > 0) {
        options.logger.info(`Advanced pipeline timings: ${formatTimingSummary(timings)}`);
      }
      options.logger.info(
        `Advanced pipeline finished in ${formatDuration(Date.now() - startedAt)}`,
      );
    }
  }
}
