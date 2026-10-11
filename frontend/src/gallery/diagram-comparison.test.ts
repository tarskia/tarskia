import type { SemanticDocument } from '@tarskia/diagram-semantics';
import { describe, expect, it } from 'vitest';
import { buildViewerComparison, isCurrentComparison, nextChangeIndex } from './diagram-comparison';

const base: SemanticDocument = {
  version: '0.1.0',
  schemaRefs: [],
  entities: [
    {
      id: 'old',
      type: 'group',
      name: 'Old',
      children: [
        { id: 'moved', type: 'service', name: 'Move me' },
        { id: 'removed', type: 'service' },
      ],
    },
    {
      id: 'new',
      type: 'group',
      name: 'New',
      children: [{ id: 'renamed', type: 'service', name: 'Before', props: { language: 'js' } }],
    },
  ],
  relations: [{ id: 'removed-edge', from: 'removed', to: 'moved', type: 'calls' }],
};
const after: SemanticDocument = {
  ...base,
  entities: [
    { id: 'old', type: 'group', name: 'Old' },
    {
      id: 'new',
      type: 'group',
      name: 'New',
      children: [
        { id: 'moved', type: 'service', name: 'Move me' },
        { id: 'renamed', type: 'service', name: 'After', props: { language: 'ts' } },
        { id: 'added', type: 'service', name: 'Added' },
      ],
    },
  ],
  relations: [{ id: 'added-edge', from: 'added', to: 'moved', type: 'calls' }],
};
describe('viewer comparison', () => {
  it('retains tombstones and displays moved entities only in their new place', () => {
    const result = buildViewerComparison({ before: base, after });
    expect(result.document.entities.filter((entity) => entity.id === 'moved')).toEqual([
      expect.objectContaining({ parent: 'new' }),
    ]);
    expect(result.document.entities.find((entity) => entity.id === 'removed')).toMatchObject({
      parent: 'old',
    });
    expect(result.diff.entities.find((entry) => entry.entityId === 'moved')).toMatchObject({
      change: 'changed',
      changedFields: ['parent'],
    });
    expect(result.document.relations.map((edge) => edge.id).sort()).toEqual([
      'added-edge',
      'removed-edge',
    ]);
    expect(
      result.diff.entities.find((entry) => entry.entityId === 'renamed')?.changedFields,
    ).toEqual(['name', 'props']);
  });
  it('expands all change ancestors and includes edges in navigation', () => {
    const result = buildViewerComparison({ before: base, after });
    expect(result.initialView.nodesById).toMatchObject({
      old: { expanded: true },
      new: { expanded: true },
    });
    expect(result.targets).toContainEqual({
      kind: 'relation',
      id: 'removed-edge',
      nodeIds: ['removed', 'moved'],
    });
    expect(result.targets.filter((target) => target.id === 'moved')).toHaveLength(1);
  });
  it('only accepts compare files matching current bytes', async () => {
    const raw = 'hello';
    const afterSha256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
    expect(
      await isCurrentComparison(raw, JSON.stringify({ baseCommit: '1234567', afterSha256 })),
    ).toBe('1234567');
    expect(
      await isCurrentComparison(`${raw}\n`, JSON.stringify({ baseCommit: '1234567', afterSha256 })),
    ).toBeUndefined();
    expect(await isCurrentComparison(raw, 'invalid')).toBeUndefined();
  });
});

it('navigates from an unselected change and wraps in both directions', () => {
  expect(nextChangeIndex(-1, -1, 4)).toBe(3);
  expect(nextChangeIndex(-1, 1, 4)).toBe(0);
  expect(nextChangeIndex(0, -1, 4)).toBe(3);
  expect(nextChangeIndex(3, 1, 4)).toBe(0);
});
