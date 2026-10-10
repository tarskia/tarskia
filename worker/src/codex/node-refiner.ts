import path from 'node:path';
import { Codex, type CodexOptions, type ThreadOptions } from '@openai/codex-sdk';
import type {
  NodeRefiner,
  NodeRefinerInput,
  NodeRefinerRepairer,
  NodeRefinerRepairInput,
  NodeRefinerResult,
} from '../advanced/graph-builders';
import { parseNodeRefinementResponse } from '../advanced/node-refinement';
import {
  formatWithEdgeHandles,
  taskWithEdgeHandles,
} from '../advanced/node-refinement-edge-handles';
import { renderSchemaFlowCatalogSliceForPrompt } from '../advanced/schema-flow-catalog';
import {
  NODE_REFINEMENT_SOFT_LIMITS,
  type RepoCensusFileEntry,
  type RepoCensusSignal,
} from '../advanced/types';
import { tokenUsageFromSdkUsage } from '../token-usage';
import type { CodexClientLike, CodexThreadLike } from './diagram-agent';
import { ModelOutputParseError } from './model-output-error';
import { createReadOnlyThread } from './read-only-thread';
import { runCodexPrompt } from './run-codex-prompt';

export interface CodexNodeRefinerOptions {
  client?: CodexClientLike;
  clientOptions?: CodexOptions;
  model?: string;
  modelReasoningEffort?: ThreadOptions['modelReasoningEffort'];
  turnTimeoutMs?: number;
}

function formatSchemaActivations(activations: Array<{ schema: string; layer: number }>): string {
  return activations.length > 0
    ? activations
        .map((activation) => `- ${activation.schema} (layer ${activation.layer})`)
        .join('\n')
    : '- None';
}

function toWorkspaceRelativePath(rootPath: string, targetPath: string): string {
  const relative = path.relative(rootPath, targetPath);
  return relative.split(path.sep).join('/') || '.';
}

function pathMatchesScope(filePath: string, scopePath: string): boolean {
  return scopePath === '.' ? true : filePath === scopePath || filePath.startsWith(`${scopePath}/`);
}

function summarizeFiles(files: RepoCensusFileEntry[]): string {
  if (files.length === 0) {
    return '- None';
  }
  return files
    .slice(0, 20)
    .map(
      (file) =>
        `- ${file.path}: ${file.lineCount} LOC, ${file.language}${file.extension ? ` (${file.extension})` : ''}`,
    )
    .join('\n');
}

function summarizeSignals(signals: RepoCensusSignal[]): string {
  if (signals.length === 0) {
    return '- None';
  }
  return signals
    .slice(0, 20)
    .map((signal) => `- ${signal.kind}: ${signal.path} (${signal.reason})`)
    .join('\n');
}

function summarizeRelationMatrix(matrix: Record<string, Record<string, string[]>>): string {
  const rows: string[] = [];
  for (const [fromTypeId, targets] of Object.entries(matrix)) {
    for (const [toTypeId, relationTypeIds] of Object.entries(targets)) {
      if (relationTypeIds.length === 0) {
        continue;
      }
      rows.push(`- ${fromTypeId} -> ${toTypeId}: ${relationTypeIds.join(', ')}`);
    }
  }
  return rows.length > 0 ? rows.join('\n') : '- None';
}

function summarizePathList(paths: string[], limit = 3): string {
  if (paths.length === 0) {
    return '(none)';
  }
  if (paths.length <= limit) {
    return paths.join(', ');
  }
  return `${paths.slice(0, limit).join(', ')} (+${paths.length - limit} more)`;
}

function formatContextNodeLabel(node: { id: string; name?: string; typeId: string }): string {
  const label = node.name?.trim() || node.id;
  return `${label} [${node.typeId}] (${node.id})`;
}

function formatAncestorChain(input: NodeRefinerInput): string {
  if (input.surroundingContext.ancestorChain.length === 0) {
    return '- None';
  }
  return input.surroundingContext.ancestorChain
    .map((ancestor) => {
      const directChildren =
        ancestor.directChildren.length > 0
          ? ancestor.directChildren.map((child) => child.name?.trim() || child.id)
          : [];
      return [
        `- ${formatContextNodeLabel(ancestor)}`,
        `  scope: ${summarizePathList(ancestor.scope)}`,
        `  accepted direct children: ${directChildren.length > 0 ? directChildren.join(', ') : '(none yet)'}`,
      ].join('\n');
    })
    .join('\n');
}

function formatAcceptedSiblings(input: NodeRefinerInput): string {
  if (input.surroundingContext.acceptedSiblings.length === 0) {
    return '- None';
  }
  return input.surroundingContext.acceptedSiblings
    .map((sibling) => `- ${formatContextNodeLabel(sibling)}`)
    .join('\n');
}

function formatNearbyAcceptedConcepts(input: NodeRefinerInput): string {
  if (input.surroundingContext.nearbyAcceptedConcepts.length === 0) {
    return '- None';
  }
  return input.surroundingContext.nearbyAcceptedConcepts
    .map(
      (concept) =>
        `- ${formatContextNodeLabel(concept)} | scope: ${summarizePathList(concept.scope)} | reasons: ${concept.reasons.join('; ')}`,
    )
    .join('\n');
}

function buildPromptHeader(input: NodeRefinerInput): string[] {
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
  const matchingFiles = input.repoCensus.files.filter((file) =>
    input.task.scope.some((scopePath) => pathMatchesScope(file.path, scopePath)),
  );
  const matchingSignals = input.repoCensus.signals.filter((signal) =>
    input.task.scope.some((scopePath) => pathMatchesScope(signal.path, scopePath)),
  );

  return [
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
    'Node refinement task:',
    JSON.stringify(taskWithEdgeHandles(input.task), null, 2),
    '',
    'Surrounding modeled context:',
    'Ancestor chain for this node:',
    formatAncestorChain(input),
    '',
    'Already accepted siblings under the same parent/root:',
    formatAcceptedSiblings(input),
    '',
    'Nearby accepted concepts in this root subtree that may overlap this node:',
    formatNearbyAcceptedConcepts(input),
    '',
    'Active schema refs for this refinement turn:',
    formatSchemaActivations(input.activeSchemaRefs),
    '',
    'Candidate schema refs that may be activated later:',
    input.candidateSchemaRefs.length > 0
      ? input.candidateSchemaRefs
          .map((candidate) => `- ${candidate.schemaRef}: ${candidate.rationale}`)
          .join('\n')
      : '- None',
    '',
    ...(input.schemaValidationCommand
      ? ['Schema selection validation command:', `- ${input.schemaValidationCommand}`, '']
      : []),
    'Allowed child type ids:',
    input.allowedChildTypeIds.length > 0
      ? input.allowedChildTypeIds.map((typeId) => `- ${typeId}`).join('\n')
      : '- None',
    '',
    renderSchemaFlowCatalogSliceForPrompt({
      catalog: input.schemaFlowCatalog,
      parentTypeId: input.task.nodeTypeId,
      allowedChildTypeIds: input.allowedChildTypeIds,
    }),
    '',
    'Allowed relation matrix between child types:',
    summarizeRelationMatrix(input.relationMatrix),
    '',
    'Area-local census excerpts:',
    summarizeFiles(
      [...matchingFiles].sort((left, right) =>
        right.lineCount !== left.lineCount
          ? right.lineCount - left.lineCount
          : left.path.localeCompare(right.path),
      ),
    ),
    '',
    'Area-local runtime/infra signals:',
    summarizeSignals(matchingSignals),
    '',
    ...(input.validationCommand
      ? ['Local validation command:', `- ${input.validationCommand}`, '']
      : []),
  ];
}

function buildNodeRefinementOutputShape(compact: boolean): string[] {
  if (compact) {
    return [
      'Return JSON only with this shape:',
      '{',
      '  "children": [{"localId":"child-id","name":"Child name","description":"optional short noun phrase or one sentence","typeId":"core/....types....","props":{"propertyId":"value when supported by the chosen child type"},"responsibility":"optional short statement","scope":["repo/path"],"evidence":[{"path":"repo/path","reason":"why this child exists"}],"queueDecision":"leaf|expand","groupMode":"mixed|typed","groupTypeId":"core/... exact child type when groupMode=typed"}],',
      '  "relations": [{"localId":"relation-id","typeId":"core/...relations....","description":"optional short noun phrase or one sentence","fromLocalId":"child-id","toLocalId":"child-id","evidence":[{"path":"repo/path","reason":"why this relation exists"}]}],',
      '  "edgeRefinements": [{"edgeId":"out-1","relationTypeId":"optional overridden core/...relations.... when refinement changes the edge semantics","fromChildLocalId":"child-id when refining the source side","toChildLocalId":"child-id when refining the target side"}],',
      '  "edgeProposals": [{"edgeId":"out-1","endpoint":"from|to","childLocalId":"child-id that currently carries this edge side","relationTypeId":"optional overridden core/...relations.... when the later fulfilled edge should use different semantics"}],',
      '  "suggestedSchemaRefs": ["core/schema@version"],',
      '  "description": "optional short noun phrase or one or two short sentences describing this node",',
      '  "openQuestions": ["optional"]',
      '}',
    ];
  }

  return [
    'Return JSON only with this shape:',
    '{',
    '  "children": [',
    '    {',
    '      "localId": "child-id",',
    '      "name": "Child name",',
    '      "description": "optional short noun phrase or one sentence",',
    '      "typeId": "core/....types....",',
    '      "props": {"propertyId": "value when supported by the chosen child type"},',
    '      "responsibility": "optional short statement",',
    '      "scope": ["repo/path"],',
    '      "evidence": [{"path": "repo/path", "reason": "why this child exists"}],',
    '      "queueDecision": "leaf|expand",',
    '      "groupMode": "mixed|typed",',
    '      "groupTypeId": "core/... exact child type when groupMode=typed"',
    '    }',
    '  ],',
    '  "relations": [',
    '    {',
    '      "localId": "relation-id",',
    '      "typeId": "core/...relations....",',
    '      "description": "optional short noun phrase or one sentence",',
    '      "fromLocalId": "child-id",',
    '      "toLocalId": "child-id",',
    '      "evidence": [{"path": "repo/path", "reason": "why this relation exists"}]',
    '    }',
    '  ],',
    '  "edgeRefinements": [',
    '    {',
    '      "edgeId": "out-1",',
    '      "relationTypeId": "optional overridden core/...relations.... when refinement changes the edge semantics",',
    '      "fromChildLocalId": "child-id when refining the source side",',
    '      "toChildLocalId": "child-id when refining the target side"',
    '    }',
    '  ],',
    '  "edgeProposals": [',
    '    {',
    '      "edgeId": "out-1",',
    '      "endpoint": "from|to",',
    '      "childLocalId": "child-id that currently carries this edge side",',
    '      "relationTypeId": "optional overridden core/...relations.... when the later fulfilled edge should use different semantics"',
    '    }',
    '  ],',
    '  "suggestedSchemaRefs": ["core/schema@version"],',
    '  "description": "optional short noun phrase or one or two short sentences describing this node",',
    '  "openQuestions": ["optional"]',
    '}',
  ];
}

function buildNodeRefinementRules(input: NodeRefinerInput, compact: boolean): string[] {
  return [
    'Instructions:',
    ...(compact
      ? [
          '- Continue the existing node-refinement conversation. Reuse the previously established schema contract, local modeling rules, and edge-refinement conventions unless contradicted by the deterministic task details below.',
        ]
      : []),
    '- The node already exists. Do not recreate it. Emit only its direct children and the relations between those children.',
    '- All levels are about shipped runtime architecture. Use packaging/install/bootstrap artifacts only as evidence for runtime boundaries, not as child nodes, unless this node explicitly models delivery or runtime operations.',
    '- Do not inventory everything in scope, but emit whatever direct children are needed to make the runtime/data flow through this node intelligible and structurally coherent.',
    '- Every emitted child must use one of the allowed child type ids.',
    '- When the chosen child type defines meaningful properties and the evidence supports a concrete value, populate child props using the exact property ids from the active schemas.',
    '- Use the relation matrix exactly; only emit relation types that are listed for the chosen child endpoint types.',
    '- Treat the surrounding modeled context as already accepted structure. Do not recreate, reparent, or restate those ancestor, sibling, or nearby concepts unless this node introduces a distinct narrower boundary or is the unique carrier of new flow.',
    '- Each emitted child should justify itself as part of the flow through the parent: an inherited edge endpoint, a node on the internal path between inherited entry and exit, a terminal store/API/queue needed to complete that flow, or an explicit group that compresses meaningful breadth.',
    '- If multiple distinct internal boundaries materially shape the flow, include all of them. Do not collapse a broad node to a single wrapper child just to stay minimal.',
    '- Prefer direct siblings unless grouping is semantically useful or needed for valid containment.',
    ...(input.childrenCanExpand === false
      ? []
      : [
          "- When one child is a runtime boundary that can directly contain another child as its implementation layer, prefer making the runtime child expandable and emit the implementation child during that child's later refinement instead of adding a sibling relation between them.",
        ]),
    '- If there are many similar helpers, adapters, or low-value implementation details, either omit them or collapse them into an explicit group only when that group is worth later refinement.',
    ...(input.childrenCanExpand === false
      ? []
      : [
          '- Explicit groups are allowed. If you emit a group child, set typeId to core/web-app.types.group and include groupMode.',
        ]),
    input.childrenCanExpand === false
      ? '- Children cannot be expanded at the current depth or refinement budget. Every child must be a leaf; do not return group-type children. Return their concrete members as direct children instead.'
      : '- A group child must use queueDecision=expand. Never emit a group child as leaf; a leaf group becomes an invalid empty wrapper.',
    '- Use groupMode=mixed for heterogeneous groups. Use groupMode=typed only when the group should contain one ontology type and include groupTypeId.',
    "- If this node is a typed group, every direct concrete child must use the parent's groupTypeId. Do not put applications, external APIs, queues, datastores, or other boundary types directly inside a typed code-module group; represent them with valid inherited edge refinements/proposals at the boundary that owns them, or omit them if they are only evidence.",
    '- Do not leave an expandable group disconnected from inherited edge refinements, edge proposals, or child-to-child relations. If a candidate group has no direct flow role, either emit concrete leaf children at the current level, connect the group to flow, or omit it.',
    '- A group that would contain only one child is usually the wrong boundary. Collapse it into the child, or add the missing peer children and relations that make the group meaningful.',
    "- When refining a typed group, do not wrap all evidence in one same-typed group child. Emit direct children of the group's groupTypeId from the concrete files/modules, or add real peer groups that explain distinct flow.",
    input.childrenCanExpand === false
      ? '- Use queueDecision=leaf for every child in this turn.'
      : '- Use queueDecision=expand only when that child still has its own meaningful internal flow to explain. Children that are present for completeness but do not need deeper flow explanation should use queueDecision=leaf.',
    '- Refined inherited edges are selective, not exhaustive. For each inherited edge, emit as many descendant edge refinements as needed to explain the primary flow through this node coherently.',
    '- When an expandable child has scope/evidence that overlaps an inherited edge evidence path, attach that inherited edge to the child with an edgeRefinement unless a more specific local relation already connects the child to flow. Multiple children may refine the same inherited edge when distinct evidence paths carry the same coarse flow.',
    "- For every edgeRefinement or edgeProposal, set edgeId to the handle of one of this task's inboundEdges or outboundEdges (for example in-1 or out-2). Never use any other id.",
    '- When refining a concrete source, sink, or flow-through boundary, preserve its catalogue role in the direct child forest. Use concrete direct children that legally carry inherited flow when possible; use edgeProposals for generic groups or deferred endpoints instead of forcing invalid visible edgeRefinements.',
    '- You may change the relationTypeId of an inherited edge refinement when refinement changes the correct boundary semantics. For example, a coarse persistence read/write edge may become a calls edge into a model/service layer inside this node.',
    '- If you change relationTypeId on an inherited edge refinement, the rewritten endpoints must still be valid for that new relation type.',
    '- If you know which child currently carries an inherited edge side, but the correct opposite endpoint only appears in a later refinement, emit an edgeProposal instead of forcing an invalid or misleading edge refinement now.',
    '- edgeProposals are provisional. They do not change the assembled graph yet; they only mark which direct child currently carries the inherited ingress/egress until a later refinement can fulfill it.',
    '- Do not add relationTypeId to an edgeProposal unless you are intentionally changing the inherited edge semantics. If the proposed child endpoint is not valid against the current unresolved opposite endpoint, keep the proposal provisional and make the child expandable when it needs deeper endpoints to carry the flow.',
    ...(input.validationCommand
      ? [
          '- Before signing off, run the local validation command at least once on your candidate JSON.',
          '- The local validation command reads the raw node-refinement JSON response from stdin and returns JSON with separate hardDiagnostics and softDiagnostics.',
          '- Do not finalize while hardDiagnostics are non-empty. Use softDiagnostics as guidance when they reveal a better local model.',
        ]
      : []),
    '- Do not fan one inherited coarse edge across a broad inventory of similar helpers. If many siblings share the same downstream dependency, keep the main flow carrier explicit and omit low-value siblings unless an expandable group is truly needed.',
    '- If a child type or relation clearly needs a schema that is not currently active, do not force an invalid local model. Add the needed schema ref to suggestedSchemaRefs instead.',
    '- If you emit suggestedSchemaRefs and a schema selection validation command is available, run it with the candidate JSON on stdin before finalizing. Do not keep schema refs that the command rejects.',
    '- queueDecision=leaf means this child should not be refined further.',
    '- Use the inherited edges as the boundary contract for this node. Refine inbound/outbound edges to specific child endpoints when you can explain the flow through them.',
    '- Keep descriptions short. Use a noun phrase or at most one or two short sentences.',
    '- For an inherited edge that is outbound from this node, refine the local/source side with fromChildLocalId.',
    '- For an inherited edge that is inbound to this node, refine the local/target side with toChildLocalId.',
    '- Do not use the opposite endpoint field unless this node truly owns that side of the inherited edge.',
    '- Do not emit containment-flow edges such as parent -> child. Only emit child-to-child relations.',
    '- Do not put ancestor, sibling, or absolute entity ids in relations[].fromLocalId/toLocalId. Cross-boundary flow belongs in edgeRefinements or edgeProposals, not child-to-child relations.',
    '- Emit zero children only when this node is already a true leaf or should be pruned at this depth.',
    `- Soft caps for this turn: aim for no more than ${NODE_REFINEMENT_SOFT_LIMITS.maxChildrenPerNode} children total and no more than ${input.childrenCanExpand === false ? 0 : NODE_REFINEMENT_SOFT_LIMITS.maxExpandableChildrenPerNode} expandable children, but treat these as guidance rather than a target. Exceed them when needed for coherent flow.`,
    '- Keep child local ids stable, lowercase, and slash-free.',
    '- Every child and relation must include evidence paths.',
    '- scope paths and evidence.path values must be relative to the target repository root only. Never prefix them with target-repo/, schema-repo/, out/, or any absolute workspace directory.',
  ];
}

export function buildNodeRefinementPrompt(
  input: NodeRefinerInput,
  options: { compact?: boolean } = {},
): string {
  const compact = options.compact ?? false;
  return [
    'Refine one existing semantic node by emitting its immediate child forest.',
    '',
    ...(compact
      ? [
          'Continue the existing node-refinement conversation.',
          'Reuse the schema contract and detailed node-refinement guidance already established earlier in this thread. Prefer the deterministic task details below over older speculative context.',
          '',
        ]
      : []),
    ...buildPromptHeader(input),
    ...buildNodeRefinementRules(input, compact),
    '',
    ...buildNodeRefinementOutputShape(compact),
  ].join('\n');
}

export function buildNodeRefinementRepairPrompt(
  input: NodeRefinerRepairInput,
  options: { compact?: boolean } = {},
): string {
  const compact = options.compact ?? false;
  return [
    'Repair one node refinement result.',
    '',
    ...(compact
      ? [
          'Continue the existing node-refinement conversation.',
          'Reuse the previously established schema contract and node-refinement rules. Focus on the deterministic task, diagnostics, and previous result below.',
          '',
        ]
      : []),
    ...buildPromptHeader(input),
    `- Repair attempt: ${input.attempt}`,
    '',
    'Validation diagnostics to fix:',
    formatWithEdgeHandles(input.diagnostics, input.task),
    '',
    'Previous node refinement result:',
    formatWithEdgeHandles(input.previousResult, input.task),
    '',
    'Repair rules:',
    '- Preserve any valid child structure from the previous result.',
    '- Keep child local ids stable when possible.',
    '- Do not change the parent node; only repair its direct child forest, local relations, and inherited edge refinements.',
    '- Do not introduce top-level peers or descendants of grandchildren.',
    '- Keep direct siblings by default unless an explicit group is clearly warranted.',
    '- Keep the refined child forest focused on runtime architecture. Treat packaging/install/bootstrap artifacts as evidence for shipped runtime boundaries rather than as repaired children unless this node explicitly models delivery/runtime operations.',
    input.childrenCanExpand === false
      ? '- Repair group children by returning their concrete members as direct leaf children; do not return group-type children or expandable children.'
      : '- Prefer to repair by removing off-path detail, collapsing breadth into explicit expandable groups, reducing over-refinement of inherited coarse edges, downgrading unnecessary non-group expand children to leaf, or replacing an invalid edge refinement with an edgeProposal rather than by rewriting the entire local model.',
    '- If a local child-to-child relation has no legal relation type for its endpoint pair, delete that relation unless you can introduce the correct intermediate child with valid containment and evidence. Do not keep invalid API-to-datastore or interface-to-store relations just to satisfy flow hints.',
    '- For diagram.node_refinement.expand_child_not_flow_justified diagnostics, use suggestedEdgeRefinements from the diagnostic details when the child is a real carrier of that inherited flow; otherwise downgrade, collapse, or remove the child.',
    '- For diagram.node_refinement.unrefined_inherited_edge diagnostics, use suggested edge refinements when a child carries the inherited flow; otherwise return a smaller child forest or narrower child evidence instead of leaving the flow-matched child disconnected from the inherited edge.',
    '',
    buildNodeRefinementPrompt(input, { compact }),
  ].join('\n');
}

export class CodexNodeRefiner implements NodeRefiner, NodeRefinerRepairer {
  private readonly client: CodexClientLike;
  private readonly options: CodexNodeRefinerOptions;

  constructor(options: CodexNodeRefinerOptions = {}) {
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

  async refineNode(input: NodeRefinerInput): Promise<NodeRefinerResult> {
    const prompt = buildNodeRefinementPrompt(input, {
      compact: input.promptRunner?.isScopePrimed('node-refinement') ?? false,
    });
    return this.runNodeTurn(input, prompt, `advanced node refinement for ${input.task.nodeId}`);
  }

  async repairNode(input: NodeRefinerRepairInput): Promise<NodeRefinerResult> {
    const prompt = buildNodeRefinementRepairPrompt(input, {
      compact: input.promptRunner?.isScopePrimed('node-refinement') ?? false,
    });
    return this.runNodeTurn(
      input,
      prompt,
      `advanced node refinement repair for ${input.task.nodeId} attempt ${input.attempt}`,
    );
  }

  private async runNodeTurn(
    input: NodeRefinerInput,
    prompt: string,
    operation: string,
  ): Promise<NodeRefinerResult> {
    const turn = input.promptRunner
      ? await input.promptRunner.runPrompt({
          prompt,
          operation,
          scope: 'node-refinement',
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
      return {
        result: parseNodeRefinementResponse(turn.finalResponse, input.task),
        rawResponse: turn.finalResponse,
        threadId: turn.threadId,
        tokenUsage: tokenUsageFromSdkUsage(turn.usage),
      };
    } catch (error) {
      throw new ModelOutputParseError({
        operation,
        expectedFormat: 'json',
        rawResponse: turn.finalResponse,
        threadId: turn.threadId,
        tokenUsage: tokenUsageFromSdkUsage(turn.usage),
        cause: error,
      });
    }
  }
}
