import path from 'node:path';
import { Codex, type CodexOptions, type ThreadOptions } from '@openai/codex-sdk';
import { listPlanConcepts } from '../advanced/concept-plan';
import { summarizeFlowBuildStateForPrompt } from '../advanced/flow-build-state';
import type {
  Level0BackboneBuilderInput,
  Level0BackboneReviewer,
  Level0BackboneReviewerInput,
  Level0BackboneReviewerRepairer,
  Level0BackboneReviewerRepairerInput,
  Level0BackboneReviewerResult,
} from '../advanced/graph-builders';
import { renderSchemaFlowCatalogForPrompt } from '../advanced/schema-flow-catalog';
import { parseDocument, serializeDocument } from '../semantic';
import { normalizeGeneratedDocument } from '../semantic/generated-document-normalizer';
import { tokenUsageFromSdkUsage } from '../token-usage';
import type { CodexClientLike, CodexThreadLike } from './diagram-agent';
import { extractYamlResponse } from './diagram-agent';
import { renderGraphifyHintsSection } from './graphify-hints-prompt';
import { ModelOutputParseError } from './model-output-error';
import { renderSchemaSelectionGuidance, renderSharedDiagramPromptGuidance } from './prompt-package';
import { createReadOnlyThread } from './read-only-thread';
import { runCodexPrompt } from './run-codex-prompt';

export interface CodexLevel0BackboneReviewerOptions {
  client?: CodexClientLike;
  clientOptions?: CodexOptions;
  model?: string;
  modelReasoningEffort?: ThreadOptions['modelReasoningEffort'];
  turnTimeoutMs?: number;
}

function toWorkspaceRelativePath(rootPath: string, targetPath: string): string {
  const relative = path.relative(rootPath, targetPath);
  return relative.split(path.sep).join('/') || '.';
}

function formatSchemaActivations(activations: Array<{ schema: string; layer: number }>): string {
  return activations.length > 0
    ? activations
        .map((activation) => `- ${activation.schema} (layer ${activation.layer})`)
        .join('\n')
    : '- None';
}

function summarizeConceptPlan(input: Level0BackboneBuilderInput): string {
  const concepts = listPlanConcepts(input.areaPlan);
  if (concepts.length === 0) {
    return '- None';
  }
  return concepts
    .map((concept) =>
      [
        `- id=${concept.id}`,
        `  kind=${concept.kind}`,
        `  title=${concept.title}`,
        `  rationale=${concept.rationale}`,
        `  paths=${concept.paths.join(', ')}`,
        `  groupingHints=${concept.groupingHints.length > 0 ? concept.groupingHints.join(' | ') : '(none)'}`,
      ].join('\n'),
    )
    .join('\n');
}

function summarizeSchemaCandidates(input: Level0BackboneBuilderInput): string {
  if (input.candidateSchemaRefs.length === 0) {
    return '- None';
  }
  return input.candidateSchemaRefs
    .map((candidate) =>
      [
        `- ${candidate.schemaRef} (suggested layer ${candidate.suggestedLayer})`,
        `  rationale=${candidate.rationale}`,
        `  evidence=${candidate.evidence.map((entry) => entry.path).join(', ')}`,
      ].join('\n'),
    )
    .join('\n');
}

function buildPromptHeader(input: Level0BackboneBuilderInput): string[] {
  const targetRepoPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    input.workspace.targetRepoPath,
  );
  const schemaRepoPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    input.workspace.schemaRepoPath,
  );
  const promptContractArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, 'prompt-contract.md'),
  );
  const schemaCatalogArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, 'schema-catalog.json'),
  );
  const schemaFlowCatalogArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, 'analysis/schema-flow-catalog.json'),
  );
  const metaOntologyArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, 'meta-ontology.md'),
  );
  const repoCensusArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, 'analysis/repo-census.json'),
  );
  const conceptPlanArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, 'analysis/area-plan.json'),
  );
  const schemaSetArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, 'analysis/schema-set.json'),
  );
  const flowAnalysisArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, 'analysis/flow-analysis.json'),
  );
  const flowBuildStateArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, 'analysis/flow-build-state.json'),
  );

  return [
    'Workspace layout:',
    `- Target repository: ${targetRepoPath}`,
    `- Schema repository: ${schemaRepoPath}`,
    `- Repo census artifact: ${repoCensusArtifactPath}`,
    `- Concept plan artifact: ${conceptPlanArtifactPath}`,
    `- Schema set artifact: ${schemaSetArtifactPath}`,
    `- Flow analysis artifact: ${flowAnalysisArtifactPath}`,
    `- Flow build-state artifact: ${flowBuildStateArtifactPath}`,
    `- Prompt contract artifact: ${promptContractArtifactPath}`,
    `- Schema catalog artifact: ${schemaCatalogArtifactPath}`,
    `- Schema flow catalogue artifact: ${schemaFlowCatalogArtifactPath}`,
    `- Meta-ontology artifact: ${metaOntologyArtifactPath}`,
    '',
    'Repository context:',
    `- Clone URL: ${input.repo}`,
    `- Checked out revision: ${input.workspace.repoRevision}`,
    `- Requested ref: ${input.ref ?? '(default branch)'}`,
    '',
    'Advisory concept plan:',
    summarizeConceptPlan(input),
    '',
    'Current accepted schema activations:',
    formatSchemaActivations(input.activeSchemaRefs),
    '',
    'Candidate schemas:',
    summarizeSchemaCandidates(input),
    '',
    ...renderGraphifyHintsSection(input.graphifyHints),
    ...(input.schemaValidationCommand
      ? ['Schema selection validation command:', `- ${input.schemaValidationCommand}`, '']
      : []),
    renderSchemaFlowCatalogForPrompt(input.schemaFlowCatalog),
    '',
  ];
}

function buildLevel0ReviewRules(compact: boolean): string[] {
  return [
    'Backbone review rules:',
    '- Review and edit the current accepted level-0 backbone. Do not restart from scratch unless the current coarse structure is fundamentally wrong.',
    '- Keep every level-0 entity top-level. Do not introduce nesting in this review pass.',
    '- Preserve stable ids for surviving entities and relations whenever possible.',
    '- You may merge, split, add, remove, retype, or reroute level-0 entities and relations when that materially improves the coarse architecture.',
    '- You may add schemaRefs when the reviewed backbone clearly needs another cataloged schema and the schema descriptions make that need explicit.',
    '- If you add or change schemaRefs and a schema selection validation command is available, run it with the candidate YAML on stdin before finalizing. Do not keep schema refs that the command rejects.',
    '- Focus on architectural coherence, not local detail.',
    '- Use the active schema flow catalogue as the flow contract: source types need outgoing flow, sink types need incoming flow, and flow-through types need both unless mayTerminate is true.',
    '- Prefer a clean, believable coarse runtime flow over a literal inventory of planner concepts.',
    '- Remove actor/context leakage, empty wrappers, redundant coarse nodes, and obvious over-splitting when the repo evidence supports a better grouping.',
    '- Keep provenance paths repo-relative only. Never prefix them with target-repo/ or workspace directories.',
    ...(compact
      ? [
          '- Reuse the schema contract, meta-ontology, and schema-selection guidance already established earlier in this backbone-review thread.',
        ]
      : []),
  ];
}

function buildLevel0OutputRequirements(): string[] {
  return [
    'Output requirements:',
    '- Return YAML only. Do not wrap it in markdown fences.',
    '- Output a semantic document, not a source document.',
    '- Include version, schemaRefs, entities, and relations only.',
    '- schemaRefs entries must be objects of the form { schema, layer }.',
    '- Do not include inputs, imports, view, or layout.',
    '- Keep all level-0 entities top-level; do not use nesting at this stage.',
    '- Use only existing ontology type ids from the active schemas.',
    '- Every entity and relation must include provenance in canonical locations form: provenance.locations[] entries with input: primary and repo-relative path. Do not use provenance.input/provenance.paths shorthand. Never prefix provenance paths with target-repo/ or other workspace directories.',
  ];
}

export function buildLevel0BackboneReviewPrompt(
  input: Level0BackboneReviewerInput,
  options: { compact?: boolean } = {},
): string {
  const compact = options.compact ?? false;
  return [
    'Review the accepted level-0 semantic backbone YAML for the repository and return an improved level-0 backbone if needed.',
    '',
    ...(compact
      ? [
          'Continue the existing backbone-review conversation.',
          'Reuse the schema contract, schema-selection guidance, and repository context already provided earlier in this thread. Prefer the deterministic context below if it conflicts with earlier conversational guesses.',
          '',
        ]
      : []),
    ...buildPromptHeader(input),
    ...(compact
      ? []
      : [
          renderSchemaSelectionGuidance(input.promptPackage),
          '',
          renderSharedDiagramPromptGuidance(input.promptPackage),
          '',
        ]),
    'Current flow analysis summary:',
    summarizeFlowBuildStateForPrompt(input.flowBuildState),
    '',
    'Current accepted level-0 YAML:',
    input.currentBackboneYaml,
    '',
    ...buildLevel0ReviewRules(compact),
    '',
    ...buildLevel0OutputRequirements(),
  ].join('\n');
}

export function buildLevel0BackboneReviewRepairPrompt(
  input: Level0BackboneReviewerRepairerInput,
  options: { compact?: boolean } = {},
): string {
  const compact = options.compact ?? false;
  return [
    'Repair the reviewed level-0 semantic backbone YAML for the repository.',
    '',
    ...(compact
      ? [
          'Continue the existing backbone-review conversation.',
          'Reuse the previously established schema contract and guidance. Focus on repairing the current reviewed backbone and diagnostics below.',
          '',
        ]
      : []),
    ...buildPromptHeader(input),
    ...(compact ? [] : [renderSchemaSelectionGuidance(input.promptPackage), '']),
    `- Repair attempt: ${input.attempt}`,
    '',
    'Current accepted backbone flow summary:',
    summarizeFlowBuildStateForPrompt(input.flowBuildState),
    '',
    'Diagnostics to fix:',
    JSON.stringify(input.diagnostics, null, 2),
    '',
    'Current reviewed YAML to repair:',
    input.previousReviewYaml,
    '',
    ...(compact ? [] : [renderSharedDiagramPromptGuidance(input.promptPackage), '']),
    'Repair rules:',
    '- Preserve the good parts of the reviewed backbone; do not restart from scratch unless the reviewed output is fundamentally unusable.',
    '- Keep all entities top-level; do not introduce nesting.',
    '- Preserve stable ids for surviving entities and relations whenever possible.',
    '- Keep the backbone focused on runtime architecture and coarse flow. Do not add local implementation detail.',
    '- Repair schemaRefs, entity typing, provenance, and coarse flow issues without drifting away from the accepted repo evidence.',
    '',
    ...buildLevel0OutputRequirements(),
  ].join('\n');
}

export class CodexLevel0BackboneReviewer
  implements Level0BackboneReviewer, Level0BackboneReviewerRepairer
{
  private readonly client: CodexClientLike;
  private readonly options: CodexLevel0BackboneReviewerOptions;

  constructor(options: CodexLevel0BackboneReviewerOptions = {}) {
    this.options = options;
    this.client = options.client ?? new Codex(options.clientOptions);
  }

  private startThread(workspaceRoot: string): CodexThreadLike {
    return createReadOnlyThread(this.client, {
      workingDirectory: workspaceRoot,
      model: this.options.model,
      modelReasoningEffort: this.options.modelReasoningEffort,
    });
  }

  async reviewLevel0Backbone(
    input: Level0BackboneReviewerInput,
  ): Promise<Level0BackboneReviewerResult> {
    const prompt = buildLevel0BackboneReviewPrompt(input, {
      compact: input.promptRunner?.isScopePrimed('backbone-review') ?? false,
    });
    const turn = input.promptRunner
      ? await input.promptRunner.runPrompt({
          prompt,
          operation: 'advanced level-0 backbone review',
          scope: 'backbone-review',
          handoffArtifactPath: input.handoffArtifactPath,
          timeoutMs: this.options.turnTimeoutMs,
        })
      : await (async () => {
          let thread = this.startThread(input.workspace.jobRoot);
          const result = await runCodexPrompt(thread, prompt, {
            operation: 'advanced level-0 backbone review',
            timeoutMs: this.options.turnTimeoutMs,
            reasoningEffort: this.options.modelReasoningEffort,
            freshThread: () => {
              thread = this.startThread(input.workspace.jobRoot);
              return thread;
            },
          });
          return {
            ...result,
            threadId: thread.id,
          };
        })();
    try {
      const rawYaml = extractYamlResponse(turn.finalResponse);
      const parsed = parseDocument(rawYaml);
      const sanitized = normalizeGeneratedDocument(
        {
          ...parsed,
          inputs: undefined,
          view: undefined,
        },
        input.semantics,
      );
      const sanitizedRawYaml = serializeDocument(sanitized).trim();

      return {
        rawYaml: sanitizedRawYaml,
        doc: sanitized,
        rawResponse: turn.finalResponse,
        threadId: turn.threadId,
        tokenUsage: tokenUsageFromSdkUsage(turn.usage),
      };
    } catch (error) {
      throw new ModelOutputParseError({
        operation: 'advanced level-0 backbone review',
        expectedFormat: 'yaml',
        rawResponse: turn.finalResponse,
        threadId: turn.threadId,
        tokenUsage: tokenUsageFromSdkUsage(turn.usage),
        cause: error,
      });
    }
  }

  async repairLevel0BackboneReview(
    input: Level0BackboneReviewerRepairerInput,
  ): Promise<Level0BackboneReviewerResult> {
    const prompt = buildLevel0BackboneReviewRepairPrompt(input, {
      compact: input.promptRunner?.isScopePrimed('backbone-review') ?? false,
    });
    const turn = input.promptRunner
      ? await input.promptRunner.runPrompt({
          prompt,
          operation: `advanced level-0 backbone review repair attempt ${input.attempt}`,
          scope: 'backbone-review',
          handoffArtifactPath: input.handoffArtifactPath,
          timeoutMs: this.options.turnTimeoutMs,
        })
      : await (async () => {
          let thread = this.startThread(input.workspace.jobRoot);
          const result = await runCodexPrompt(thread, prompt, {
            operation: `advanced level-0 backbone review repair attempt ${input.attempt}`,
            timeoutMs: this.options.turnTimeoutMs,
            reasoningEffort: this.options.modelReasoningEffort,
            freshThread: () => {
              thread = this.startThread(input.workspace.jobRoot);
              return thread;
            },
          });
          return {
            ...result,
            threadId: thread.id,
          };
        })();
    try {
      const rawYaml = extractYamlResponse(turn.finalResponse);
      const parsed = parseDocument(rawYaml);
      const sanitized = normalizeGeneratedDocument(
        {
          ...parsed,
          inputs: undefined,
          view: undefined,
        },
        input.semantics,
      );
      const sanitizedRawYaml = serializeDocument(sanitized).trim();

      return {
        rawYaml: sanitizedRawYaml,
        doc: sanitized,
        rawResponse: turn.finalResponse,
        threadId: turn.threadId,
        tokenUsage: tokenUsageFromSdkUsage(turn.usage),
      };
    } catch (error) {
      throw new ModelOutputParseError({
        operation: `advanced level-0 backbone review repair attempt ${input.attempt}`,
        expectedFormat: 'yaml',
        rawResponse: turn.finalResponse,
        threadId: turn.threadId,
        tokenUsage: tokenUsageFromSdkUsage(turn.usage),
        cause: error,
      });
    }
  }
}
