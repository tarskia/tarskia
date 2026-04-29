import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ActivityBar } from './ActivityBar';

describe('ActivityBar', () => {
  it('renders just the navigation items without a static logo mark', () => {
    const html = renderToStaticMarkup(
      <ActivityBar
        activePanel="palette"
        onTogglePanel={vi.fn()}
        isSidebarVisible={true}
        onToggleSidebarVisibility={vi.fn()}
      />,
    );

    expect(html).toContain('Palette (types)');
    expect(html).toContain('Diagrams');
    expect(html).toContain('Diagram Gallery');
    expect(html).toContain('Schemas');
    expect(html).toContain('Settings');
    expect(html).toContain('aria-label="Palette (types)"');
    expect(html).toContain('aria-label="Diagram Gallery"');
    expect(html).toContain('aria-label="Hide sidebar (\u2318E)"');
    expect(html).not.toContain('title=');
    expect(html).not.toContain('>T</div>');
  });
});
