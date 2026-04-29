import { describe, expect, it } from 'vitest';

import { DEFAULT_DIAGRAM_OWNER_SCOPE } from '../model/diagram-store';
import { serializeDocument } from '../semantic';
import { semanticBootstrap } from '../semantic/bootstrap';
import { reconcileBundledStarterArtifacts } from './bundled-starter-reconciliation';

describe('reconcileBundledStarterArtifacts', () => {
  it('drops untouched bundled starter drafts from guest storage', () => {
    const starter = semanticBootstrap.primaryStarter;
    if (!starter) {
      throw new Error('Expected bundled starter');
    }

    const snapshot = {
      streams: [
        {
          id: 'diagram-1',
          name: 'Starter Diagram',
          slug: 'starter-diagram',
          scope: DEFAULT_DIAGRAM_OWNER_SCOPE,
          createdAt: '2026-04-13T10:00:00.000Z',
          updatedAt: '2026-04-13T10:00:00.000Z',
          streamVersion: 1,
          draft: {
            raw: serializeDocument(starter.document),
            name: 'Starter Diagram',
            updatedAt: '2026-04-13T10:00:00.000Z',
            valid: true,
          },
          revisions: [],
        },
      ],
    };

    const reconciled = reconcileBundledStarterArtifacts({
      snapshot,
      starters: semanticBootstrap.bundledStarters,
    });

    expect(reconciled.changed).toBe(true);
    expect(reconciled.snapshot.streams).toHaveLength(0);
  });

  it('drops bundled starter drafts even when they only differ by saved view state', () => {
    const starter = semanticBootstrap.primaryStarter;
    if (!starter) {
      throw new Error('Expected bundled starter');
    }

    const snapshot = {
      streams: [
        {
          id: 'diagram-1',
          name: 'Starter Diagram',
          slug: 'starter-diagram',
          scope: DEFAULT_DIAGRAM_OWNER_SCOPE,
          createdAt: '2026-04-13T10:00:00.000Z',
          updatedAt: '2026-04-13T10:00:00.000Z',
          streamVersion: 1,
          draft: {
            raw: serializeDocument({
              ...starter.document,
              view: {
                ...(starter.document.view ?? {
                  kind: 'semantic-diagram-view' as const,
                  version: 2 as const,
                }),
                layout: {
                  viewport: { x: 12, y: 34, zoom: 0.7 },
                },
              },
            }),
            name: 'Starter Diagram',
            updatedAt: '2026-04-13T10:00:00.000Z',
            valid: true,
          },
          revisions: [],
        },
      ],
    };

    const reconciled = reconcileBundledStarterArtifacts({
      snapshot,
      starters: semanticBootstrap.bundledStarters,
    });

    expect(reconciled.changed).toBe(true);
    expect(reconciled.snapshot.streams).toHaveLength(0);
  });

  it('leaves non-starter drafts alone so pending renames still work', () => {
    const snapshot = {
      streams: [
        {
          id: 'diagram-1',
          name: 'Custom Diagram',
          slug: 'custom-diagram',
          scope: DEFAULT_DIAGRAM_OWNER_SCOPE,
          createdAt: '2026-04-13T10:00:00.000Z',
          updatedAt: '2026-04-13T10:00:00.000Z',
          streamVersion: 1,
          draft: {
            raw: 'version: 0.1.0\nmetadata:\n  name: Custom Diagram\nentities: []\nrelations: []',
            name: 'Custom Diagram',
            updatedAt: '2026-04-13T10:00:00.000Z',
            valid: true,
          },
          revisions: [],
        },
      ],
    };

    const reconciled = reconcileBundledStarterArtifacts({
      snapshot,
      starters: semanticBootstrap.bundledStarters,
    });

    expect(reconciled.changed).toBe(false);
    expect(reconciled.snapshot.streams[0]?.name).toBe('Custom Diagram');
    expect(reconciled.snapshot.streams[0]?.draft?.name).toBe('Custom Diagram');
  });

  it('drops legacy and current bundled starter boot artifacts from guest storage', () => {
    const snapshot = {
      streams: [
        {
          id: 'diagram-1',
          name: 'Starter architecture',
          slug: 'starter-architecture',
          scope: DEFAULT_DIAGRAM_OWNER_SCOPE,
          createdAt: '2026-04-13T10:00:00.000Z',
          updatedAt: '2026-04-13T10:00:00.000Z',
          streamVersion: 1,
          draft: {
            raw: 'version: 0.1.0\nmetadata:\n  name: Starter architecture\nentities: []\nrelations: []',
            name: 'Starter architecture',
            updatedAt: '2026-04-13T10:00:00.000Z',
            valid: true,
          },
          revisions: [],
        },
        {
          id: 'diagram-2',
          name: 'Starter Diagram',
          slug: 'starter-diagram',
          scope: DEFAULT_DIAGRAM_OWNER_SCOPE,
          createdAt: '2026-04-13T10:00:00.000Z',
          updatedAt: '2026-04-13T10:00:00.000Z',
          streamVersion: 1,
          draft: {
            raw: serializeDocument(semanticBootstrap.primaryStarter.document),
            name: 'Starter Diagram',
            updatedAt: '2026-04-13T10:00:00.000Z',
            valid: true,
          },
          revisions: [],
        },
      ],
    };

    const reconciled = reconcileBundledStarterArtifacts({
      snapshot,
      starters: semanticBootstrap.bundledStarters,
    });

    expect(reconciled.changed).toBe(true);
    expect(reconciled.snapshot.streams).toHaveLength(0);
  });
});
