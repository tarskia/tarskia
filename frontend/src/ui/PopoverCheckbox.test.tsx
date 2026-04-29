import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { PopoverCheckbox } from './PopoverCheckbox';

describe('PopoverCheckbox', () => {
  it('renders the shared checkbox primitive in a selected state', () => {
    const html = renderToStaticMarkup(
      <PopoverCheckbox checked={true} onChange={vi.fn()}>
        <span>Payments</span>
      </PopoverCheckbox>,
    );

    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('data-[state=checked]:border-accent');
    expect(html).toContain('data-[state=checked]:bg-accent');
    expect(html).toContain('Payments');
  });

  it('renders a muted disabled state for unavailable options', () => {
    const html = renderToStaticMarkup(
      <PopoverCheckbox checked={false} disabled={true} onChange={vi.fn()}>
        <span>Core schema</span>
      </PopoverCheckbox>,
    );

    expect(html).toContain('cursor-not-allowed');
    expect(html).toContain('border-border bg-muted/70');
    expect(html).toContain('disabled=""');
  });
});
