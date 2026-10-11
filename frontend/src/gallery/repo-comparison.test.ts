import { createHash } from 'node:crypto';
import { diffSemanticDiagramDocuments } from '@tarskia/diagram-semantics';
import { describe, expect, it } from 'vitest';
import { readRepoComparison } from './repo-comparison';

const diagram = (label: string) => `version: '1'
entities:
  - id: caller
    type: service
  - id: remote
    type: service
    represents: b/service
relations:
  - id: call
    from: caller
    to: remote
    type: calls
    label: ${label}
`;
const current = diagram('New call');
const other = `version: '1'\nentities:\n  - id: service\n    type: service\nrelations: []\n`;
const files = [
  { path: 'repo-a/.tarskia/a.yaml', raw: current },
  { path: 'repo-b/.tarskia/b.yaml', raw: other },
  { path: 'repo-a/.tarskia/.job/compare/a.base.yaml', raw: diagram('Old call') },
  {
    path: 'repo-a/.tarskia/.job/compare/a.json',
    raw: JSON.stringify({
      baseCommit: '1234567890',
      afterSha256: createHash('sha256').update(current).digest('hex'),
    }),
  },
];
describe('repo comparison', () => {
  it('combines a current base with unchanged repos and finds cross-repo link changes', async () => {
    const comparison = await readRepoComparison('workspace', files);
    expect(comparison?.baseCommits).toEqual(['1234567890']);
    expect(comparison?.before.relations[0]).toMatchObject({
      from: 'a/caller',
      to: 'b/service',
      label: 'Old call',
    });
    expect(comparison?.after.relations[0]).toMatchObject({
      from: 'a/caller',
      to: 'b/service',
      label: 'New call',
    });
    const diff = diffSemanticDiagramDocuments(comparison!);
    expect(diff.relations.find((entry) => entry.relationId === 'a/call')).toMatchObject({
      change: 'changed',
      changedFields: ['label'],
    });
    expect(diff.entities.find((entry) => entry.entityId === 'b/service')?.change).toBe('unchanged');
  });
  it('offers no comparison with absent or stale bases', async () => {
    expect(await readRepoComparison('workspace', files.slice(0, 2))).toBeUndefined();
    expect(
      await readRepoComparison(
        'workspace',
        files.map((file, index) => (index === 0 ? { ...file, raw: `${file.raw}\n` } : file)),
      ),
    ).toBeUndefined();
  });
});
