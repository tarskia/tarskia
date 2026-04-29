import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SchemaBrowser } from './SchemaBrowser';

describe('SchemaBrowser', () => {
  it('renders one schemas heading and a new action in the sidebar pane', () => {
    const html = renderToStaticMarkup(
      <SchemaBrowser
        streams={[
          {
            schemaRef: 'user/payments',
            name: 'Payments',
            updatedAtLabel: '4 Apr, 09:30',
            latestVersion: '1.0',
            hasDraft: true,
            draftBaseVersion: '1.0',
            draftUpdatedAtLabel: '4 Apr, 09:31',
            isEditing: false,
            inUse: false,
            deleteDisabled: false,
            versions: [
              {
                key: 'version-1',
                version: '1.0',
                publishedAtLabel: '4 Apr, 09:00',
                summaryLines: ['Initial version'],
                previewText: 'types: []',
                isLatest: true,
                isAppliedToDiagram: false,
              },
            ],
          },
        ]}
        notice={undefined}
        onEditStream={vi.fn()}
        onDeleteStream={vi.fn()}
        onUndoDelete={vi.fn()}
        onStartNew={vi.fn()}
      />,
    );

    expect(html).toContain('Schemas');
    expect(html.match(/Schemas/g)).toHaveLength(1);
    expect(html).toContain('+ New');
    expect(html).toContain('Payments');
  });
});
