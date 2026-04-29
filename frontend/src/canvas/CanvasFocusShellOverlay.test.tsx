import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CanvasFocusShellOverlay } from './CanvasFocusShellOverlay';

describe('CanvasFocusShellOverlay', () => {
  it('renders shell boundary labels and focus feedback', () => {
    const html = renderToStaticMarkup(
      <CanvasFocusShellOverlay
        shells={[
          {
            id: 'ordersdb',
            depth: 0,
            displayName: 'Orders DB',
            typeLabel: 'Datastore',
            hue: 32,
            isRoot: true,
            frame: { left: 16, top: 16, right: 1584, bottom: 884 },
          },
          {
            id: 'table-group',
            depth: 1,
            displayName: 'Core tables',
            typeLabel: 'Table Group',
            hue: 32,
            frame: { left: 42, top: 40, right: 1558, bottom: 860 },
          },
        ]}
        onSelectShell={vi.fn()}
      />,
    );

    expect(html).toContain('Orders DB: Datastore');
    expect(html).toContain('Core tables: Table Group');
    expect(html).not.toContain('At the edge of this focused view.');
  });

  it('shifts shell boundary labels clear of a left occlusion', () => {
    const html = renderToStaticMarkup(
      <CanvasFocusShellOverlay
        shells={[
          {
            id: 'ordersdb',
            depth: 0,
            displayName: 'Orders DB',
            typeLabel: 'Datastore',
            hue: 32,
            isRoot: true,
            frame: { left: 16, top: 16, right: 1584, bottom: 884 },
          },
        ]}
        leftOcclusion={260}
        onSelectShell={vi.fn()}
      />,
    );

    expect(html).toContain('left:260px');
  });
});
