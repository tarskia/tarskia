import path from 'node:path';
import { Codex, type CodexOptions, type ThreadOptions } from '@openai/codex-sdk';
import { summarizeFlowBuildStateForPrompt } from '../advanced/flow-build-state';
import type {
  Wave1Reviewer,
  Wave1ReviewerInput,
  Wave1ReviewerRepairer,
  Wave1ReviewerRepairerInput,
  Wave1ReviewerResult,
} from '../advanced/graph-builders';
import { renderSchemaFlowCatalogForPrompt } from '../advanced/schema-flow-catalog';
import { parseWave1ReviewPatchResponse } from '../advanced/wave1-review';
import { tokenUsageFromSdkUsage } from '../token-usage';
import type { CodexClientLike, CodexThreadLike } from './diagram-agent';
import { renderGraphifyHintsSection } from './graphify-hints-prompt';
import { ModelOutputParseError } from './model-output-error';
import { renderSchemaSelectionGuidance, renderSharedDiagramPromptGuidance } from './prompt-package';
import { createReadOnlyThread } from './read-only-thread';
import { runCodexPrompt } from './run-codex-prompt';

export interface CodexWave1ReviewerOptions {
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

function summarizeSchemaCandidates(input: Wave1ReviewerInput): string {
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

function buildPromptHeader(input: Wave1ReviewerInput): string[] {
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
  const wave1DocumentArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, 'analysis/wave1-document.yaml'),
  );
  const wave1SummaryArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, 'analysis/wave1-summary.json'),
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
    `- Wave-1 partial document artifact: ${wave1DocumentArtifactPath}`,
    `- Wave-1 summary artifact: ${wave1SummaryArtifactPath}`,
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

function buildReviewRules(compact: boolean): string[] {
  return [
    'Wave-1 review rules:',
    '- Review the current first-level decomposition after all root refinements have completed and before any depth-1 node is refined.',
    '- Edit the reviewed backbone roots and direct children only. Do not introduce brand-new root ids in this pass.',
    '- This is a first-level patch only: rootEdits[].refinement.children entries are direct children, must not contain nested children, and their localId values must not contain "/".',
    '- Preserve stable ids for surviving roots, children, and relations whenever possible.',
    '- You may update, remove, retype, move, or add direct children under existing roots when that improves the first-level architecture.',
    '- Direct children marked leaf must be concrete nodes that are valid without children. If you need a group-like/container child, mark it expand and let the later node-refinement pass fill it.',
    '- You may update root-to-root coarse relations using replaceRootRelations only when replacing the coarse level-0 edge set with a non-empty complete list.',
    '- Use add/update/remove visible relation edits only for first-level visible relations among roots and direct children. Never point a visible relation at a grandchild or a not-yet-created descendant.',
    '- Use root refinement edits when a root needs a different first-level child forest, queue decisions, local relations, inherited edge bindings, or edge proposals.',
    '- To retarget an inherited coarse edge to a direct child, prefer rootEdits[].refinement.edgeRefinements with child local ids instead of rewriting the inherited visible relation directly.',
    '- Do not break source/sink/flow-through continuity when replacing root arrays or first-level children: source children need outgoing flow, sink children need incoming flow, and flow-through children need both unless the catalogue marks them terminal.',
    '- If you emit suggestedSchemaRefs and a schema selection validation command is available, run it with the JSON patch on stdin before finalizing. Do not keep schema refs that the command rejects.',
    '- Focus on architectural balance and coherence at the first zoom level: runtime separation, storage shape, async grouping, and comparable depth across sibling roots.',
    ...(compact
      ? [
          '- Reuse the earlier wave1-review thread context and the deterministic artifacts it references instead of re-deriving the contract from scratch.',
        ]
      : []),
  ];
}

function buildOutputContract(): string[] {
  return [
    'Return JSON only with this exact shape:',
    '{',
    '  "rootEdits": [',
    '    {',
    '      "rootId": "existing-root-id",',
    '      "removeRoot": false,',
    '      "root": {',
    '        "typeId": "optional replacement type id",',
    '        "name": "optional replacement name",',
    '        "description": "optional replacement description",',
    '        "props": {"optional": "replacement props"},',
    '        "evidence": [{"path": "repo/path", "reason": "why the root edit is justified"}]',
    '      },',
    '      "refinement": {',
    '        "description": "optional reviewed root description",',
    '        "children": [',
    '          {',
    '            "localId": "child-local-id",',
    '            "name": "Child name",',
    '            "description": "optional description",',
    '            "typeId": "schema/type",',
    '            "props": {"optional": "props"},',
    '            "scope": ["repo/path"],',
    '            "evidence": [{"path": "repo/path", "reason": "why this child exists"}],',
    '            "queueDecision": "leaf|expand"',
    '          }',
    '        ],',
    '        "relations": [',
    '          {',
    '            "localId": "child-edge-id",',
    '            "typeId": "schema/relation",',
    '            "fromLocalId": "child-a",',
    '            "toLocalId": "child-b",',
    '            "evidence": [{"path": "repo/path", "reason": "why this relation exists"}]',
    '          }',
    '        ],',
    '        "edgeRefinements": [',
    '          {',
    '            "edgeId": "coarse-edge-id",',
    '            "relationTypeId": "optional replacement relation type",',
    '            "fromChildLocalId": "optional child source",',
    '            "toChildLocalId": "optional child target"',
    '          }',
    '        ],',
    '        "edgeProposals": [',
    '          {',
    '            "edgeId": "coarse-edge-id",',
    '            "endpoint": "from|to",',
    '            "childLocalId": "child-local-id",',
    '            "relationTypeId": "optional replacement relation type"',
    '          }',
    '        ],',
    '        "openQuestions": ["optional unresolved question"],',
    '        "suggestedSchemaRefs": ["optional schema ref"]',
    '      }',
    '    }',
    '  ],',
    '  "replaceRootRelations": [',
    '    {',
    '      "id": "existing-or-new-root-relation-id",',
    '      "typeId": "schema/relation",',
    '      "fromId": "existing-root-id",',
    '      "toId": "existing-root-id",',
    '      "evidence": [{"path": "repo/path", "reason": "why the coarse edge exists"}]',
    '    }',
    '  ],',
    '  "addVisibleRelations": [',
    '    {',
    '      "id": "visible-relation-id",',
    '      "typeId": "schema/relation",',
    '      "fromId": "existing-root-or-direct-child-id",',
    '      "toId": "existing-root-or-direct-child-id",',
    '      "evidence": [{"path": "repo/path", "reason": "why the visible edge exists"}]',
    '    }',
    '  ],',
    '  "updateVisibleRelations": [',
    '    {',
    '      "id": "visible-relation-id",',
    '      "typeId": "schema/relation",',
    '      "fromId": "existing-root-or-direct-child-id",',
    '      "toId": "existing-root-or-direct-child-id",',
    '      "evidence": [{"path": "repo/path", "reason": "why the updated edge exists"}]',
    '    }',
    '  ],',
    '  "removeVisibleRelationIds": ["visible-relation-id"],',
    '  "suggestedSchemaRefs": ["optional schema ref"]',
    '}',
    '',
    'Omit fields you do not need to change. Inside rootEdits[].refinement, omitted fields preserve the existing value; present arrays replace that field; present empty arrays intentionally clear it.',
    'Omit replaceRootRelations unless replacing the full root-to-root coarse relation set with at least one relation. Empty replaceRootRelations is ignored; use removeVisibleRelationIds to remove specific visible edges.',
    'Nested child arrays are not part of this patch contract and will not create grandchildren. Relation endpoints deeper than root/direct-child are invalid at wave 1.',
  ];
}

export function buildWave1ReviewPrompt(
  input: Wave1ReviewerInput,
  options: { compact?: boolean } = {},
): string {
  const compact = options.compact ?? false;
  return [
    'Review the current first-level decomposition of the semantic diagram and return a bounded JSON patch.',
    '',
    ...(compact
      ? [
          'Continue the existing wave1-review conversation and prefer the deterministic artifacts below over any earlier conversational assumptions.',
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
    'Current coarse flow summary:',
    summarizeFlowBuildStateForPrompt(input.flowBuildState),
    '',
    'Current reviewed level-0 backbone YAML:',
    input.level0BackboneYaml,
    '',
    'Current wave-1 partial document YAML:',
    input.wave1DocumentYaml,
    '',
    'Current wave-1 summary JSON:',
    JSON.stringify(input.wave1Summary, null, 2),
    '',
    ...buildReviewRules(compact),
    '',
    ...buildOutputContract(),
  ].join('\n');
}

export function buildWave1ReviewRepairPrompt(
  input: Wave1ReviewerRepairerInput,
  options: { compact?: boolean } = {},
): string {
  const compact = options.compact ?? false;
  return [
    'Repair the wave-1 first-level review patch.',
    '',
    ...(compact
      ? [
          'Continue the existing wave1-review conversation. Focus on fixing the deterministic diagnostics without discarding the good parts of the previous patch.',
          '',
        ]
      : []),
    ...buildPromptHeader(input),
    ...(compact ? [] : [renderSchemaSelectionGuidance(input.promptPackage), '']),
    `- Repair attempt: ${input.attempt}`,
    '',
    'Current coarse flow summary:',
    summarizeFlowBuildStateForPrompt(input.flowBuildState),
    '',
    'Current reviewed level-0 backbone YAML:',
    input.level0BackboneYaml,
    '',
    'Current wave-1 partial document YAML:',
    input.wave1DocumentYaml,
    '',
    ...(input.candidateWave1DocumentYaml
      ? [
          'Candidate wave-1 document after previous patch (failed validation):',
          input.candidateWave1DocumentYaml,
          '',
        ]
      : []),
    'Current wave-1 summary JSON:',
    JSON.stringify(input.wave1Summary, null, 2),
    '',
    'Diagnostics to fix:',
    JSON.stringify(input.diagnostics, null, 2),
    '',
    'Previous patch to repair:',
    JSON.stringify(input.previousPatch, null, 2),
    '',
    'Return a complete replacement patch relative to the current wave-1 partial document, not an incremental delta against the previous patch.',
    '',
    ...buildReviewRules(compact),
    '',
    ...buildOutputContract(),
  ].join('\n');
}

export class CodexWave1Reviewer implements Wave1Reviewer, Wave1ReviewerRepairer {
  private readonly client: CodexClientLike;
  private readonly options: CodexWave1ReviewerOptions;

  constructor(options: CodexWave1ReviewerOptions = {}) {
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

  async reviewWave1(input: Wave1ReviewerInput): Promise<Wave1ReviewerResult> {
    const prompt = buildWave1ReviewPrompt(input, {
      compact: input.promptRunner?.isScopePrimed('wave1-review') ?? false,
    });
    const turn = input.promptRunner
      ? await input.promptRunner.runPrompt({
          prompt,
          operation: 'advanced wave-1 review',
          scope: 'wave1-review',
          handoffArtifactPath: input.handoffArtifactPath,
          timeoutMs: this.options.turnTimeoutMs,
        })
      : await (async () => {
          let thread = this.startThread(input.workspace.jobRoot);
          const result = await runCodexPrompt(thread, prompt, {
            operation: 'advanced wave-1 review',
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
      return {
        patch: parseWave1ReviewPatchResponse(turn.finalResponse),
        rawResponse: turn.finalResponse,
        threadId: turn.threadId,
        tokenUsage: tokenUsageFromSdkUsage(turn.usage),
      };
    } catch (error) {
      throw new ModelOutputParseError({
        operation: 'advanced wave-1 review',
        expectedFormat: 'json',
        rawResponse: turn.finalResponse,
        threadId: turn.threadId,
        tokenUsage: tokenUsageFromSdkUsage(turn.usage),
        cause: error,
      });
    }
  }

  async repairWave1Review(input: Wave1ReviewerRepairerInput): Promise<Wave1ReviewerResult> {
    const prompt = buildWave1ReviewRepairPrompt(input, {
      compact: input.promptRunner?.isScopePrimed('wave1-review') ?? false,
    });
    const turn = input.promptRunner
      ? await input.promptRunner.runPrompt({
          prompt,
          operation: `advanced wave-1 review repair attempt ${input.attempt}`,
          scope: 'wave1-review',
          handoffArtifactPath: input.handoffArtifactPath,
          timeoutMs: this.options.turnTimeoutMs,
        })
      : await (async () => {
          let thread = this.startThread(input.workspace.jobRoot);
          const result = await runCodexPrompt(thread, prompt, {
            operation: `advanced wave-1 review repair attempt ${input.attempt}`,
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
      return {
        patch: parseWave1ReviewPatchResponse(turn.finalResponse),
        rawResponse: turn.finalResponse,
        threadId: turn.threadId,
        tokenUsage: tokenUsageFromSdkUsage(turn.usage),
      };
    } catch (error) {
      throw new ModelOutputParseError({
        operation: `advanced wave-1 review repair attempt ${input.attempt}`,
        expectedFormat: 'json',
        rawResponse: turn.finalResponse,
        threadId: turn.threadId,
        tokenUsage: tokenUsageFromSdkUsage(turn.usage),
        cause: error,
      });
    }
  }
}
