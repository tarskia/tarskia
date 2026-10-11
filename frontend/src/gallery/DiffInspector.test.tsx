import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DiffInspector } from './DiffInspector';

describe('diff inspector', () => {
  it('shows named moves and before/after field values', () => {
    const html = renderToStaticMarkup(
      <DiffInspector
        before={{
          version: '1',
          schemaRefs: [],
          relations: [],
          entities: [{ id: 'old', type: 'group', name: 'Old service' }],
        }}
        entry={{
          entityId: 'moved',
          change: 'changed',
          changedFields: ['parent', 'name'],
          before: { id: 'moved', type: 'service', name: 'Before name', parent: 'old' },
          after: { id: 'moved', type: 'service', name: 'After name', parent: 'new' },
        }}
      />,
    );
    expect(html).toContain('Moved from Old service');
    expect(html).toContain('Before name');
    expect(html).toContain('After name');
    expect(html).not.toContain('>parent<');
  });
});
