import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import type { SchemaModule } from '../model/types';
import { parseDocument } from '../util/serialization';
import { compileView } from './compile-diagram-view-tree';
import { buildSemanticIndex } from './semantic-index';

const directory = resolve(import.meta.dirname, '../../../../gallery/curated');
const files: { file: string }[] = JSON.parse(
  readFileSync(resolve(directory, 'manifest.json'), 'utf8'),
);
const schema: SchemaModule = {
  owner: 'user',
  name: 'test',
  version: '1',
  types: [],
  relations: [],
};
it.each(files)('$file preserves every crossing relation in each top-level focus', ({ file }) => {
  const doc = parseDocument(readFileSync(resolve(directory, file), 'utf8'));
  const index = buildSemanticIndex(doc, schema);
  for (const scope of index.tree.root.children.filter((node) => node.children.length)) {
    const inside = new Set<string>();
    const visit = (id: string) => {
      inside.add(id);
      for (const child of index.tree.byId.get(id)?.children ?? []) visit(child.id);
    };
    visit(scope.id);
    for (const expanded of [false, true]) {
      const nodesById = Object.fromEntries(doc.entities.map((entity) => [entity.id, { expanded }]));
      const outside = compileView(index, { kind: 'semantic-diagram-view', version: 3, nodesById });
      const focused = compileView(index, {
        kind: 'semantic-diagram-view',
        version: 3,
        nodesById,
        scopeRootId: scope.id,
      });
      const crossings = index.renderableRelations.filter(
        (relation) => inside.has(relation.from) !== inside.has(relation.to),
      );
      expect(
        focused.edges
          .filter((edge) => edge.external)
          .map((edge) => edge.relationId)
          .sort(),
      ).toEqual(crossings.map((relation) => relation.id).sort());
      if (file === 'chatwoot.yaml' && scope.id === 'rails-control-plane')
        expect(crossings).toHaveLength(20);
      for (const edge of focused.edges.filter((edge) => edge.external)) {
        const external = edge.external!;
        expect(outside.tree.byId.has(external.displayId)).toBe(true);
        let nearest = index.tree.byId.get(external.entityId);
        while (nearest && !outside.tree.byId.has(nearest.id))
          nearest = nearest.parentId ? index.tree.byId.get(nearest.parentId) : undefined;
        expect(external.displayId).toBe(nearest?.id);
        expect(edge[external.end === 'source' ? 'sourceId' : 'targetId']).toBe(external.displayId);
        const inner = edge[external.end === 'source' ? 'targetId' : 'sourceId'];
        expect(inner === scope.id || focused.tree.byId.has(inner)).toBe(true);
      }
      expect(outside.edges.every((edge) => !edge.external)).toBe(true);
    }
  }
});
