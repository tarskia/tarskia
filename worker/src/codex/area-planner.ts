import path from 'node:path';
import { Codex, type CodexOptions, type ThreadOptions } from '@openai/codex-sdk';
import type { AreaPlanner, AreaPlannerInput, AreaPlannerResult } from '../advanced/area-plan';
import { parseAreaPlanResponse } from '../advanced/area-plan';
import { tokenUsageFromSdkUsage } from '../token-usage';
import type { CodexClientLike, CodexThreadLike } from './diagram-agent';
import { renderGraphifyHintsSection } from './graphify-hints-prompt';
import { ModelOutputParseError } from './model-output-error';
import { renderSchemaSelectionGuidance } from './prompt-package';
import { createReadOnlyThread } from './read-only-thread';
import { runCodexPrompt } from './run-codex-prompt';

export interface CodexAreaPlannerOptions {
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

function buildAreaPlanningPrompt(input: AreaPlannerInput): string {
  const targetRepoPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    input.workspace.targetRepoPath,
  );
  const censusArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, 'analysis', 'repo-census.json'),
  );
  const promptContractArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, 'prompt-contract.md'),
  );
  const schemaCatalogArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, 'schema-catalog.json'),
  );
  const metaOntologyArtifactPath = toWorkspaceRelativePath(
    input.workspace.jobRoot,
    path.join(input.workspace.workspaceOutputDir, 'meta-ontology.md'),
  );
  const topLevelSummary = input.repoCensus.summary.topLevelPaths
    .slice(0, 10)
    .map(
      (entry) =>
        `- ${entry.path}: ${entry.fileCount} files, ${entry.lineCount} LOC, dominant languages ${Object.keys(
          entry.languages,
        )
          .slice(0, 3)
          .join(', ')}`,
    )
    .join('\n');
  const signalSummary = input.repoCensus.signals
    .slice(0, 12)
    .map((signal) => `- ${signal.kind}: ${signal.path} (${signal.reason})`)
    .join('\n');

  return [
    'Plan advisory architectural concepts for the repository in this workspace.',
    '',
    'Workspace layout:',
    `- Target repository: ${targetRepoPath}`,
    `- Repo census artifact: ${censusArtifactPath}`,
    `- Prompt contract artifact: ${promptContractArtifactPath}`,
    `- Schema catalog artifact: ${schemaCatalogArtifactPath}`,
    `- Meta-ontology artifact: ${metaOntologyArtifactPath}`,
    ...(input.schemaValidationCommand
      ? ['', 'Schema selection validation command:', `- ${input.schemaValidationCommand}`]
      : []),
    '',
    'Repository context:',
    `- Clone URL: ${input.repo}`,
    `- Checked out revision: ${input.workspace.repoRevision}`,
    `- Requested ref: ${input.ref ?? '(default branch)'}`,
    '',
    'Deterministic census summary:',
    `- Total files: ${input.repoCensus.summary.totalFiles}`,
    `- Total directories: ${input.repoCensus.summary.totalDirectories}`,
    `- Total lines: ${input.repoCensus.summary.totalLines}`,
    `- Languages by LOC: ${JSON.stringify(input.repoCensus.summary.languages)}`,
    '',
    'Top-level area candidates:',
    topLevelSummary || '- None',
    '',
    'Existing runtime/infra signals:',
    signalSummary || '- None',
    '',
    ...renderGraphifyHintsSection(input.graphifyHints),
    renderSchemaSelectionGuidance(input.promptPackage),
    '',
    'Read the repo census artifact, schema catalog, and repository files as needed before answering.',
    'Choose layered schema activations for the repository, not just concepts. initialSchemaActivations should be the best starting active set with explicit layers; candidateSchemaRefs should be additional schemas that may become useful later, each with a suggestedLayer.',
    'If a schema selection validation command is available, run it with your full area-plan JSON on stdin before finalizing schema choices. Do not keep schema refs that the command rejects.',
    'Create galleryDescription as a plain-language description of the application or repository in 80 characters or fewer. Do not copy README text, mention the diagram, or describe the generation process.',
    'Create 4 to 12 key architectural concepts that help the backbone reason about the shipped runtime architecture.',
    'At every level, prefer shipped runtime architecture over tests, tooling, examples, local dev helpers, packaging/install scaffolding, and dev-only endpoints.',
    'Treat bootstrap files, package manifests, service units, postinstall hooks, completions, installers, and init wiring as supporting evidence for runtime boundaries rather than concepts in their own right unless delivery/install behavior is itself central to the architecture.',
    'The concepts are advisory review material for the backbone, not required nodes. They do not need to map 1:1 to top-level entities.',
    'Prefer concepts that highlight likely runtime boundaries, major execution planes, protocol surfaces, shared kernels, datastores, or externally meaningful integrations.',
    'Each concept must be anchored to concrete repository paths and evidence.',
    'All paths in paths and evidence must be relative to the target repository root only. Never prefix them with target-repo/, schema-repo/, out/, or any absolute workspace directory.',
    '',
    'Return JSON only with this exact shape:',
    '{',
    '  "repoSummary": "short summary",',
    '  "galleryDescription": "80 characters or fewer",',
    '  "initialSchemaActivations": [',
    '    { "schema": "core/schema@version", "layer": 0 }',
    '  ],',
    '  "candidateSchemaRefs": [',
    '    {',
    '      "schemaRef": "core/schema@version",',
    '      "suggestedLayer": 1,',
    '      "rationale": "why this schema may be needed",',
    '      "evidence": [{"path": "repo/path", "reason": "why it applies"}]',
    '    }',
    '  ],',
    '  "keyConcepts": [',
    '    {',
    '      "id": "stable-kebab-id for concept reference only",',
    '      "kind": "frontend|service|async-plane|runtime-plane|datastore|protocol-surface|shared-kernel|integration|external|unknown",',
    '      "title": "Human title",',
    '      "paths": ["repo/path"],',
    '      "rationale": "why this concept matters to the runtime architecture",',
    '      "evidence": [{"path": "repo/path", "reason": "why it matters"}],',
    '      "groupingHints": ["optional hint about other concepts it may be grouped with"],',
    '      "openQuestions": ["optional uncertainty"]',
    '    }',
    '  ]',
    '}',
  ].join('\n');
}

export class CodexAreaPlanner implements AreaPlanner {
  private readonly client: CodexClientLike;
  private readonly options: CodexAreaPlannerOptions;

  constructor(options: CodexAreaPlannerOptions = {}) {
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

  async planAreas(input: AreaPlannerInput): Promise<AreaPlannerResult> {
    const prompt = buildAreaPlanningPrompt(input);
    const turn = input.promptRunner
      ? await input.promptRunner.runPrompt({
          prompt,
          operation: 'advanced area planning',
          scope: 'pre-refinement',
          handoffArtifactPath: input.handoffArtifactPath,
          timeoutMs: this.options.turnTimeoutMs,
        })
      : await (async () => {
          let thread = this.startThread(input.workspace.jobRoot);
          const result = await runCodexPrompt(thread, prompt, {
            operation: 'advanced area planning',
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
        plan: parseAreaPlanResponse(turn.finalResponse),
        rawResponse: turn.finalResponse,
        threadId: turn.threadId,
        tokenUsage: tokenUsageFromSdkUsage(turn.usage),
      };
    } catch (error) {
      throw new ModelOutputParseError({
        operation: 'advanced area planning',
        expectedFormat: 'json',
        rawResponse: turn.finalResponse,
        threadId: turn.threadId,
        tokenUsage: tokenUsageFromSdkUsage(turn.usage),
        cause: error,
      });
    }
  }
}

export { buildAreaPlanningPrompt };
