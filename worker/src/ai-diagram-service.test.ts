import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { DefaultAiDiagramService } from './ai-diagram-service';

vi.mock('./semantic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./semantic')>()),
  validateDiagramYaml: () => ({
    ok: false,
    diagnostics: [
      {
        severity: 'error',
        phase: 'document',
        code: 'test.repair',
        message: 'Needs repair',
        hint: 'Keep this actionable repair hint',
      },
    ],
  }),
}));

it('retains diagnostic hints in basic-service repair artifacts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'diagnostic-hints-'));
  const agent = {
    analyzeAndDraftDiagram: vi.fn().mockResolvedValue({
      yaml: 'invalid draft',
      rawResponse: 'invalid draft',
      threadId: 'test',
      usage: null,
      items: [],
    }),
    repairDiagram: vi.fn().mockRejectedValue(new Error('stop after diagnostic artifact')),
  };
  try {
    await expect(
      new DefaultAiDiagramService({ agent }).generateDiagram({
        workspace: {
          jobRoot: root,
          workspaceOutputDir: path.join(root, 'out'),
          targetRepoPath: root,
          schemaRepoPath: path.resolve('assets/schemas'),
          repoRevision: 'test',
        },
        repo: root,
        logger: { info() {}, warn() {}, error() {} },
        primaryDocumentInput: {
          id: 'primary',
          kind: 'git',
          repo: root,
          revision: 'test',
          role: 'primary',
        },
      }),
    ).rejects.toThrow('stop after diagnostic artifact');
    const stored = JSON.parse(
      await fs.readFile(path.join(root, 'out/draft-diagnostics.json'), 'utf8'),
    );
    expect(stored[0].hint).toBe('Keep this actionable repair hint');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
