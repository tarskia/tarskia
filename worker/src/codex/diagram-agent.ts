import path from 'node:path';
import {
  Codex,
  type CodexOptions,
  type ThreadEvent,
  type ThreadItem,
  type ThreadOptions,
  type TurnOptions,
  type Usage,
} from '@openai/codex-sdk';
import { redactRepositorySpecifier } from '../repository-identity';
import type { Diagnostic } from '../semantic';
import { assertYamlInputSize, YamlInputError } from '../untrusted-yaml';
import { type DiagramPromptPackage, renderSharedDiagramPromptGuidance } from './prompt-package';
import { createReadOnlyThread } from './read-only-thread';
import { runCodexPrompt } from './run-codex-prompt';

export interface DiagramAgentTurn {
  yaml: string;
  rawResponse: string;
  threadId: string | null;
  items: ThreadItem[];
  usage: Usage | null;
}

export interface AnalyzeDiagramInput {
  workspaceRoot: string;
  targetRepoPath: string;
  schemaRepoPath: string;
  repoUrl: string;
  ref?: string;
  repoRevision: string;
  promptPackage: DiagramPromptPackage;
}

export interface RepairDiagramInput extends AnalyzeDiagramInput {
  previousYaml: string;
  diagnostics: Diagnostic[];
}

export interface DiagramAgent {
  analyzeAndDraftDiagram(input: AnalyzeDiagramInput): Promise<DiagramAgentTurn>;
  repairDiagram(input: RepairDiagramInput): Promise<DiagramAgentTurn>;
}

export interface CodexThreadLike {
  id: string | null;
  runStreamed?(
    prompt: string,
    turnOptions?: TurnOptions,
  ): Promise<{ events: AsyncGenerator<ThreadEvent> }>;
  run(
    prompt: string,
    turnOptions?: TurnOptions,
  ): Promise<{
    finalResponse: string;
    items: ThreadItem[];
    usage: Usage | null;
  }>;
}

export interface CodexClientLike {
  startThread(options?: ThreadOptions): CodexThreadLike;
  resumeThread?(id: string, options?: ThreadOptions): CodexThreadLike;
}

export interface CodexDiagramAgentOptions {
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

function buildSchemaGuidanceLines(workspaceRoot: string, schemaRepoPath: string): string[] {
  const schemaRepoRelativePath = toWorkspaceRelativePath(workspaceRoot, schemaRepoPath);
  const schemaDirectoryPath = toWorkspaceRelativePath(
    workspaceRoot,
    path.join(schemaRepoPath, 'src', 'schemas'),
  );

  return [
    'Schema guidance:',
    `- Inspect the raw schema YAML under ${schemaRepoRelativePath} before drafting or repairing.`,
    `- Use the schema catalog from the prompt package as an index, then inspect whichever raw schema YAML files under ${schemaDirectoryPath} are relevant to the repo.`,
    '- Treat property descriptions as the main guidance for what props mean and when to populate them.',
    '- Do not assume a fixed schema family. Choose only from the schemas that actually exist in this schema repository.',
    '- Follow schema imports and updates from the selected modules instead of relying on hardcoded schema combinations.',
  ];
}

function diagnosticsToPrompt(diagnostics: Diagnostic[]): string {
  return diagnostics
    .map(
      (diagnostic) =>
        `- [${diagnostic.severity}] ${diagnostic.phase} ${diagnostic.code}: ${diagnostic.message}`,
    )
    .join('\n');
}

function extractYamlLikeResponse(response: string, rootKeys: string[]): string {
  try {
    assertYamlInputSize(response);
  } catch (error) {
    if (!(error instanceof YamlInputError)) throw error;
    return response;
  }
  const trimmed = response.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { yaml?: unknown };
      if (typeof parsed.yaml === 'string' && parsed.yaml.trim().length > 0) {
        return parsed.yaml.trim();
      }
    } catch {
      // Fall through to raw/fenced handling.
    }
  }

  const fencedMatch = trimmed.match(/```(?:yaml)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  let firstRootKeyStart: number | null = null;
  for (const rootKey of rootKeys) {
    const rootKeyMatch = new RegExp(`(^|\\n)${rootKey}:\\s*[^\\n]+`).exec(trimmed);
    if (!rootKeyMatch) {
      continue;
    }
    const rootKeyStart =
      trimmed[rootKeyMatch.index] === '\n' ? rootKeyMatch.index + 1 : rootKeyMatch.index;
    if (firstRootKeyStart === null || rootKeyStart < firstRootKeyStart) {
      firstRootKeyStart = rootKeyStart;
    }
  }
  if (firstRootKeyStart !== null) {
    return trimmed.slice(firstRootKeyStart).trim();
  }

  return trimmed;
}

export function extractYamlResponse(response: string): string {
  return extractYamlLikeResponse(response, ['version']);
}

export function extractSchemaModuleYamlResponse(response: string): string {
  return extractYamlLikeResponse(response, ['owner']);
}

export function buildDraftPrompt(input: AnalyzeDiagramInput): string {
  const targetRepoPath = toWorkspaceRelativePath(input.workspaceRoot, input.targetRepoPath);
  const schemaRepoPath = toWorkspaceRelativePath(input.workspaceRoot, input.schemaRepoPath);
  const schemaGuidanceLines = buildSchemaGuidanceLines(input.workspaceRoot, input.schemaRepoPath);

  return [
    'Build a semantic architecture diagram artifact for the repository in this workspace.',
    '',
    'Workspace layout:',
    `- Target repository: ${targetRepoPath}`,
    `- Schema repository: ${schemaRepoPath}`,
    '',
    'Repository context:',
    `- Clone URL: ${redactRepositorySpecifier(input.repoUrl)}`,
    `- Checked out revision: ${input.repoRevision}`,
    `- Requested ref: ${input.ref ?? '(default branch)'}`,
    '',
    ...schemaGuidanceLines,
    '',
    'Inspect the target repository and schema repository before drafting.',
    'Use the schema catalog as a wayfinding index, then inspect the raw YAML schema files for the modules you choose.',
    'Prefer shipped application/runtime architecture over build tooling, test code, local dev helpers, and dev-only endpoints.',
    'Use only schemaRefs, type ids, relation ids, and tag ids that actually exist in the schema repository.',
    'Do not invent schema type ids for repo concepts. Name the concept in the entity id and name, then choose an existing ontology type.',
    'Emit provenance for every explicit entity and relation as provenance.locations[] entries using repo-relative paths plus optional symbol and note.',
    'Every provenance path must be relative to the target repository root itself. Never prefix a path with target-repo/, schema-repo/, out/, or any absolute workspace directory.',
    'Add short descriptions to entities and relations when they help explain what the boundary or connection is. Keep them to a noun phrase or one short sentence.',
    '',
    'Diagram structure',
    '',
    'There are both single-typed groups and mixed groups in the schema metamodel.  The diagram will represent these as a block until expanded.  Use them to represent groups of similar entities even if not explicitly stated in the repo',
    'Try to avoid nodes with a single node inside them as these add little value - consider combining into a single node',
    '',
    renderSharedDiagramPromptGuidance(input.promptPackage),
    '',
    'Output requirements:',
    '- Return only a semantic document YAML artifact.',
    '- Do not wrap the YAML in markdown fences.',
    '- The document must include: version, schemaRefs, entities, relations.',
    '- Include provenance for every explicit entity and relation.',
    '- Use provenance paths relative to the target repository root only; never prefix them with target-repo/ or other workspace directories.',
    '- If you include entity or relation descriptions, keep them short.',
    '- metadata is optional.',
  ].join('\n');
}

export function buildRepairPrompt(input: RepairDiagramInput): string {
  const targetRepoPath = toWorkspaceRelativePath(input.workspaceRoot, input.targetRepoPath);
  const schemaRepoPath = toWorkspaceRelativePath(input.workspaceRoot, input.schemaRepoPath);
  const schemaGuidanceLines = buildSchemaGuidanceLines(input.workspaceRoot, input.schemaRepoPath);

  return [
    'The previous semantic document YAML did not validate.',
    'Return a full corrected YAML document only.',
    'Preserve the intended architecture unless a change is required to pass validation.',
    '',
    'Workspace layout:',
    `- Target repository: ${targetRepoPath}`,
    `- Schema repository: ${schemaRepoPath}`,
    '',
    ...schemaGuidanceLines,
    '',
    'Keep every provenance path relative to the target repository root only. Never prefix it with target-repo/, schema-repo/, out/, or any absolute workspace directory.',
    '',
    renderSharedDiagramPromptGuidance(input.promptPackage),
    '',
    'Keep any entity or relation descriptions short. Use a noun phrase or one short sentence.',
    '',
    'Validation diagnostics:',
    diagnosticsToPrompt(input.diagnostics),
    '',
    'Previous YAML:',
    '```yaml',
    input.previousYaml.trim(),
    '```',
  ].join('\n');
}

export class CodexDiagramAgent implements DiagramAgent {
  private readonly client: CodexClientLike;
  private readonly options: CodexDiagramAgentOptions;
  private thread: CodexThreadLike | undefined;

  constructor(options: CodexDiagramAgentOptions = {}) {
    this.options = options;
    this.client = options.client ?? new Codex(options.clientOptions);
  }

  private getThread(workspaceRoot: string): CodexThreadLike {
    if (this.thread) return this.thread;
    this.thread = createReadOnlyThread(this.client, {
      workingDirectory: workspaceRoot,
      model: this.options.model,
      modelReasoningEffort: this.options.modelReasoningEffort,
    });
    return this.thread;
  }

  private async runPrompt(workspaceRoot: string, prompt: string): Promise<DiagramAgentTurn> {
    let thread = this.getThread(workspaceRoot);
    const turn = await runCodexPrompt(thread, prompt, {
      operation: 'basic diagram draft/repair',
      timeoutMs: this.options.turnTimeoutMs,
      reasoningEffort: this.options.modelReasoningEffort,
      freshThread: () => {
        this.thread = undefined;
        thread = this.getThread(workspaceRoot);
        return thread;
      },
    });
    return {
      yaml: extractYamlResponse(turn.finalResponse),
      rawResponse: turn.finalResponse,
      threadId: thread.id,
      items: turn.items,
      usage: turn.usage,
    };
  }

  analyzeAndDraftDiagram(input: AnalyzeDiagramInput): Promise<DiagramAgentTurn> {
    return this.runPrompt(input.workspaceRoot, buildDraftPrompt(input));
  }

  repairDiagram(input: RepairDiagramInput): Promise<DiagramAgentTurn> {
    return this.runPrompt(input.workspaceRoot, buildRepairPrompt(input));
  }
}
