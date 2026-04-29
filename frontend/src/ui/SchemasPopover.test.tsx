import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadSchemasPopover() {
  vi.resetModules();
  vi.doMock('../components/ui/popover', () => ({
    Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
    PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    PopoverContent: ({ children, className }: { children: ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
  }));
  return (await import('./SchemasPopover')).SchemasPopover;
}

describe('SchemasPopover', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../components/ui/popover');
  });

  it('renders a filled trigger so the control stays visible against the toolbar', async () => {
    const SchemasPopover = await loadSchemasPopover();
    const html = renderToStaticMarkup(
      <SchemasPopover availableSchemas={[]} onToggleSchema={vi.fn()} />,
    );

    expect(html).toContain('Schemas');
    expect(html).toContain('bg-surface');
    expect(html).toContain('text-foreground');
    expect(html).toContain('border-foreground/12');
    expect(html).toContain('focus-visible:ring-ring/80');
  });

  it('keeps only the in-use status badge and exposes block reasons via tooltip text', async () => {
    const SchemasPopover = await loadSchemasPopover();
    const html = renderToStaticMarkup(
      <SchemasPopover
        availableSchemas={[
          {
            id: 'core:web-app',
            label: 'Web App',
            ownerLabel: 'core',
            version: '0.3',
            selected: true,
            inUseReason: 'This schema is used by entities in the diagram.',
            blockedReason: 'This schema selection would invalidate the current diagram.',
            statusTitle:
              'This schema is used by entities in the diagram.\n\nThis schema selection would invalidate the current diagram.',
          },
        ]}
        onToggleSchema={vi.fn()}
      />,
    );

    expect(html).toContain('min-w-[360px]');
    expect(html).toContain('in use');
    expect(html).not.toContain('breaks diagram');
    expect(html).toContain('This schema selection would invalidate the current diagram.');
    expect(html).toContain('whitespace-nowrap');
  });
});
