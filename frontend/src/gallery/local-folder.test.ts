import { createHash } from 'node:crypto';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import {
  type DirectoryHandle,
  directoryFromEntry,
  directoryFromHandle,
  openRepoFolder,
} from './local-folder';

const raw = (name: string, represents?: string) => `version: 0.1.0
schemaRefs:
  - schema: core/base@0.1
    layer: 0
metadata:
  name: ${name}
entities:
  - id: app
    type: core/base.types.entity
    name: ${name}
${represents ? `    represents: ${represents}\n` : ''}relations: []
`;
const schema = `owner: repo
name: example
version: '0.1'
types:
  - id: service
    label: Service
relations: []
`;
type Tree = { [name: string]: string | Tree };
function fakeFolder(tree: Tree) {
  const listed: string[] = [];
  const read: string[] = [];
  const handle = (name: string, children: Tree, path = name): DirectoryHandle => ({
    kind: 'directory',
    name,
    async *values() {
      listed.push(path);
      for (const [name, value] of Object.entries(children)) {
        if (typeof value === 'string')
          yield {
            kind: 'file' as const,
            name,
            getFile: async () =>
              ({
                name,
                size: value.length,
                text: async () => {
                  read.push(`${path}/${name}`);
                  return value;
                },
              }) as File,
          };
        else yield handle(name, value, `${path}/${name}`);
      }
    },
  });
  const entry = (name: string, children: Tree, path = name): FileSystemDirectoryEntry =>
    ({
      name,
      isDirectory: true,
      createReader() {
        let index = 0;
        const childrenEntries = Object.entries(children).map(([name, value]) =>
          typeof value === 'string'
            ? {
                name,
                isDirectory: false,
                file: (resolve: (file: unknown) => void) =>
                  resolve({
                    name,
                    size: value.length,
                    text: async () => {
                      read.push(`${path}/${name}`);
                      return value;
                    },
                  }),
              }
            : entry(name, value, `${path}/${name}`),
        );
        return {
          readEntries(resolve: (entries: unknown[]) => void) {
            if (!index) listed.push(path);
            resolve(childrenEntries.slice(index, ++index));
          },
        };
      },
    }) as FileSystemDirectoryEntry;
  return { handle: handle('workspace', tree), entry: entry('workspace', tree), listed, read };
}
describe.each(['handle', 'entry'] as const)('folder opening using %s', (kind) => {
  const open = (tree: Tree) => {
    const fake = fakeFolder(tree);
    return {
      fake,
      result: openRepoFolder(
        kind === 'handle' ? directoryFromHandle(fake.handle) : directoryFromEntry(fake.entry),
      ),
    };
  };
  it('reads only chosen files in own/direct-child .tarskia, never node_modules or job artifacts outside compare', async () => {
    const { fake, result } = open({
      root: {
        '.tarskia': {
          'root.yaml': raw('Root'),
          'ignored.txt': 'secret',
          '.job': { 'draft.yaml': 'bad' },
        },
      },
      api: {
        '.tarskia': { 'api.yaml': raw('API') },
        src: { '.tarskia': { 'nested.yaml': 'bad' } },
        node_modules: {},
      },
      node_modules: { '.tarskia': { 'wrong.yaml': 'bad' } },
      '.job': { '.tarskia': { 'wrong.yaml': 'bad' } },
    });
    expect((await result).folder?.repos).toEqual(['api', 'root']);
    expect(fake.listed).toEqual([
      'workspace',
      'workspace/root',
      'workspace/root/.tarskia',
      'workspace/api',
      'workspace/api/.tarskia',
      'workspace/root/.tarskia/.job',
    ]);
    expect(fake.read.sort()).toEqual([
      'workspace/api/.tarskia/api.yaml',
      'workspace/root/.tarskia/root.yaml',
    ]);
  });
  it('reads only matching compare files and exposes current changes', async () => {
    const current = raw('Current');
    const { fake, result } = open({
      '.tarskia': {
        'api.yaml': current,
        '.job': {
          workspace: { 'secret.txt': 'secret' },
          compare: {
            'api.base.yaml': raw('Before'),
            'api.json': JSON.stringify({
              baseCommit: '1234567',
              afterSha256: createHash('sha256').update(current).digest('hex'),
            }),
            'other.base.yaml': 'ignored',
            'secret.txt': 'ignored',
          },
        },
      },
    });
    expect((await result).comparison?.baseCommits).toEqual(['1234567']);
    expect(fake.read.sort()).toEqual([
      'workspace/.tarskia/.job/compare/api.base.yaml',
      'workspace/.tarskia/.job/compare/api.json',
      'workspace/.tarskia/api.yaml',
    ]);
    expect(fake.listed).not.toContain('workspace/.tarskia/.job/workspace');
  });
  it('combines two repos and merges a stand-in into its sibling target', async () => {
    const { result } = open({
      api: { '.tarskia': { 'api.yaml': raw('API') } },
      web: { '.tarskia': { 'web.yaml': raw('Web', 'api/app') } },
    });
    const opened = await result;
    const doc = load(opened.raw) as { entities: { id: string }[] };
    expect(doc.entities.map((e) => e.id)).toEqual(['api/app']);
    expect(opened.folder).toMatchObject({ name: 'workspace', repos: ['api', 'web'] });
  });
  it('does not scan children when the root has an empty .tarskia', async () => {
    const { fake, result } = open({
      '.tarskia': {},
      child: { '.tarskia': { 'api.yaml': raw('API') } },
    });
    await expect(result).rejects.toThrow('There are no Tarskia diagrams');
    expect(fake.listed).toEqual(['workspace', 'workspace/.tarskia']);
  });
  it('opens one repo alone', async () => {
    const { result } = open({ '.tarskia': { 'api.yaml': raw('API') } });
    expect(await result).toMatchObject({ raw: raw('API'), title: 'API' });
    expect((await result).folder).toBeUndefined();
  });
  it('reports no diagrams with the approved copy', async () => {
    await expect(open({ node_modules: {} }).result).rejects.toThrow(
      'There are no Tarskia diagrams in workspace. Open a repo that has a .tarskia folder, or a folder of such repos.',
    );
  });
  it('reports missing schemas with the repo name and pinned ref', async () => {
    await expect(
      open({ '.tarskia': { 'api.yaml': raw('API').replace('core/base@0.1', 'repo/example@0.1') } })
        .result,
    ).rejects.toThrow(
      "api's diagram needs the schema repo/example@0.1, which belongs next to it in .tarskia.",
    );
  });
  it('loads schemas found beside the diagrams', async () => {
    const { result } = open({
      '.tarskia': {
        'api.yaml': raw('API')
          .replace('core/base@0.1', 'repo/example@0.1')
          .replace('core/base.types.entity', 'repo/example.types.service'),
        'api.schema.yaml': schema,
      },
    });
    expect((await result).schemaEntries).toHaveLength(1);
  });
  it('reports a combining failure with the first error', async () => {
    const { result } = open({
      api: { '.tarskia': { 'api.yaml': raw('API', 'web/app') } },
      web: { '.tarskia': { 'web.yaml': raw('Web', 'api/app') } },
    });
    await expect(result).rejects.toThrow("The diagrams in workspace couldn't be combined:");
  });
  it('retains missing targets as disclosure data', async () => {
    const { result } = open({
      api: { '.tarskia': { 'api.yaml': raw('API') } },
      web: { '.tarskia': { 'web.yaml': raw('Web', 'api/missing') } },
    });
    expect((await result).folder?.missingTargets).toEqual([
      { repo: 'web', name: 'Web', target: 'api/missing' },
    ]);
  });
});
