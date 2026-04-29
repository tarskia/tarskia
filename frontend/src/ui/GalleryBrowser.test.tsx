import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { GalleryBrowser } from './GalleryBrowser';

describe('GalleryBrowser', () => {
  it('renders searchable gallery examples in the sidebar pane', () => {
    const html = renderToStaticMarkup(
      <GalleryBrowser
        exampleDiagrams={[
          {
            namespace: 'tarskia',
            slug: 'commerce-platform',
            title: 'Commerce Platform',
            sourceRepository: {
              url: 'https://github.com/example/commerce-platform',
              commit: '26bc3fb1b8fd577e2d936d5f3bd0434778cb62a9',
              committedAt: '2026-04-21T12:34:56Z',
            },
            workerBuild: {
              model: 'gpt-5.4-mini',
              durationMs: 1752584,
              approxTotalTokens: 254372487,
              turns: 22,
            },
          },
        ]}
        onLoadExampleDiagram={vi.fn()}
      />,
    );

    expect(html).toContain('Diagram Gallery');
    expect(html).toContain('Search gallery');
    expect(html).toContain('Commerce Platform');
    expect(html).toContain('tarskia');
    expect(html).toContain('github.com/example/commerce-platform');
    expect(html).toContain('Updated 21 Apr 2026');
    expect(html).toContain('26bc3fb');
    expect(html).toContain('gpt-5.4-mini');
    expect(html).toContain('29m 13s');
    expect(html).toContain('254M tok');
    expect(html).toContain('22 turns');
    expect(html).toContain('Open');
    expect(html).toContain('editable copy');
  });
});
