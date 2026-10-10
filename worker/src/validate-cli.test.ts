import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { resolveDefaultSchemaSource } from './default-assets';
import { validateCli } from './validate-cli';

const schemaSource = resolveDefaultSchemaSource();
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'validate-catalog-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
async function file(name: string, raw: string) {
  const target = path.join(root, name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, raw);
  return target;
}
const diagram = (ref: string) =>
  `version: 0.1.0\nschemaRefs:\n  - schema: ${ref}\n    layer: 0\nentities:\n  - id: app\n    type: core/web-app.types.application\n    name: App\nrelations: []\n`;
const schema = (ref: string) =>
  `owner: user\nname: custom\nversion: "0.1"\nuse:\n  - schema: ${ref}\n    alias: web\ntypes: []\nrelations: []\n`;
it.each([
  'core/web-app@99.0',
  'user/only@0.1',
])('explains unavailable diagram schema %s without cascading type errors', async (ref) => {
  const result = await validateCli({
    path: await file('diagram.yaml', diagram(ref)),
    schemaSource,
  });
  expect(result.ok).toBe(false);
  expect(result.diagnostics).toEqual([
    expect.objectContaining({
      code: 'schema.resolution.missing_dependency',
      message: `Schema ${ref} isn't available. Pass it with --schema <file> or --schema-source <dir>.`,
    }),
  ]);
});
it.each([
  'core/web-app',
  'core/web-app@9.9',
])('rejects unpinned or unavailable schema dependency %s in both validation modes', async (ref) => {
  const target = await file('schemas/custom.yaml', schema(ref));
  const single = await validateCli({ path: target, kind: 'schema', schemaSource });
  expect(single.ok).toBe(false);
  expect(single.diagnostics).toContainEqual(
    expect.objectContaining({
      code: ref.includes('@')
        ? 'schema.resolution.missing_dependency'
        : 'schema.resolution.unpinned_dependency',
    }),
  );
  const registry = await validateCli({ path: path.dirname(target), kind: 'schema-registry' });
  expect(registry.ok).toBe(false);
  expect(registry.diagnostics.length).toBeGreaterThan(0);
});
it('distinguishes an ordinary YAML directory from a schema registry', async () => {
  await file('repo/docker-compose.yaml', 'services:\n  app:\n    image: test\n');
  await expect(validateCli({ path: path.join(root, 'repo') })).rejects.toThrow("can't tell what");
  const valid = await file(
    'registry/module.yaml',
    'owner: user\nname: plain\nversion: "0.1"\ntypes: []\nrelations: []\n',
  );
  expect((await validateCli({ path: path.dirname(valid) })).kind).toBe('schema-registry');
  const broken = await file('conventional/src/schemas/broken.yaml', 'owner: [\n');
  const result = await validateCli({ path: path.resolve(broken, '../../..') });
  expect(result.kind).toBe('schema-registry');
  expect(result.diagnostics.length).toBeGreaterThan(0);
});
it('compiles nested filesystem imports relative to each importing diagram', async () => {
  await file('parts/grand.yaml', diagram('core/web-app@0.3'));
  await file(
    'parts/child.yaml',
    'version: 0.1.0\nschemaRefs: []\nimports:\n  - slug: grand\n    namespace: grand\nentities: []\nrelations: []\n',
  );
  const target = await file(
    'root.yaml',
    'version: 0.1.0\nschemaRefs: []\nimports:\n  - slug: parts/child.yaml\n    namespace: child\nentities: []\nrelations: []\n',
  );
  expect(await validateCli({ path: target, schemaSource })).toMatchObject({ ok: true });
  await fs.rm(path.join(root, 'parts/grand.yaml'));
  expect(await validateCli({ path: target, schemaSource })).toMatchObject({
    ok: false,
    diagnostics: [expect.objectContaining({ code: 'diagram.source.import_not_found' })],
  });
});
it('rejects duplicate extra schema IDs and names both files', async () => {
  const bundled = path.join(schemaSource, 'web-app.yaml');
  const duplicate = await file('duplicate.yaml', await fs.readFile(bundled, 'utf8'));
  const target = await file('diagram.yaml', diagram('core/web-app@0.3'));
  await expect(validateCli({ path: target, schemaSource, schemas: [duplicate] })).rejects.toThrow(
    `duplicate schema id core/web-app: ${bundled} and ${duplicate}`,
  );
});
it('accepts a correctly pinned custom schema via --schema', async () => {
  const custom = await file('custom.yaml', schema('core/web-app@0.3'));
  const target = await file('diagram.yaml', diagram('user/custom@0.1'));
  expect(await validateCli({ path: target, schemaSource, schemas: [custom] })).toMatchObject({
    ok: true,
  });
});
it('preserves valid standalone relation IDs containing path separators', async () => {
  const raw = `${diagram('core/web-app@0.3').replace('relations: []', '')}relations:\n  - id: app/to/app\n    from: app\n    to: app\n    type: core/software.relations.calls\n`;
  const result = await validateCli({ path: await file('standalone.yaml', raw), schemaSource });
  expect(result.diagnostics.some((entry) => entry.code.startsWith('diagram.source.'))).toBe(false);
  expect(result.diagnostics).toEqual([]);
  expect(result.ok).toBe(true);
});
