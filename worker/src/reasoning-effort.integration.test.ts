import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ThreadOptions } from '@openai/codex-sdk';
import { simpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDiagram } from './build-diagram';
import { readJobMetadata } from './job-metadata';
import type { ReasoningEffort } from './reasoning-effort';
import { parseDocument } from './semantic';
import { CANONICAL_EXAMPLE_YAML } from './semantic/diagram-synthesis-contract';

const sdk = vi.hoisted(() => ({
  responses: [] as string[],
  threads: [] as Array<{ options: ThreadOptions; run: ReturnType<typeof vi.fn> }>,
}));

vi.mock('@openai/codex-sdk', () => ({
  Codex: class {
    startThread(options: ThreadOptions) {
      const run = vi.fn(async () => {
        const finalResponse = sdk.responses.shift();
        if (finalResponse === undefined) throw new Error('Unexpected Codex turn');
        return { finalResponse, items: [], usage: null };
      });
      sdk.threads.push({ options, run });
      return { id: `thread-${sdk.threads.length}`, run };
    }
  },
}));

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tarskia-effort-'));
  sdk.responses.length = 0;
  sdk.threads.length = 0;
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('reasoning effort through real build services', () => {
  it.each([
    undefined,
    'xhigh',
    'minimal',
    'max',
    'ultra',
    'persistent',
  ] as const)('uses effort %s for schema and basic diagram drafts and repairs', async (reasoningEffort:
    | ReasoningEffort
    | undefined) => {
    const repo = path.join(tempRoot, 'repo');
    await fs.mkdir(repo);
    await fs.writeFile(path.join(repo, 'README.md'), 'A test application.\n');
    const git = simpleGit(repo);
    await git.init();
    await git.addConfig('user.name', 'Tarskia Test');
    await git.addConfig('user.email', 'test@example.com');
    await git.add('.');
    await git.commit('Initial commit');
    sdk.responses.push(
      'owner: [unterminated\n',
      'owner: repo\nname: test-repo\nversion: "0.1"\ntypes: []\nrelations: []\n',
      CANONICAL_EXAMPLE_YAML.replace('to: module-schema-validation', 'to: missing-module'),
      CANONICAL_EXAMPLE_YAML,
    );
    const out = path.join(tempRoot, 'diagram.yaml');
    const result = await buildDiagram(
      {
        repo,
        schemaSource: path.resolve('test/fixtures/schema-repo'),
        out,
        schemaOut: path.join(tempRoot, 'schema.yaml'),
        schemaId: 'repo/test-repo',
        mode: 'basic',
        model: 'gpt-6-luna',
        reasoningEffort,
      },
      { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
    );

    const effectiveEffort = reasoningEffort ?? 'medium';
    expect(sdk.threads).toHaveLength(2);
    for (const thread of sdk.threads) {
      expect(thread.options).toMatchObject({
        model: 'gpt-6-luna',
        modelReasoningEffort: effectiveEffort,
      });
      expect(thread.run).toHaveBeenCalledTimes(2);
    }
    expect(sdk.responses).toEqual([]);
    expect(result.generatedSchema.repaired).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.buildSummary.reasoningEffort).toBe(effectiveEffort);
    expect((await readJobMetadata(`${out}.job`))?.reasoningEffort).toBe(effectiveEffort);
    expect(parseDocument(await fs.readFile(out, 'utf8')).metadata?.workerBuild).toMatchObject({
      reasoningEffort: effectiveEffort,
    });
  }, 20000);
});
