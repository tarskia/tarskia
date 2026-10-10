import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Codex } from '@openai/codex-sdk';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AdvancedThreadManager } from './advanced-thread-manager';

let workspaceRoot: string;
let codexPath: string;

beforeAll(async () => {
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tarskia-sdk-'));
  codexPath = path.join(workspaceRoot, 'fake-codex');
  await fs.writeFile(
    codexPath,
    `#!${process.execPath}
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const emit = (event) => process.stdout.write(JSON.stringify(event) + '\\n');
  emit({ type: 'thread.started', thread_id: 'sdk-thread' });
  emit({ type: 'item.completed', item: {
    id: 'message', type: 'agent_message',
    text: JSON.stringify({ args: process.argv.slice(2), input }),
  } });
  emit({ type: 'turn.completed', usage: {
    input_tokens: 10, cached_input_tokens: 0, cache_write_input_tokens: 0,
    output_tokens: 5, reasoning_output_tokens: 2,
  } });
});
`,
    { mode: 0o755 },
  );
});

afterAll(async () => {
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

describe('installed Codex SDK transport', () => {
  it.each([
    ['gpt-6-luna', 'max'],
    ['gpt-6-sol', 'xhigh'],
    ['gpt-6.1-sol', 'persistent'],
    ['gpt-6-astra', 'ultra'],
    ['gpt-5.6-sol', 'high'],
    ['gpt-5.6-terra', 'medium'],
    ['gpt-5.6-luna', 'minimal'],
    ['gpt-5.5', 'high'],
    ['future-model-id', 'low'],
  ] as const)('passes %s / %s through new and resumed turns', async (model, effort) => {
    const manager = new AdvancedThreadManager({
      client: new Codex({ codexPathOverride: codexPath }),
      workspaceRoot,
      model,
      modelReasoningEffort: effort,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      canResumePersistedThread: false,
    });
    for (const prompt of ['draft', 'repair']) {
      const turn = await manager.runPrompt({
        prompt,
        operation: prompt,
        scope: 'pre-refinement',
      });
      const transport = JSON.parse(turn.finalResponse) as { args: string[]; input: string };
      expect(transport.args[transport.args.indexOf('--model') + 1]).toBe(model);
      expect(transport.args).toContain(`model_reasoning_effort="${effort}"`);
      expect(transport.args).toContain('read-only');
      expect(transport.args).toContain('approval_policy="never"');
      expect(transport.args).toContain('web_search="disabled"');
      expect(transport.input).toBe(prompt);
      expect(transport.args.includes('resume')).toBe(prompt === 'repair');
      expect(turn.threadId).toBe('sdk-thread');
    }
  });
});
