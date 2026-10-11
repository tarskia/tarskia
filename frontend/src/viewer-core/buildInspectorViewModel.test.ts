import {
  buildEntityIndex,
  type DocumentInput,
  type Entity,
  type SchemaModule,
} from '@tarskia/diagram-semantics';
import { describe, expect, it } from 'vitest';
import { buildDiagramProvenanceSource, buildInspectorViewModel } from './buildInspectorViewModel';

const inputs: DocumentInput[] = [
  {
    id: 'primary',
    kind: 'git',
    role: 'primary',
    repo: 'https://github.com/acme/root',
    revision: 'a'.repeat(40),
  },
  {
    id: 'backend/primary',
    kind: 'git',
    role: 'secondary',
    repo: 'https://github.com/acme/backend',
    revision: 'b'.repeat(40),
  },
];
const schema: SchemaModule = {
  owner: 'user',
  name: 'test',
  version: '1',
  types: [{ id: 'service', label: 'Service' }],
  relations: [],
};
describe('inspector provenance input resolution', () => {
  it.each([
    'entity',
    'relation',
  ])('links %s locations to the named secondary input, preserving explicit overrides and primary fallback', (kind) => {
    const selectedEntity: Entity = {
      id: 'api',
      type: 'service',
      provenance: {
        locations: [
          { input: 'backend/primary', path: 'src/api.ts' },
          {
            input: 'backend/primary',
            path: 'src/space name.ts',
            repo: 'https://github.com/acme/override',
            commit: 'c'.repeat(40),
          },
          { path: 'src/root.ts' },
        ],
      },
    };
    const model = buildInspectorViewModel({
      ...(kind === 'entity'
        ? { selectedEntity }
        : {
            selectedEdge: {
              id: 'edge',
              from: 'api',
              to: 'api',
              provenance: selectedEntity.provenance,
            },
          }),
      entityIndex: buildEntityIndex([selectedEntity]),
      schema,
      inputs,
      diagramProvenanceSource: buildDiagramProvenanceSource({ inputs }),
    });
    if (model.kind === 'empty') throw new Error('Expected selected inspector');
    expect(model.provenance?.locations.map((l) => l.permalink)).toEqual([
      `https://github.com/acme/backend/blob/${'b'.repeat(40)}/src/api.ts`,
      `https://github.com/acme/override/blob/${'c'.repeat(40)}/src/space%20name.ts`,
      `https://github.com/acme/root/blob/${'a'.repeat(40)}/src/root.ts`,
    ]);
  });
});
