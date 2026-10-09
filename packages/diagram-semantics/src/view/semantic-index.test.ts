import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagramView, SchemaModule } from '../model/types';
import * as entityTree from '../tree/entity-tree';
import { compileDiagramViewState, compileView } from './compile-diagram-view-tree';
import * as displayLabels from './display-labels';
import { buildSemanticIndex, type DiagramContent } from './semantic-index';

const fixture = () => {
  const schema: SchemaModule = {
    owner: 'test',
    name: 'index',
    version: '1',
    types: [{ id: 'group' }, { id: 'leaf' }],
    relations: [{ id: 'calls', label: 'Calls' }],
  };
  const content: DiagramContent = {
    version: '1',
    schemaRefs: [],
    entities: [
      {
        id: 'group',
        type: 'group',
        children: [
          { id: 'a', type: 'leaf' },
          { id: 'b', type: 'leaf' },
        ],
      },
      { id: 'remote', type: 'leaf' },
    ],
    relations: [{ id: 'r', type: 'calls', from: 'a', to: 'remote' }],
  };
  return { content, schema };
};
const view = (nodesById: DiagramView['nodesById'], scopeRootId?: string): DiagramView => ({
  kind: 'semantic-diagram-view',
  version: 2,
  nodesById,
  scopeRootId,
});
afterEach(() => vi.restoreAllMocks());

describe('immutable semantic index and compiled view', () => {
  it('indexes content once and reuses camera-only view compilation without changing camera input', () => {
    const { content, schema } = fixture();
    const treeBuild = vi.spyOn(entityTree, 'buildEntityTree');
    const labelBuild = vi.spyOn(displayLabels, 'resolveRelationDisplayLabel');
    const index = buildSemanticIndex(content, schema);
    expect(buildSemanticIndex({ ...content }, schema)).toBe(index);
    const nodes = { group: { expanded: true }, a: { highlighted: true } };
    const firstView = { ...view(nodes), layout: { viewport: { x: 1, y: 2, zoom: 0.5 } } };
    const secondView = { ...firstView, layout: { viewport: { x: 300, y: -10, zoom: 1.5 } } };
    const first = compileView(index, firstView);
    expect(compileView(index, secondView)).toBe(first);
    expect(secondView.layout.viewport).toEqual({ x: 300, y: -10, zoom: 1.5 });
    expect(first.tree.byId.get('a')?.view.highlighted).toBe(true);
    expect(first.edges[0]?.label).toBe('Calls');
    expect(compileView(index, view({}))).not.toBe(first);
    expect(compileView(index, view(nodes, 'group'))).not.toBe(first);
    expect(compileView(index, firstView)).toBe(first);
    expect(treeBuild).toHaveBeenCalledTimes(1);
    expect(labelBuild).toHaveBeenCalledTimes(1);
    expect(index.content).not.toHaveProperty('view');
  });
  it('preserves legacy compiler results for expansion, focus, highlights and leaf list metadata', () => {
    const { content, schema } = fixture();
    const index = buildSemanticIndex(content, schema);
    for (const current of [
      undefined,
      view({ group: { expanded: true } }),
      view({ a: { highlighted: true } }, 'group'),
    ]) {
      expect(compileView(index, current)).toEqual(
        compileDiagramViewState({ doc: { ...content, view: current }, schema }),
      );
    }
    expect(compileView(index, view({})).tree.byId.get('group')?.isListContainer).toBe(true);
    const edited = {
      ...content,
      relations: [...content.relations, { id: 'internal', from: 'a', to: 'b' }],
    };
    const next = buildSemanticIndex(edited, schema);
    expect(next).not.toBe(index);
    expect(compileView(next, view({})).tree.byId.get('group')?.isListContainer).toBe(false);
    expect(buildSemanticIndex(content, { ...schema })).not.toBe(index);
    expect(buildSemanticIndex({ ...content, entities: [...content.entities] }, schema)).not.toBe(
      index,
    );
  });
  it('protects shared index maps and compiled geometry-independent state from mutation', () => {
    const { content, schema } = fixture();
    const index = buildSemanticIndex(content, schema);
    const result = compileView(index, view({ group: { expanded: true } }));
    expect(() => index.tree.byId.clear()).toThrow(TypeError);
    expect(() => index.entityIndex.byId.delete('a')).toThrow(TypeError);
    expect(() => index.entityIndex.entries.push({ entity: content.entities[0], depth: 0 })).toThrow(
      TypeError,
    );
    expect(() => result.tree.root.children.pop()).toThrow(TypeError);
    const leaf = result.tree.byId.get('a');
    if (!leaf) throw new Error('Expected projected leaf');
    expect(() => {
      leaf.view.highlighted = true;
    }).toThrow(TypeError);
    expect(() => result.edges.push(result.edges[0])).toThrow(TypeError);
    expect(index.tree.byId.get('a')?.entity).toBe(content.entities[0].children?.[0]);
  });
});
