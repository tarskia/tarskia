import path from 'node:path';
import { Codex, type CodexOptions, type ThreadOptions } from '@openai/codex-sdk';
import type {
  GraphCollator,
  GraphCollatorInput,
  GraphCollatorRepairer,
  GraphCollatorRepairInput,
  GraphCollatorResult,
} from '../advanced/graph-builders';
import { renderSchemaFlowCatalogForPrompt } from '../advanced/schema-flow-catalog';
import { parseDocument, serializeDocument } from '../semantic';
import { normalizeGeneratedDocument } from '../semantic/generated-document-normalizer';
import { tokenUsageFromSdkUsage } from '../token-usage';
import type { CodexClientLike, CodexThreadLike } from './diagram-agent';
import { extractYamlResponse } from './diagram-agent';
import { ModelOutputParseError } from './model-output-error';
import { renderSharedDiagramPromptGuidance } from './prompt-package';
import { createReadOnlyThread } from './read-only-thread';
import { runCodexPrompt } from './run-codex-prompt';

const ASSEMBLED_REFINED_DOCUMENT_ARTIFACT = 'analysis/assembled-refined-document.yaml';
const LEVEL0_BACKBONE_ARTIFACT = 'analysis/level0-backbone.yaml';
const NODE_REFINEMENT_STATE_ARTIFACT = 'analysis/node-refinement-state.json';
const FINAL_GRAPH_ARTIFACT = 'analysis/final-graph.yaml';

function formatSchemaActivations(activations: Array<{ schema: string; layer: number }>): string {
  return activations.length > 0
    ? activations
        .map((activation) => `- ${activation.schema} (layer ${activation.layer})`)
        .join('\n')
    : '- None';
}

export interface CodexGraphCollatorOptions {
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

function buildGraphCollationSummary(input: GraphCollatorInput): string {
  const listEntities = (
    entities: typeof input.assembledDoc.entities,
  ): typeof input.assembledDoc.entities =>
    entities.flatMap((entity) => [entity, ...listEntities(entity.children ?? [])]);
  const assembledEntities = listEntities(input.assembledDoc.entities);
  const rootEntityIds = new Set(input.assembledDoc.entities.map((entity) => entity.id));
  const childRelationCount = input.assembledDoc.relations.filter(
    (relation) => relation.from.includes('/') || relation.to.includes('/'),
  ).length;

  return JSON.stringify(
    {
      assembledDocument: {
        entityCount: assembledEntities.length,
        relationCount: input.assembledDoc.relations.length,
        childRelationCount,
        rootEntityIds: Array.from(rootEntityIds),
      },
      level0Backbone: {
        visibleResponsibilityCount: input.level0Backbone.visibleResponsibilityIds.length,
        level0EdgeCount: input.level0Backbone.level0EdgeIds.length,
        terminatedNodeCount: input.level0Backbone.terminatedNodes.length,
      },
      nodeRefinement: {
        rootNodeIds: input.nodeRefinementState.rootNodeIds,
        queueCount: input.nodeRefinementState.queue.length,
        refinedNodeCount: Object.keys(input.nodeRefinementState.nodesById).length,
        edgeContractCount: input.nodeRefinementState.edgeContracts.length,
      },
    },
    null,
    2,
  );
}

export function buildGraphCollationPrompt(
  input: GraphCollatorInput,
  options: { compact?: boolean } = {},
): string {
  const compact = options.compact ?? false;
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
  const assembledDocArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, ASSEMBLED_REFINED_DOCUMENT_ARTIFACT),
  );
  const nodeRefinementArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, NODE_REFINEMENT_STATE_ARTIFACT),
  );
  const level0BackboneArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, LEVEL0_BACKBONE_ARTIFACT),
  );
  const currentGraphArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, FINAL_GRAPH_ARTIFACT),
  );

  return [
    'Collate the assembled advanced diagram into the final semantic document YAML.',
    '',
    ...(compact
      ? [
          'Continue the existing graph-collation conversation.',
          'Reuse the schema contract and collation rules already established earlier in this thread. Prefer the deterministic assembled graph and summaries below over earlier speculative context.',
          '',
        ]
      : []),
    'Workspace layout:',
    `- Target repository: ${targetRepoPath}`,
    `- Schema repository: ${schemaRepoPath}`,
    `- Prompt contract artifact: ${promptContractArtifactPath}`,
    `- Schema catalog artifact: ${schemaCatalogArtifactPath}`,
    `- Schema flow catalogue artifact: ${schemaFlowCatalogArtifactPath}`,
    '',
    'Repository context:',
    `- Clone URL: ${input.repo}`,
    `- Checked out revision: ${input.workspace.repoRevision}`,
    `- Requested ref: ${input.ref ?? '(default branch)'}`,
    '',
    'Active schema refs for the final graph:',
    formatSchemaActivations(input.activeSchemaRefs),
    '',
    ...(input.schemaValidationCommand
      ? ['Schema selection validation command:', `- ${input.schemaValidationCommand}`, '']
      : []),
    renderSchemaFlowCatalogForPrompt(input.schemaFlowCatalog),
    '',
    'Canonical artifacts to inspect before collating:',
    `- Assembled refined document: ${assembledDocArtifactPath}`,
    `- Node-refinement state: ${nodeRefinementArtifactPath}`,
    `- Level-0 backbone: ${level0BackboneArtifactPath}`,
    `- Current final graph checkpoint: ${currentGraphArtifactPath}`,
    '',
    'Deterministic summary:',
    buildGraphCollationSummary(input),
    '',
    ...(compact ? [] : [renderSharedDiagramPromptGuidance(input.promptPackage), '']),
    'Collation rules:',
    '- Keep the final graph focused on shipped runtime architecture. Treat packaging/install/bootstrap artifacts as supporting evidence for runtime boundaries, not as collation-time promotions, unless delivery/runtime operations are explicitly central to the architecture.',
    '- Preserve the assembled containment tree and refined edge set unless a minimal top-level reconciliation is needed.',
    '- Do not collapse descendant relations back to level-0 relations. Every assembled relation with a child endpoint must remain present with the same id, endpoints, and relation type unless it is deterministically invalid.',
    '- Do not invent containment wrappers or synthetic fallback groups.',
    '- If you change schemaRefs and a schema selection validation command is available, run it with the candidate YAML on stdin before finalizing. Do not keep schema refs that the command rejects.',
    '- Keep all explicit provenance in canonical locations form: provenance.locations[] entries with input: primary and repo-relative path. Never prefix provenance paths with target-repo/ or other workspace directories. Do not use provenance.input/provenance.paths shorthand.',
    '',
    'Output requirements:',
    '- Return YAML only. Do not wrap it in markdown fences.',
    '- Output a semantic document, not a source document.',
    '- Use exactly the active schema refs listed above.',
    '- Do not retype child nodes.',
    '- Root-owned inferred external nodes may remain if they are needed to preserve the backbone.',
    '- Keep all explicit provenance in canonical locations form: provenance.locations[] entries with input: primary and repo-relative path. Never prefix provenance paths with target-repo/ or other workspace directories. Do not use provenance.input/provenance.paths shorthand.',
  ].join('\n');
}

export function buildGraphCollationRepairPrompt(
  input: GraphCollatorRepairInput,
  options: { compact?: boolean } = {},
): string {
  const compact = options.compact ?? false;
  return [
    'Repair the final advanced graph collation YAML.',
    '',
    ...(compact
      ? [
          'Continue the existing graph-collation conversation.',
          'Reuse the previously established schema contract and collation rules. Focus on the deterministic diagnostics and candidate graph below.',
          '',
        ]
      : []),
    `- Repair attempt: ${input.attempt}`,
    '',
    'Validation diagnostics to fix:',
    JSON.stringify(input.diagnostics, null, 2),
    '',
    'Previous graph YAML:',
    input.previousYaml,
    '',
    buildGraphCollationPrompt(input, { compact }),
  ].join('\n');
}

export class CodexGraphCollator implements GraphCollator, GraphCollatorRepairer {
  private readonly client: CodexClientLike;
  private readonly options: CodexGraphCollatorOptions;

  constructor(options: CodexGraphCollatorOptions = {}) {
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

  async collateGraph(input: GraphCollatorInput): Promise<GraphCollatorResult> {
    const prompt = buildGraphCollationPrompt(input, {
      compact: input.promptRunner?.isScopePrimed('graph-collation') ?? false,
    });
    return this.runGraphTurn(input, prompt, 'advanced graph collation');
  }

  async repairGraph(input: GraphCollatorRepairInput): Promise<GraphCollatorResult> {
    const prompt = buildGraphCollationRepairPrompt(input, {
      compact: input.promptRunner?.isScopePrimed('graph-collation') ?? false,
    });
    return this.runGraphTurn(
      input,
      prompt,
      `advanced graph collation repair attempt ${input.attempt}`,
    );
  }

  private async runGraphTurn(
    input: GraphCollatorInput,
    prompt: string,
    operation: string,
  ): Promise<GraphCollatorResult> {
    const turn = input.promptRunner
      ? await input.promptRunner.runPrompt({
          prompt,
          operation,
          scope: 'graph-collation',
          handoffArtifactPath: input.handoffArtifactPath,
          timeoutMs: this.options.turnTimeoutMs,
        })
      : await (async () => {
          let thread = this.startThread(input.workspace.jobRoot);
          const result = await runCodexPrompt(thread, prompt, {
            operation,
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
          schemaRefs: [...input.activeSchemaRefs],
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
        operation,
        expectedFormat: 'yaml',
        rawResponse: turn.finalResponse,
        threadId: turn.threadId,
        tokenUsage: tokenUsageFromSdkUsage(turn.usage),
        cause: error,
      });
    }
  }
}
