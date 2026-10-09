import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CanvasToolbar } from './CanvasToolbar';

function renderToolbar(overrides: Partial<Parameters<typeof CanvasToolbar>[0]> = {}) {
  return renderToStaticMarkup(
    <CanvasToolbar
      onCenter={vi.fn()}
      onExpandAll={vi.fn()}
      onCollapseAll={vi.fn()}
      {...overrides}
    />,
  );
}

describe('CanvasToolbar', () => {
  it('renders clearer canvas action labels', () => {
    const html = renderToolbar();

    expect(html).toContain('Centre');
    expect(html).toContain('Expand all');
    expect(html).toContain('Collapse all');
    expect(html).toContain('Centre the diagram in the viewport');
    expect(html).toContain('absolute bottom-3');
  });

  it('supports a horizontal center offset so the bar can stay anchored when the inspector opens', () => {
    const html = renderToolbar({ centerOffset: 160 });

    expect(html).toContain('left:calc(50% + 160px)');
  });

  it('does not render a manual inspector toggle', () => {
    const html = renderToolbar();

    expect(html).not.toContain('Show inspector');
    expect(html).not.toContain('Hide inspector');
  });

  it('keeps settings out of the floating toolbar', () => {
    const html = renderToolbar();

    expect(html).not.toContain('View settings');
    expect(html).not.toContain('Canvas display');
  });

  it('shows a focus action when the current selection can be focused', () => {
    const html = renderToolbar({ onFocusView: vi.fn() });

    expect(html).toContain('Focus');
    expect(html).not.toContain('Exit Focus');
  });

  it('shows focus and exit focus together when already scoped', () => {
    const html = renderToolbar({ onFocusView: vi.fn(), onResetFocusView: vi.fn() });

    expect(html).toContain('Focus');
    expect(html).toContain('Exit Focus');
  });
});
