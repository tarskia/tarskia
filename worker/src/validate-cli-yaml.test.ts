import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MAX_YAML_INPUT_BYTES } from './untrusted-yaml';
import { validateCli } from './validate-cli';

const schemaSource = path.resolve('assets/schemas');
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'validate-safe-yaml-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
const valid =
  'version: 0.1.0\nschemaRefs: [{schema: core/base@0.1, layer: 0}]\nentities: []\nrelations: []\n';
async function file(name: string, raw: string) {
  const target = path.join(root, name);
  await fs.writeFile(target, raw);
  return target;
}
it.each([
  'auto',
  'diagram',
] as const)('rejects alias bombs with a validation diagnostic in %s', async (kind) => {
  const target = await file(
    'bomb.yaml',
    valid + 'metadata: {a: &a [1], b: &b [*a, *a], c: [*b, *b]}',
  );
  const result = await validateCli({ path: target, kind, schemaSource });
  expect(result).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'diagram.parse.alias_not_allowed' }],
  });
});
it.each(['auto', 'diagram', 'schema'] as const)('rejects oversized files in %s', async (kind) => {
  const target = await file('large.yaml', '#'.repeat(MAX_YAML_INPUT_BYTES + 1));
  expect(await validateCli({ path: target, kind, schemaSource })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'diagram.parse.too_large' }],
  });
});
it('reads an auto-detected target only once', async () => {
  const target = await file('diagram.yaml', valid);
  const read = vi.spyOn(fs, 'readFile');
  const result = await validateCli({ path: target, schemaSource });
  expect(result.ok).toBe(true);
  expect(read.mock.calls.filter(([name]) => name === target)).toHaveLength(1);
});
it('checks imported YAML before the shared compiler sees it', async () => {
  await file('child.yaml', valid + 'metadata: {a: &a {}, b: *a}');
  const target = await file('parent.yaml', valid + 'imports: [{slug: child, namespace: child}]');
  expect(await validateCli({ path: target, schemaSource })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'diagram.parse.alias_not_allowed' }],
  });
});
it.each([
  'schema',
  'schema-registry',
  'auto',
] as const)('preserves schema alias diagnostics for %s', async (kind) => {
  const target = await file(
    'schema.yaml',
    'owner: user\nname: test\nversion: "0.1"\ntypes: &a []\nrelations: *a',
  );
  expect(
    await validateCli({ path: kind === 'schema-registry' ? root : target, kind, schemaSource }),
  ).toMatchObject({ ok: false, diagnostics: [{ code: 'diagram.parse.alias_not_allowed' }] });
});
