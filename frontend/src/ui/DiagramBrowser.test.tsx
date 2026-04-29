import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { DiagramBrowser } from './DiagramBrowser';

describe('DiagramBrowser', () => {
  it('renders diagram management actions in the sidebar pane', () => {
    const html = renderToStaticMarkup(
      <DiagramBrowser
        streams={[
          {
            id: 'diagram-1',
            name: 'Payments',
            updatedAtLabel: '2026-04-02 09:30Z',
            hasDraft: true,
            isActive: true,
            revisions: [
              {
                id: 'revision-abc',
                versionNumber: 3,
                shortId: 'revision-abc',
                checkpointedAtLabel: '2026-04-02 09:00Z',
                summaryLines: ['Added 1 entity'],
                previewText: 'version: 0.1.0',
                isLatest: true,
              },
            ],
          },
          {
            id: 'diagram-2',
            name: 'Orders',
            updatedAtLabel: '2026-04-02 10:30Z',
            hasDraft: false,
            isActive: false,
            revisions: [],
          },
        ]}
        onOpenStream={vi.fn()}
        onRestoreRevision={vi.fn()}
        onStartNew={vi.fn()}
        onImportDiagram={vi.fn()}
        onExportDiagram={vi.fn()}
        exampleDiagrams={[
          {
            namespace: 'tarskia',
            slug: 'commerce-platform',
            title: 'Commerce Platform',
          },
        ]}
        onLoadExampleDiagram={vi.fn()}
      />,
    );

    expect(html).toContain('Diagrams');
    expect(html).toContain('Import');
    expect(html).toContain('Download');
    expect(html).toContain('+ New');
    expect(html).toContain('Revisions');
    expect(html).toContain('v3');
    expect(html).toContain('Examples');
    expect(html).toContain('Commerce Platform');
    expect(html).toContain('Open');
  });

  it('renders an explicit open action for a selected inactive diagram', () => {
    const html = renderToStaticMarkup(
      <DiagramBrowser
        streams={[
          {
            id: 'diagram-1',
            name: 'Payments',
            updatedAtLabel: '2026-04-02 09:30Z',
            hasDraft: false,
            isActive: false,
            revisions: [],
          },
        ]}
        onOpenStream={vi.fn()}
      />,
    );

    expect(html).toContain('Open selected');
  });
});
