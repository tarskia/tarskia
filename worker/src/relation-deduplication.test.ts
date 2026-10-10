import { describe, expect, it } from 'vitest';
import { dedupeDocumentRelations } from './relation-deduplication';

describe('dedupeDocumentRelations', () => {
  it('preserves reciprocal relations with their own evidence and descriptions', () => {
    const document = dedupeDocumentRelations({
      version: '0.1.0',
      schemaRefs: [],
      entities: [],
      relations: [
        {
          id: 'shell-calls-state',
          type: 'core/software.relations.calls',
          from: 'shell',
          to: 'state',
          description: 'Shell wires into state.',
          provenance: {
            locations: [{ input: 'primary', path: 'app/index.tsx' }],
          },
        },
        {
          id: 'state-calls-shell',
          type: 'core/software.relations.calls',
          from: 'state',
          to: 'shell',
          description: 'State returns into the shell.',
          provenance: {
            locations: [{ input: 'primary', path: 'app/stores/RootStore.ts' }],
          },
        },
        {
          id: 'shell-reads-state',
          type: 'core/software.relations.reads',
          from: 'shell',
          to: 'state',
          provenance: {
            locations: [{ input: 'primary', path: 'app/index.tsx' }],
          },
        },
      ],
    });

    expect(document.relations).toHaveLength(3);
    expect(document.relations[0]).toMatchObject({
      id: 'shell-calls-state',
      description: 'Shell wires into state.',
      provenance: { locations: [{ input: 'primary', path: 'app/index.tsx' }] },
    });
    expect(document.relations[1]).toMatchObject({
      id: 'state-calls-shell',
      description: 'State returns into the shell.',
      provenance: { locations: [{ input: 'primary', path: 'app/stores/RootStore.ts' }] },
    });
  });

  it('keeps the first relation and backfills provenance from later duplicates', () => {
    const document = dedupeDocumentRelations({
      version: '0.1.0',
      schemaRefs: [],
      entities: [],
      relations: [
        {
          id: 'a-calls-b',
          type: 'core/software.relations.calls',
          from: 'a',
          to: 'b',
        },
        {
          id: 'a-calls-b-again',
          type: 'core/software.relations.calls',
          from: 'a',
          to: 'b',
          provenance: {
            locations: [{ input: 'primary', path: 'src/runtime.ts' }],
          },
        },
      ],
    });

    expect(document.relations).toEqual([
      {
        id: 'a-calls-b',
        type: 'core/software.relations.calls',
        from: 'a',
        to: 'b',
        provenance: {
          confidence: undefined,
          locations: [{ input: 'primary', path: 'src/runtime.ts' }],
        },
      },
    ]);
  });
  it('merges opposite directions only for an explicitly undirected inline schema type', () => {
    const schema = { relations: [{ id: 'repo/example.relations.peer', directed: false }] };
    const document = dedupeDocumentRelations(
      {
        version: '0.1.0',
        schemaRefs: [],
        entities: [],
        relations: [
          {
            id: 'ab',
            type: schema.relations[0].id,
            from: 'a',
            to: 'b',
            provenance: { locations: [{ path: 'a.ts' }] },
          },
          {
            id: 'ba',
            type: schema.relations[0].id,
            from: 'b',
            to: 'a',
            provenance: { locations: [{ path: 'b.ts' }] },
          },
        ],
      },
      (type) => schema.relations.some((r) => r.id === type && r.directed === false),
    );
    expect(document.relations).toHaveLength(1);
    expect(document.relations[0].id).toBe('ab');
    expect(document.relations[0].provenance?.locations).toEqual([
      { path: 'a.ts' },
      { path: 'b.ts' },
    ]);
  });
});
