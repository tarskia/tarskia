import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from './SettingsPanel';

describe('SettingsPanel', () => {
  it('renders canvas display settings in the sidebar pane', () => {
    const html = renderToStaticMarkup(
      <SettingsPanel nodeVisualMode="default" onNodeVisualModeChange={vi.fn()} />,
    );

    expect(html).toContain('Settings');
    expect(html).toContain('Canvas display');
    expect(html).toContain('Default');
    expect(html).toContain('Outline only');
    expect(html).toContain('Blueprint');
    expect(html).toContain(
      'View controls live here so the canvas toolbar can stay focused on navigation.',
    );
  });
});
