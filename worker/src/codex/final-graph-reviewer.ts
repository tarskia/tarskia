import path from 'node:path';
import { Codex, type CodexOptions, type ThreadOptions } from '@openai/codex-sdk';
import type {
  FinalGraphReviewer,
  FinalGraphReviewerInput,
  FinalGraphReviewerRepairer,
  FinalGraphReviewerRepairerInput,
  FinalGraphReviewerResult,
  GraphCollatorInput,
} from '../advanced/graph-builders';
import { renderSchemaFlowCatalogForPrompt } from '../advanced/schema-flow-catalog';
import { parseDocument, serializeDocument } from '../semantic';
import { normalizeGeneratedDocument } from '../semantic/generated-document-normalizer';
import { tokenUsageFromSdkUsage } from '../token-usage';
import type { CodexClientLike, CodexThreadLike } from './diagram-agent';
import { applyGraphEditResponse, renderGraphEditContract } from './graph-edit-response';
import { renderGraphifyHintsSection } from './graphify-hints-prompt';
import { ModelOutputParseError } from './model-output-error';
import { renderSchemaSelectionGuidance, renderSharedDiagramPromptGuidance } from './prompt-package';
import { createReadOnlyThread } from './read-only-thread';
import { runCodexPrompt } from './run-codex-prompt';

export interface CodexFinalGraphReviewerOptions {
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

function buildPromptHeader(
  input: GraphCollatorInput,
  options: { includeCandidateFinalGraphArtifact?: boolean } = {},
): string[] {
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
  const assembledDocArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, 'analysis/assembled-refined-document.yaml'),
  );
  const level0BackboneArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, 'analysis/level0-backbone.yaml'),
  );
  const schemaSetArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, 'analysis/schema-set.json'),
  );
  const currentFinalGraphArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, 'analysis/final-graph.yaml'),
  );
  const finalReviewSummaryArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, 'analysis/final-review.summary.json'),
  );

  return [
    'Workspace layout:',
    `- Target repository: ${targetRepoPath}`,
    `- Schema repository: ${schemaRepoPath}`,
    `- Assembled refined document artifact: ${assembledDocArtifactPath}`,
    `- Level-0 backbone artifact: ${level0BackboneArtifactPath}`,
    `- Schema set artifact: ${schemaSetArtifactPath}`,
    ...(options.includeCandidateFinalGraphArtifact === false
      ? []
      : [`- Candidate final graph artifact: ${currentFinalGraphArtifactPath}`]),
    `- Final-review summary artifact: ${finalReviewSummaryArtifactPath}`,
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
    'Current accepted schema activations:',
    formatSchemaActivations(input.activeSchemaRefs),
    '',
    ...renderGraphifyHintsSection(input.graphifyHints),
    ...(input.schemaValidationCommand
      ? ['Schema selection validation command:', `- ${input.schemaValidationCommand}`, '']
      : []),
    renderSchemaFlowCatalogForPrompt(input.schemaFlowCatalog),
    '',
  ];
}

function buildReviewRules(compact: boolean): string[] {
  return [
    'Final-review rules:',
    '- Inspect the full candidate graph, then return only targeted JSON edits; never reproduce unchanged items.',
    '- Focus on whole-diagram coherence: stable top-level structure, believable containment, clear client/server/storage separation, and edge structure that reads cleanly.',
    '- Preserve every valid input entity and relation unchanged. Edit, reparent, retype, or remove an existing item only to fix a deterministic error on that exact id. Coherence alone does not authorize changing a valid item.',
    '- Do not collapse descendant relations back to level-0 relations. Preserve every assembled relation with a child endpoint using the same id, endpoints, and relation type unless it is deterministically invalid.',
    '- Do not erase source/sink/flow-through continuity while cleaning up the final graph: source nodes need outgoing flow, sink nodes need incoming flow, and flow-through nodes need both unless the catalogue marks them terminal.',
    '- Add entities or relations only when needed to resolve a deterministic error; keep the active schemaRefs unchanged.',
    '- Preserve exact entity and relation ids. Never rename a surviving node or copy it under a shorter containment path.',
    '- Keep provenance repo-relative only. Never prefix paths with target-repo/ or workspace directories.',
    '- Do not add new local detail just because you see more evidence. Prefer coherence and cleanup over extra expansion.',
    ...(compact
      ? [
          '- Reuse the schema contract, meta-ontology, and review context already established earlier in this final-review thread.',
        ]
      : []),
  ];
}

export function buildFinalGraphReviewPrompt(
  input: FinalGraphReviewerInput,
  options: { compact?: boolean } = {},
): string {
  const compact = options.compact ?? false;
  return [
    'Review the candidate final semantic graph for the repository and return targeted JSON edits only.',
    '',
    ...(compact
      ? [
          'Continue the existing final-review conversation.',
          'Reuse the schema contract, review rules, and repository context already established earlier in this thread. Prefer the deterministic artifacts below if they conflict with earlier conversational guesses.',
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
    'Read the candidate final graph artifact listed above; do not copy it into your response.',
    'Deterministic diagnostics on the candidate graph:',
    JSON.stringify(input.diagnostics ?? [], null, 2),
    '',
    'Assembled-vs-collated regression summary JSON:',
    JSON.stringify(input.finalReviewSummary, null, 2),
    '',
    ...buildReviewRules(compact),
    '',
    ...renderGraphEditContract(),
  ].join('\n');
}

export function buildFinalGraphReviewRepairPrompt(
  input: FinalGraphReviewerRepairerInput,
  options: { compact?: boolean } = {},
): string {
  const compact = options.compact ?? false;
  return [
    'Repair the reviewed final semantic graph with targeted JSON edits.',
    '',
    ...(compact
      ? [
          'Continue the existing final-review conversation.',
          'Reuse the previously established schema contract and review guidance. Focus on repairing the current reviewed graph and diagnostics below.',
          '',
        ]
      : []),
    ...buildPromptHeader(input, { includeCandidateFinalGraphArtifact: false }),
    ...(compact ? [] : [renderSchemaSelectionGuidance(input.promptPackage), '']),
    `- Repair attempt: ${input.attempt}`,
    '',
    'Assembled-vs-collated regression summary JSON:',
    JSON.stringify(input.finalReviewSummary, null, 2),
    '',
    'Diagnostics to fix:',
    JSON.stringify(input.diagnostics, null, 2),
    '',
    `Current reviewed graph to repair: ${toWorkspaceRelativePath(input.workspace.jobRoot, path.join(input.workspace.workspaceOutputDir, 'analysis/final-review.candidate.yaml'))}`,
    'Read this artifact as the patch base. Do not use an earlier candidate or copy unchanged items into your response.',
    '',
    ...(compact ? [] : [renderSharedDiagramPromptGuidance(input.promptPackage), '']),
    ...buildReviewRules(compact),
    '',
    ...renderGraphEditContract(),
  ].join('\n');
}

export class CodexFinalGraphReviewer implements FinalGraphReviewer, FinalGraphReviewerRepairer {
  private readonly client: CodexClientLike;
  private readonly options: CodexFinalGraphReviewerOptions;

  constructor(options: CodexFinalGraphReviewerOptions = {}) {
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

  async reviewFinalGraph(input: FinalGraphReviewerInput): Promise<FinalGraphReviewerResult> {
    const prompt = buildFinalGraphReviewPrompt(input, {
      compact: input.promptRunner?.isScopePrimed('final-review') ?? false,
    });
    const turn = input.promptRunner
      ? await input.promptRunner.runPrompt({
          prompt,
          operation: 'advanced final graph review',
          scope: 'final-review',
          handoffArtifactPath: input.handoffArtifactPath,
          timeoutMs: this.options.turnTimeoutMs,
        })
      : await (async () => {
          let thread = this.startThread(input.workspace.jobRoot);
          const result = await runCodexPrompt(thread, prompt, {
            operation: 'advanced final graph review',
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
      const parsed = applyGraphEditResponse(
        parseDocument(input.currentFinalGraphYaml),
        turn.finalResponse,
      );
      const sanitized = normalizeGeneratedDocument(
        {
          ...parsed,
          inputs: undefined,
          view: undefined,
        },
        input.semantics,
      );
      return {
        rawYaml: serializeDocument(sanitized).trim(),
        doc: sanitized,
        rawResponse: turn.finalResponse,
        threadId: turn.threadId,
        tokenUsage: tokenUsageFromSdkUsage(turn.usage),
      };
    } catch (error) {
      throw new ModelOutputParseError({
        operation: 'advanced final graph review',
        expectedFormat: 'json',
        rawResponse: turn.finalResponse,
        threadId: turn.threadId,
        tokenUsage: tokenUsageFromSdkUsage(turn.usage),
        cause: error,
      });
    }
  }

  async repairFinalGraphReview(
    input: FinalGraphReviewerRepairerInput,
  ): Promise<FinalGraphReviewerResult> {
    const prompt = buildFinalGraphReviewRepairPrompt(input, {
      compact: input.promptRunner?.isScopePrimed('final-review') ?? false,
    });
    const turn = input.promptRunner
      ? await input.promptRunner.runPrompt({
          prompt,
          operation: `advanced final graph review repair attempt ${input.attempt}`,
          scope: 'final-review',
          handoffArtifactPath: input.handoffArtifactPath,
          timeoutMs: this.options.turnTimeoutMs,
        })
      : await (async () => {
          let thread = this.startThread(input.workspace.jobRoot);
          const result = await runCodexPrompt(thread, prompt, {
            operation: `advanced final graph review repair attempt ${input.attempt}`,
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
      const parsed = applyGraphEditResponse(
        parseDocument(input.previousReviewYaml),
        turn.finalResponse,
      );
      const sanitized = normalizeGeneratedDocument(
        {
          ...parsed,
          inputs: undefined,
          view: undefined,
        },
        input.semantics,
      );
      return {
        rawYaml: serializeDocument(sanitized).trim(),
        doc: sanitized,
        rawResponse: turn.finalResponse,
        threadId: turn.threadId,
        tokenUsage: tokenUsageFromSdkUsage(turn.usage),
      };
    } catch (error) {
      throw new ModelOutputParseError({
        operation: `advanced final graph review repair attempt ${input.attempt}`,
        expectedFormat: 'json',
        rawResponse: turn.finalResponse,
        threadId: turn.threadId,
        tokenUsage: tokenUsageFromSdkUsage(turn.usage),
        cause: error,
      });
    }
  }
}
