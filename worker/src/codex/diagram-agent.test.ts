import { describe, expect, it, vi } from 'vitest';
import {
  CodexDiagramAgent,
  extractSchemaModuleYamlResponse,
  extractYamlResponse,
} from './diagram-agent';
import type { DiagramPromptPackage } from './prompt-package';

describe('CodexDiagramAgent', () => {
  it('extracts semantic YAML from mixed prose responses', () => {
    const response = [
      'I read `out/analysis/level0-backbone.response.yaml`:',
      '',
      'version: 0.1.0',
      'schemaRefs: []',
      'entities: []',
      'relations: []',
    ].join('\n');

    expect(extractYamlResponse(response)).toBe(
      ['version: 0.1.0', 'schemaRefs: []', 'entities: []', 'relations: []'].join('\n'),
    );
  });

  it('extracts schema module YAML from mixed prose responses', () => {
    const response = [
      'I inspected the repo and drafted this schema:',
      '',
      'owner: gallery',
      'name: outline',
      'version: "0.1"',
      'types: []',
      'relations: []',
    ].join('\n');

    expect(extractSchemaModuleYamlResponse(response)).toBe(
      ['owner: gallery', 'name: outline', 'version: "0.1"', 'types: []', 'relations: []'].join(
        '\n',
      ),
    );
  });

  it('creates one thread and reuses it for repair turns', async () => {
    const thread = {
      id: 'thread-123',
      run: vi
        .fn()
        .mockResolvedValueOnce({
          finalResponse:
            '```yaml\nversion: 0.1.0\nschemaRefs: []\nentities: []\nrelations: []\n```',
          items: [],
          usage: null,
        })
        .mockResolvedValueOnce({
          finalResponse: 'version: 0.1.0\nschemaRefs: []\nentities: []\nrelations: []\n',
          items: [],
          usage: null,
        }),
    };
    const client = {
      startThread: vi.fn(() => thread),
    };
    const promptPackage: DiagramPromptPackage = {
      contract: {
        validationRules: {
          requiredTopLevelKeys: ['version', 'schemaRefs', 'entities', 'relations'],
          optionalTopLevelKeys: ['inputs', 'metadata', 'view'],
          preferredContainmentEncoding: 'children' as const,
          acceptedContainmentEncodings: ['children'] as Array<'children'>,
          relationDirectionRule: 'directed-by-default' as const,
          schemaRefsRequired: true,
          explicitIdsPreferred: true,
          provenanceLocationFields: ['path', 'symbol?', 'note?', 'input?'],
          provenanceLocationInputRule: 'optional-when-single-input' as const,
          workerInjectsPrimaryGitInput: true,
          workerRequiresEntityProvenance: true,
          workerRequiresRelationProvenance: true,
          lineNumbersRequiredInProvenance: false,
        },
        promptPolicies: {
          omitViewByDefault: true,
          preferFewerStrongerBoundaries: true,
          avoidHelpersFunctionsClasses: true,
          avoidDuplicatingExternalIoAtCodeLayer: true,
          serviceVsModuleRule:
            'Use service for promoted architectural boundaries and code.module for lower-level implementation boundaries.',
          runtimeOverToolingRule:
            'Prefer shipped application/runtime architecture over build tooling, test code, local dev helpers, and dev-only endpoints. Treat tooling and dev/test code as low-priority evidence unless it is clearly central to the product architecture.',
          modelingGuardrails: ['Do not invent schema type ids to match repo concepts.'],
        },
        schemaCatalog: [],
        canonicalExampleYaml: 'version: 0.1.0\nschemaRefs: []\nentities: []\nrelations: []\n',
      },
      renderedContract:
        'Validation-backed contract:\n- schemaRefs required: true\n- Worker-generated entities require provenance: true',
      metaOntologyMarkdown:
        '# Tarskia Diagram Meta-Ontology\n\n## Flow First\n\nPrefer coherent end-to-end flow.',
      schemaCatalogJson: '[]',
    };

    const agent = new CodexDiagramAgent({
      client,
      model: 'gpt-5.3-codex',
    });

    const draft = await agent.analyzeAndDraftDiagram({
      workspaceRoot: '/tmp/job',
      targetRepoPath: '/tmp/job/target-repo',
      schemaRepoPath: '/tmp/job/schema-repo',
      repoUrl: 'https://github.com/example/repo',
      repoRevision: 'abc123',
      promptPackage,
    });
    const repaired = await agent.repairDiagram({
      workspaceRoot: '/tmp/job',
      targetRepoPath: '/tmp/job/target-repo',
      schemaRepoPath: '/tmp/job/schema-repo',
      repoUrl: 'https://github.com/example/repo',
      repoRevision: 'abc123',
      promptPackage,
      previousYaml: draft.yaml,
      diagnostics: [
        {
          domain: 'diagram',
          phase: 'document',
          severity: 'error',
          code: 'diagram.document.schema_refs_required',
          message: 'Document must declare at least one schemaRef',
        },
      ],
    });

    expect(client.startThread).toHaveBeenCalledTimes(1);
    expect(client.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        workingDirectory: '/tmp/job',
        skipGitRepoCheck: true,
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
        webSearchMode: 'disabled',
        model: 'gpt-5.3-codex',
      }),
    );
    expect(thread.run).toHaveBeenCalledTimes(2);
    expect(thread.run.mock.calls[0][1]).toEqual(
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    expect(thread.run.mock.calls[0][0]).toContain('Target repository: target-repo');
    expect(thread.run.mock.calls[0][0]).toContain('Schema repository: schema-repo');
    expect(thread.run.mock.calls[0][0]).toContain('Validation-backed contract:');
    expect(thread.run.mock.calls[0][0]).toContain('Diagram meta-ontology:');
    expect(thread.run.mock.calls[0][0]).toContain('# Tarskia Diagram Meta-Ontology');
    expect(thread.run.mock.calls[0][0]).toContain(
      'Emit provenance for every explicit entity and relation',
    );
    expect(thread.run.mock.calls[0][0]).toContain(
      'Never prefix a path with target-repo/, schema-repo/, out/, or any absolute workspace directory.',
    );
    expect(thread.run.mock.calls[0][0]).toContain(
      'Prefer shipped application/runtime architecture over build tooling, test code, local dev helpers, and dev-only endpoints.',
    );
    expect(thread.run.mock.calls[0][0]).toContain('schema-repo/src/schemas');
    expect(thread.run.mock.calls[0][0]).toContain(
      'Do not assume a fixed schema family. Choose only from the schemas that actually exist in this schema repository.',
    );
    expect(thread.run.mock.calls[0][0]).toContain(
      'Treat property descriptions as the main guidance for what props mean and when to populate them.',
    );
    expect(thread.run.mock.calls[0][0]).toContain(
      'Do not invent schema type ids for repo concepts.',
    );
    expect(thread.run.mock.calls[0][0]).toContain('Diagram structure');
    expect(thread.run.mock.calls[1][0]).toContain('Validation diagnostics:');
    expect(thread.run.mock.calls[1][0]).toContain('Validation-backed contract:');
    expect(thread.run.mock.calls[1][0]).toContain(
      'Preserve the intended architecture unless a change is required to pass validation.',
    );
    expect(thread.run.mock.calls[1][0]).toContain('Schema guidance:');
    expect(thread.run.mock.calls[1][0]).toContain('diagram.document.schema_refs_required');
    expect(draft.yaml).toContain('version: 0.1.0');
    expect(repaired.threadId).toBe('thread-123');
  });
});
