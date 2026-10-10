import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ConfigError } from './cli-errors';
import { runCodexPrompt } from './codex/run-codex-prompt';
import { TurnPolicy, withTurnPolicy } from './codex/turn-policy';
import { resolveDefaultSchemaSource } from './default-assets';
import { deriveGeneratedSchemaId, GeneratedSchemaService } from './generated-schema';

describe('deriveGeneratedSchemaId', () => {
  it.each(['.', './', '..'])('resolves local directory %s before deriving its basename', (repo) => {
    expect(deriveGeneratedSchemaId(repo)).toBe(
      `repo/${path.basename(path.resolve(repo)).toLowerCase()}`,
    );
  });
  it('requires an explicit id for filesystem root', () => {
    expect(() => deriveGeneratedSchemaId(path.parse(process.cwd()).root)).toThrow('--schema-id');
    expect(deriveGeneratedSchemaId('/', 'Root Project')).toBe('repo/root-project');
  });
  it.each([
    ['https://github.com/acme/api/tree/main', 'repo/api'],
    ['https://github.com/acme/api/blob/main/file.ts', 'repo/api'],
    ['https://github.com/acme/api.git?tab=x', 'repo/api'],
    ['https://github.com/acme/api#readme', 'repo/api'],
    ['https://github.com/other/api', 'repo/api'],
    ['git@github.com:acme/My-App.git', 'repo/my-app'],
    ['ssh://git@github.com/acme/api.git', 'repo/api'],
    ['https://example.com/api.git', 'repo/api'],
    ['acme/api', 'repo/api'],
    ['other/api', 'repo/api'],
  ])('derives %s as %s', (repo, expected) => {
    expect(deriveGeneratedSchemaId(repo)).toBe(expected);
  });
  it.each(['Foo', 'repo/Foo'])('normalizes explicit %s', (schemaId) => {
    expect(deriveGeneratedSchemaId('.', schemaId)).toBe('repo/foo');
  });
  it.each([
    'core/web-app',
    'user/custom-app',
    'repo/../../escape',
    'repo/..',
    'repo/a/b',
  ])('rejects invalid explicit %s', (schemaId) => {
    expect(() => deriveGeneratedSchemaId('.', schemaId)).toThrow(ConfigError);
  });
});

it.each([
  false,
  true,
])('resumes schema repair after a one-turn budget, changed revision=%s', async (changedRevision) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'schema-budget-'));
  try {
    const workspace = {
      jobRoot: root,
      targetRepoPath: path.join(root, 'target-repo'),
      schemaRepoPath: path.join(root, 'schema-repo'),
      workspaceOutputDir: path.join(root, 'out'),
      repoRevision: 'rev-one',
      schemaSourceRevision: 'schemas-one',
    };
    await fs.cp(resolveDefaultSchemaSource(), workspace.schemaRepoPath, { recursive: true });
    const goodYaml =
      'owner: repo\nname: application\nversion: "0.1"\nuse:\n  - schema: core/code@0.1\ntypes: []\nrelations: []\n';
    const calls: string[] = [];
    const invoke = async (operation: string, yaml: string) => {
      const result = await runCodexPrompt(
        {
          id: 'fake-schema-thread',
          run: async () => {
            calls.push(operation);
            return { finalResponse: yaml, items: [], usage: null };
          },
        },
        operation,
        { operation },
      );
      return {
        yaml: result.finalResponse,
        rawResponse: result.finalResponse,
        threadId: 'fake-schema-thread',
        items: [],
        usage: null,
      };
    };
    let freshDraftIsValid = false;
    const agent = {
      draftGeneratedSchema: vi.fn(() =>
        invoke('draft', freshDraftIsValid ? goodYaml : 'invalid: schema'),
      ),
      repairGeneratedSchema: vi.fn(() => invoke('repair', goodYaml)),
    };
    const service = new GeneratedSchemaService({ agent });
    const options = {
      workspace,
      repo: '/example/application',
      schemaId: 'repo/application',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    await expect(
      withTurnPolicy(new TurnPolicy(1), () => service.prepareGeneratedSchema(options)),
    ).rejects.toThrow('Stopped after 1 turns');
    expect(calls).toEqual(['draft']);
    if (changedRevision) {
      workspace.repoRevision = 'rev-two';
      freshDraftIsValid = true;
    }
    const result = await withTurnPolicy(new TurnPolicy(1), () =>
      service.prepareGeneratedSchema({ ...options, resumeDraft: true }),
    );
    expect(result.status).toBe('succeeded');
    expect(calls).toEqual(['draft', changedRevision ? 'draft' : 'repair']);
    expect(result.repaired).toBe(!changedRevision);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
