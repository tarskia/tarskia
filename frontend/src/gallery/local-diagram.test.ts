import { readFileSync } from 'node:fs';
import { parseAndValidateSchemaModule } from '@tarskia/diagram-semantics';
import { describe, expect, it, vi } from 'vitest';
import { LOCAL_FILE_LIMIT, openLocalDiagram } from './local-diagram';

const diagram = readFileSync(new URL('./fixtures/local-example.yaml', import.meta.url), 'utf8');
const schema = readFileSync(
  new URL('./fixtures/local-example-schema.yaml', import.meta.url),
  'utf8',
);
const file = (name: string, raw: string) => ({
  name,
  size: raw.length,
  text: vi.fn(async () => raw),
});
const missing = (ref: string) =>
  `This diagram needs the schema ${ref}. Open the diagram together with its schema file, which tarskia build writes to the --schema-out path.`;
describe('opening local diagrams', () => {
  it('accepts a diagram with its untrusted schema in either order', async () => {
    for (const files of [
      [file('example.yaml', diagram), file('schema.yml', schema)],
      [file('schema.yml', schema), file('example.yaml', diagram)],
    ]) {
      const opened = await openLocalDiagram(files);
      expect(opened).toMatchObject({
        raw: diagram,
        filename: 'example.yaml',
        title: 'Local example',
        schemaEntries: [{ schemaId: 'repo/example', version: '0.1' }],
      });
    }
  });
  it('reports missing dependencies, including transitive dependencies', async () => {
    await expect(openLocalDiagram([file('example.yaml', diagram)])).rejects.toThrow(
      missing('repo/example@0.1'),
    );
    const dependent = schema + '\nuse:\n  - schema: repo/dependency@0.1\n    alias: dependency\n';
    // Use the schema module's pinned dependency contract.
    expect(parseAndValidateSchemaModule(dependent).ok).toBe(true);
    await expect(
      openLocalDiagram([file('example.yaml', diagram), file('schema.yaml', dependent)]),
    ).rejects.toThrow(missing('repo/dependency@0.1'));
  });
  it('rejects zero and multiple diagrams with approved copy', async () => {
    await expect(openLocalDiagram([file('schema.yaml', schema)])).rejects.toThrow(
      'None of these files is a Tarskia diagram.',
    );
    await expect(openLocalDiagram([])).rejects.toThrow('None of these files is a Tarskia diagram.');
    await expect(
      openLocalDiagram([file('a.yaml', diagram), file('b.yml', diagram)]),
    ).rejects.toThrow('Open one diagram at a time. You can add its schema files with it.');
  });
  it('rejects oversized selections before reading any file', async () => {
    const first = file('a.yaml', diagram);
    const large = { ...file('large.yml', schema), size: LOCAL_FILE_LIMIT + 1 };
    await expect(openLocalDiagram([first, large])).rejects.toThrow(
      'large.yml is larger than 50 MB.',
    );
    expect(first.text).not.toHaveBeenCalled();
    expect(large.text).not.toHaveBeenCalled();
  });
  it('reports malformed YAML, unreadable documents and read failures', async () => {
    for (const raw of ['[broken', 'plain text', 'entities: invalid']) {
      await expect(openLocalDiagram([file('bad.yaml', raw)])).rejects.toThrow(
        "bad.yaml couldn't be read as a Tarskia diagram.",
      );
    }
    await expect(
      openLocalDiagram([
        {
          name: 'bad.yaml',
          size: 1,
          text: async () => {
            throw new Error('OS failure');
          },
        },
      ]),
    ).rejects.toThrow("bad.yaml couldn't be read as a Tarskia diagram.");
  });
  it('reports the first schema diagnostic and rejects built-in owners', async () => {
    const raw = schema.replace('types:\n  - id: service\n    label: Service', 'types: invalid');
    const parsed = parseAndValidateSchemaModule(raw);
    await expect(
      openLocalDiagram([file('schema.yml', raw), file('example.yaml', diagram)]),
    ).rejects.toThrow(`schema.yml isn't a valid schema: ${parsed.diagnostics[0].message}`);
    const core = schema
      .replace('owner: repo', 'owner: core')
      .replace('name: example', 'name: web-app')
      .replace("version: '0.1'", "version: '0.3'");
    await expect(
      openLocalDiagram([file('core.yaml', core), file('example.yaml', diagram)]),
    ).rejects.toThrow("core.yaml can't replace the built-in schema core/web-app.");
  });
  it('uses the filename without extension and accepts readable validation diagnostics', async () => {
    const raw = diagram
      .replace('metadata:\n  name: Local example\n', '')
      .replace('repo/example.types.service', 'repo/example.types.unknown');
    expect(
      (await openLocalDiagram([file('my diagram.YML', raw), file('schema.yaml', schema)])).title,
    ).toBe('my diagram');
  });
  it('opens a curated file using bundled schemas alone', async () => {
    const raw = readFileSync(new URL('../../../gallery/curated/n8n.yaml', import.meta.url), 'utf8');
    expect((await openLocalDiagram([file('n8n.yaml', raw)])).raw).toBe(raw);
  });
});
