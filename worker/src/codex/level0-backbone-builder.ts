import path from 'node:path';
import { Codex, type CodexOptions, type ThreadOptions } from '@openai/codex-sdk';
import { listPlanConcepts } from '../advanced/concept-plan';
import { summarizeFlowBuildStateForPrompt } from '../advanced/flow-build-state';
import type {
  Level0BackboneBuilder,
  Level0BackboneBuilderInput,
  Level0BackboneBuilderResult,
  Level0BackboneRepairer,
  Level0BackboneRepairerInput,
  Level0BackboneRepairerResult,
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

export interface CodexLevel0BackboneBuilderOptions {
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

  return [
    'Workspace layout:',
    `- Target repository: ${targetRepoPath}`,
    `- Schema repository: ${schemaRepoPath}`,
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
    'Planner-selected initial schema activations:',
    formatSchemaActivations(input.activeSchemaRefs),
    '',
    'Planner-selected candidate schemas:',
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

function buildRuntimeArchitectureRules(compact: boolean): string[] {
  return [
    'Level-0 flow establishment rules:',
    '- Level 0 establishes the primary runtime/data path(s) before any deeper refinement.',
    '- All levels are about runtime architecture. Prefer shipped runtime boundaries over build tooling, tests, examples, local dev helpers, packaging/install scaffolding, and dev-only endpoints.',
    '- Use bootstrap files, package manifests, service units, postinstall hooks, completions, installers, and container/init wiring as evidence for shipped runtime boundaries, not as level-0 nodes, unless delivery/install operations are themselves a primary runtime concern.',
    '- Prefer a coherent coarse flow over a literal inventory of every responsibility.',
    '- Start from strong anchors such as UI/frontend, protocol surfaces, services, jobs, queues/topics, datastores, external APIs, and major coordination boundaries.',
    '- Start schema selection from the planner-selected initial schema activations. You may add more schema activations in schemaRefs when the backbone clearly needs another cataloged schema.',
    '- Prefer candidate schemas and their suggested layers when augmenting the schema set. If another schema is clearly needed, add it only when the ontology descriptions make that need explicit.',
    '- If you add or change schemaRefs and a schema selection validation command is available, run it with the candidate YAML on stdin before finalizing. Do not keep schema refs that the command rejects.',
    '- Treat concept-plan items as evidence-backed review material, not required nodes.',
    '- You may merge multiple concepts into one top-level boundary when they form one coherent runtime plane.',
    '- You may demote a concept beneath another root when that yields a clearer coarse flow.',
    '- If a level-0 node clearly corresponds to one concept, prefer reusing that concept id for stability.',
    '- When one backbone node merges several concepts, include provenance paths that cover the merged concepts so downstream refinement keeps the right scope.',
    '- You may add inferred external/runtime nodes when needed to complete an obvious flow, but keep them few and high-confidence.',
    '- If you materialize an inferred external node, choose a stable local id and a real ontology type.',
    '- Reuse an existing expectation id as the relation id whenever a coarse edge clearly corresponds to that expectation.',
    '- A level-0 edge should connect coarse boundaries only. Do not emit containment edges and do not model descendant-to-descendant refinements yet.',
    '- The goal is a terminated coarse backbone: visible through-nodes should have meaningful ingress and egress unless they are acceptable boundaries.',
    '- Use the active schema flow catalogue as the flow contract: source types need outgoing flow, sink types need incoming flow, and flow-through types need both unless mayTerminate is true.',
    '- Look for a client/caller before accepting an API or protocol boundary as a terminal stop.',
    '- Add short descriptions to entities and relations when they help explain what the boundary or connection is. Keep them to a noun phrase or one short sentence.',
    ...(compact
      ? [
          '- Reuse the schema contract, meta-ontology, and schema-selection guidance already established earlier in this pre-refinement thread.',
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

export function buildLevel0BackbonePrompt(
  input: Level0BackboneBuilderInput,
  options: { compact?: boolean } = {},
): string {
  const compact = options.compact ?? false;
  return [
    'Generate the level-0 semantic backbone YAML for the repository.',
    '',
    ...(compact
      ? [
          'Continue the existing pre-refinement conversation.',
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
    ...buildRuntimeArchitectureRules(compact),
    '',
    ...buildLevel0OutputRequirements(),
  ].join('\n');
}

export function buildLevel0BackboneRepairPrompt(
  input: Level0BackboneRepairerInput,
  options: { compact?: boolean } = {},
): string {
  const compact = options.compact ?? false;
  return [
    'Repair the level-0 semantic backbone YAML for the repository.',
    '',
    ...(compact
      ? [
          'Continue the existing pre-refinement conversation.',
          'Reuse the previously established schema contract and guidance. Focus on repairing the current deterministic backbone and diagnostics below.',
          '',
        ]
      : []),
    ...buildPromptHeader(input),
    ...(compact ? [] : [renderSchemaSelectionGuidance(input.promptPackage), '']),
    `- Repair attempt: ${input.attempt}`,
    '',
    'Current flow analysis summary:',
    summarizeFlowBuildStateForPrompt(input.flowBuildState),
    '',
    'Diagnostics to fix:',
    JSON.stringify(input.diagnostics, null, 2),
    '',
    'Previous level-0 YAML:',
    input.previousBackboneYaml,
    '',
    ...(compact ? [] : [renderSharedDiagramPromptGuidance(input.promptPackage), '']),
    'Repair rules:',
    '- Keep the backbone focused on runtime architecture. Use packaging/install/bootstrap artifacts as evidence for shipped runtime boundaries rather than as repaired level-0 nodes unless they are the architecture being modeled.',
    '- Continue unresolved through-nodes by adding or rerouting coarse edges when the evidence supports it.',
    '- For mayTerminate boundaries, attempt continuation before leaving them unresolved; APIs should prefer a visible caller/client when one is defensible.',
    '- Preserve good existing backbone structure; do not restart from scratch unless necessary.',
    '- Preserve stable ids for surviving level-0 nodes; only churn ids when the coarse structure materially changes.',
    '- Do not introduce descendant-to-descendant refinements yet; stay at the coarse boundary level.',
    '- Keep any descriptions short. Use a noun phrase or one short sentence.',
    '',
    ...buildLevel0OutputRequirements(),
  ].join('\n');
}

export class CodexLevel0BackboneBuilder implements Level0BackboneBuilder, Level0BackboneRepairer {
  private readonly client: CodexClientLike;
  private readonly options: CodexLevel0BackboneBuilderOptions;

  constructor(options: CodexLevel0BackboneBuilderOptions = {}) {
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

  async buildLevel0Backbone(
    input: Level0BackboneBuilderInput,
  ): Promise<Level0BackboneBuilderResult> {
    const prompt = buildLevel0BackbonePrompt(input, {
      compact: input.promptRunner?.isScopePrimed('pre-refinement') ?? false,
    });
    const turn = input.promptRunner
      ? await input.promptRunner.runPrompt({
          prompt,
          operation: 'advanced level-0 backbone drafting',
          scope: 'pre-refinement',
          handoffArtifactPath: input.handoffArtifactPath,
          timeoutMs: this.options.turnTimeoutMs,
        })
      : await (async () => {
          let thread = this.startThread(input.workspace.jobRoot);
          const result = await runCodexPrompt(thread, prompt, {
            operation: 'advanced level-0 backbone drafting',
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
        operation: 'advanced level-0 backbone drafting',
        expectedFormat: 'yaml',
        rawResponse: turn.finalResponse,
        threadId: turn.threadId,
        tokenUsage: tokenUsageFromSdkUsage(turn.usage),
        cause: error,
      });
    }
  }

  async repairLevel0Backbone(
    input: Level0BackboneRepairerInput,
  ): Promise<Level0BackboneRepairerResult> {
    const prompt = buildLevel0BackboneRepairPrompt(input, {
      compact: input.promptRunner?.isScopePrimed('pre-refinement') ?? false,
    });
    const turn = input.promptRunner
      ? await input.promptRunner.runPrompt({
          prompt,
          operation: `advanced level-0 backbone repair attempt ${input.attempt}`,
          scope: 'pre-refinement',
          handoffArtifactPath: input.handoffArtifactPath,
          timeoutMs: this.options.turnTimeoutMs,
        })
      : await (async () => {
          let thread = this.startThread(input.workspace.jobRoot);
          const result = await runCodexPrompt(thread, prompt, {
            operation: `advanced level-0 backbone repair attempt ${input.attempt}`,
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
        operation: `advanced level-0 backbone repair attempt ${input.attempt}`,
        expectedFormat: 'yaml',
        rawResponse: turn.finalResponse,
        threadId: turn.threadId,
        tokenUsage: tokenUsageFromSdkUsage(turn.usage),
        cause: error,
      });
    }
  }
}
