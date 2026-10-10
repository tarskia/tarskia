import { expect, it, vi } from 'vitest';
import {
  CODEX_LOGIN_MESSAGE,
  checkSetup,
  createSetupProbes,
  explainModelEffortError,
  REQUIRED_UV_MESSAGE,
  runBuildWithPreflight,
} from './setup-preflight';

it('uses the SDK bundled launcher and login status, never a PATH codex', async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const probes = createSetupProbes(run);
  expect(await probes.codex()).toBe(true);
  expect(run).toHaveBeenCalledWith(process.execPath, [
    expect.stringMatching(/@openai[/\\]codex[/\\]bin[/\\]codex\.js$/),
    'login',
    'status',
  ]);
  expect(await probes.uv()).toBe(true);
  expect(run).toHaveBeenLastCalledWith('uv', ['--version']);
});
it('reports a failed Codex probe and optional uv warning', async () => {
  const probes = createSetupProbes(vi.fn().mockRejectedValue(new Error('missing')));
  const checks = await checkSetup(probes);
  expect(checks).toEqual([
    { name: 'Codex', ok: false, detail: CODEX_LOGIN_MESSAGE },
    { name: 'uv', ok: false, warning: true, detail: expect.any(String) },
  ]);
});
it('reports signed-in Codex and installed uv', async () => {
  expect(
    (await checkSetup({ codex: async () => true, uv: async () => true })).every((item) => item.ok),
  ).toBe(true);
});
it('stops before cloning/building when Codex is not signed in', async () => {
  const cloneAndBuild = vi.fn();
  await expect(
    runBuildWithPreflight({}, cloneAndBuild, { codex: async () => false, uv: async () => true }),
  ).rejects.toThrow(CODEX_LOGIN_MESSAGE);
  expect(cloneAndBuild).not.toHaveBeenCalled();
});
it('requires uv before cloning only in required mode', async () => {
  const cloneAndBuild = vi.fn().mockResolvedValue('result');
  const probes = { codex: async () => true, uv: vi.fn().mockResolvedValue(false) };
  await expect(
    runBuildWithPreflight({ graphifyHintsMode: 'required' }, cloneAndBuild, probes),
  ).rejects.toThrow(REQUIRED_UV_MESSAGE);
  expect(cloneAndBuild).not.toHaveBeenCalled();
  await expect(
    runBuildWithPreflight({ graphifyHintsMode: 'auto' }, cloneAndBuild, probes),
  ).resolves.toBe('result');
});
it.each([
  "Unsupported value: 'reasoning.effort' is not supported with this model",
  'model does not support reasoning_effort ultra',
])('explains recognized effort errors while preserving their cause: %s', async (message) => {
  const original = new Error(message);
  await expect(
    runBuildWithPreflight(
      { model: 'example-model', reasoningEffort: 'ultra' },
      async () => {
        throw original;
      },
      { codex: async () => true, uv: async () => true },
    ),
  ).rejects.toMatchObject({
    message: "model 'example-model' doesn't support reasoning effort 'ultra'.",
    cause: original,
  });
});
it('keeps other Codex errors unchanged', () => {
  const original = new Error('Codex exec exited with code 1: network timeout');
  expect(explainModelEffortError(original, { model: 'example', reasoningEffort: 'high' })).toBe(
    original,
  );
});
