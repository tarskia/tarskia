import { expect, it, vi } from 'vitest';
import { CodexDiagramEvolver, EVOLVE_CODEX_CONFIG } from './diagram-evolver';

it('starts an independent read-only thread over only exported input, with model and effort', async () => {
  const run = vi.fn(async (_prompt: string) => ({ finalResponse: '{}', items: [], usage: null }));
  const startThread = vi.fn(() => ({ id: 'independent', run }));
  const evolve = new CodexDiagramEvolver({
    client: { startThread },
    model: 'test-model',
    reasoningEffort: 'medium',
  });
  await evolve.evolve({
    workspaceRoot: '/export/workspace',
    hasRepoSchema: false,
    diagnostics: [],
  });
  expect(startThread).toHaveBeenCalledWith({
    workingDirectory: '/export/workspace',
    skipGitRepoCheck: true,
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
    networkAccessEnabled: false,
    webSearchMode: 'disabled',
    model: 'test-model',
    modelReasoningEffort: 'medium',
  });
  expect(run.mock.calls[0]?.[0]).toContain('input/code.diff');
  expect(run.mock.calls[0]?.[0]).not.toContain('git log');
  expect(run.mock.calls[0]?.[0]).not.toContain('git diff');
  expect(EVOLVE_CODEX_CONFIG.project_doc_max_bytes).toBe(0);
  expect(EVOLVE_CODEX_CONFIG.project_root_markers).toEqual(['.tarskia-evolve-root']);
});
