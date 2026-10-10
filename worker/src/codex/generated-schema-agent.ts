import path from 'node:path';
import {
  Codex,
  type CodexOptions,
  type ThreadItem,
  type ThreadOptions,
  type Usage,
} from '@openai/codex-sdk';
import {
  renderSchemaFlowCatalogForPrompt,
  type SchemaFlowCatalog,
} from '../advanced/schema-flow-catalog';
import { redactRepositorySpecifier } from '../repository-identity';
import type { Diagnostic } from '../semantic';
import type { CodexClientLike, CodexThreadLike } from './diagram-agent';
import { extractSchemaModuleYamlResponse } from './diagram-agent';
import type { DiagramPromptPackage } from './prompt-package';
import { renderSchemaSelectionGuidance } from './prompt-package';
import { createReadOnlyThread } from './read-only-thread';
import { runCodexPrompt } from './run-codex-prompt';

export interface GeneratedSchemaAgentTurn {
  yaml: string;
  rawResponse: string;
  threadId: string | null;
  items: ThreadItem[];
  usage: Usage | null;
}

export interface DraftGeneratedSchemaInput {
  workspaceRoot: string;
  targetRepoPath: string;
  schemaRepoPath: string;
  repoUrl: string;
  ref?: string;
  repoRevision: string;
  schemaId: string;
  schemaRef: string;
  promptPackage: DiagramPromptPackage;
  validationCommand?: string;
}

export interface RepairGeneratedSchemaInput extends DraftGeneratedSchemaInput {
  previousYaml: string;
  diagnostics: Diagnostic[];
  schemaFlowCatalog?: SchemaFlowCatalog;
}

export interface GeneratedSchemaAgent {
  draftGeneratedSchema(input: DraftGeneratedSchemaInput): Promise<GeneratedSchemaAgentTurn>;
  repairGeneratedSchema(input: RepairGeneratedSchemaInput): Promise<GeneratedSchemaAgentTurn>;
}

export interface CodexGeneratedSchemaAgentOptions {
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

function diagnosticsToPrompt(diagnostics: Diagnostic[]): string {
  return diagnostics
    .map(
      (diagnostic) =>
        `- [${diagnostic.severity}] ${diagnostic.phase} ${diagnostic.code}: ${diagnostic.message}`,
    )
    .join('\n');
}

function parseSchemaIdentity(schemaRef: string): { owner: string; name: string; version: string } {
  const [schemaId, version = '0.1'] = schemaRef.split('@');
  const [owner = 'user', name = 'schema'] = schemaId?.split('/') ?? [];
  return { owner, name, version };
}

function buildDraftPrompt(input: DraftGeneratedSchemaInput): string {
  const targetRepoPath = toWorkspaceRelativePath(input.workspaceRoot, input.targetRepoPath);
  const schemaRepoPath = toWorkspaceRelativePath(input.workspaceRoot, input.schemaRepoPath);
  const { owner, name, version } = parseSchemaIdentity(input.schemaRef);

  return [
    `Author a repo-specific semantic schema module for this repository as ${input.schemaRef}.`,
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
    'Schema authoring requirements:',
    `- The schema must use owner: ${owner}, name: ${name}, version: "${version}".`,
    '- Inspect the target repository before drafting.',
    `- Inspect relevant raw schema YAML under ${schemaRepoPath} before drafting.`,
    '- Only add repo-specific wrappers, traits, or types that materially improve diagram fidelity beyond the core schemas.',
    '- Keep the schema lean. Prefer a few strong wrappers over an exhaustive ontology.',
    '- It is valid for the worker to continue with no repo-specific schema later, so do not pad the schema with weak concepts just to force one to exist.',
    '',
    'Pay particular attention to build hints and analysis semantics:',
    '- analysis.flowType',
    '- analysis.mayTerminate',
    '- relationParticipation',
    '- analysis.topLevelBias',
    '- containment.allowedChildTypes and containment.allowedChildTraits',
    '- display.flowDirection',
    '- Use these hints intentionally so the diagram build can reason about runtime flow and containment.',
    '',
    'Build-hint policy:',
    '- analysis.topLevelBias answers whether a type is a good coarse boundary to use near the outside of the diagram. It does not mean flow should stop there.',
    '- Flow expectations live on traits, not directly on types: type analysis only supports analysis.topLevelBias. If a repo-specific type needs source/through/sink behavior, define a repo-specific trait with analysis.flowType, expectedRelationIds when useful, and relationParticipation, then attach that trait to the type.',
    '- analysis.flowType answers how flow usually behaves through instances of the type. Use through for repo-owned runtimes and coordination layers that normally hand work to children or downstream boundaries. Use sink/source only when the type is naturally terminal on that side.',
    '- analysis.mayTerminate should be rare and intentional. It means the build may legitimately stop flow at this boundary instead of looking for clearer internal continuation.',
    '- Reserve analysis.mayTerminate: true mainly for natural endpoints or sinks such as datastores or storage-facing stacks, external APIs/systems, and other clearly terminal targets.',
    '- Repo-owned runtime wrappers such as web services, worker services, collaboration services, and generic runtime containers should usually keep analysis.mayTerminate unset or false even when analysis.topLevelBias is prefer.',
    '- If a type is a good outer wrapper but usually contains meaningful internal runtime flow, prefer analysis.topLevelBias: prefer together with analysis.flowType: through and no analysis.mayTerminate.',
    '- Do not emit a repo-owned container or application wrapper with analysis.topLevelBias: prefer but no trait-derived flow semantics. For root/application wrappers, attach a through-like trait unless the type is genuinely a terminal external context.',
    '- Frontend/client boundaries often work better as analysis.flowType: source with no analysis.mayTerminate so flow may start there but should still continue into repo-owned runtime dependencies.',
    '- relationParticipation should match the intended ingress/egress semantics of the type. Do not mark a type as broadly accepting relations that its instances would not normally carry.',
    '- display.flowDirection is optional. Use it only when the type has a strong inherent left-to-right or top-to-bottom flow that should influence layout.',
    '- If you are unsure whether a type should terminate flow, omit analysis.mayTerminate.',
    '',
    renderSchemaSelectionGuidance(input.promptPackage),
    '',
    'Authoring guidance:',
    '- Reuse imported core relations and traits where possible instead of inventing equivalents.',
    '- Favor wrapper/container types for repo-shaped runtime areas, protocol surfaces, storage boundaries, and coordination boundaries.',
    '- When adding traits, make relation participation and flow hints concrete enough to guide builds.',
    '- Do not emit prose, JSON, or markdown fences.',
    '- Return only schema module YAML.',
    ...(input.validationCommand
      ? [
          '',
          'Local schema validation command:',
          `- ${input.validationCommand}`,
          '',
          'Before finishing, run the local schema validation command with your candidate schema YAML on stdin.',
          'The command returns JSON with hard validation diagnostics and soft flow-modeling diagnostics.',
          'Do not finalize while hard validation diagnostics are present; use soft diagnostics as modeling review guidance.',
        ]
      : []),
  ].join('\n');
}

function buildRepairPrompt(input: RepairGeneratedSchemaInput): string {
  return [
    `The previous draft for ${input.schemaRef} needs validation/modeling repair.`,
    'Return a full corrected schema module YAML only.',
    'Preserve the useful repo-specific modeling intent unless a change is required to pass validation.',
    ...(input.schemaFlowCatalog
      ? [
          'The previous draft is hard-valid enough to derive this schema flow catalogue. Review whether it represents the repository before finishing.',
          '',
          renderSchemaFlowCatalogForPrompt(input.schemaFlowCatalog),
        ]
      : []),
    '',
    buildDraftPrompt(input),
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

export class CodexGeneratedSchemaAgent implements GeneratedSchemaAgent {
  private readonly client: CodexClientLike;
  private readonly options: CodexGeneratedSchemaAgentOptions;
  private thread: CodexThreadLike | undefined;

  constructor(options: CodexGeneratedSchemaAgentOptions = {}) {
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

  private async runPrompt(
    workspaceRoot: string,
    prompt: string,
  ): Promise<GeneratedSchemaAgentTurn> {
    let thread = this.getThread(workspaceRoot);
    const turn = await runCodexPrompt(thread, prompt, {
      operation: 'generated schema draft/repair',
      timeoutMs: this.options.turnTimeoutMs,
      reasoningEffort: this.options.modelReasoningEffort,
      freshThread: () => {
        this.thread = undefined;
        thread = this.getThread(workspaceRoot);
        return thread;
      },
    });
    return {
      yaml: extractSchemaModuleYamlResponse(turn.finalResponse),
      rawResponse: turn.finalResponse,
      threadId: thread.id,
      items: turn.items,
      usage: turn.usage,
    };
  }

  draftGeneratedSchema(input: DraftGeneratedSchemaInput): Promise<GeneratedSchemaAgentTurn> {
    return this.runPrompt(input.workspaceRoot, buildDraftPrompt(input));
  }

  repairGeneratedSchema(input: RepairGeneratedSchemaInput): Promise<GeneratedSchemaAgentTurn> {
    return this.runPrompt(input.workspaceRoot, buildRepairPrompt(input));
  }
}

export {
  buildDraftPrompt as buildGeneratedSchemaDraftPrompt,
  buildRepairPrompt as buildGeneratedSchemaRepairPrompt,
};
