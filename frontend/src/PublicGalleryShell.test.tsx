import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, Outlet, type RouteObject, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./api/generated/gallery/gallery', () => ({
  useGetGalleryDiagram: vi.fn(),
  useListGalleryDiagrams: vi.fn(),
}));

import { useGetGalleryDiagram, useListGalleryDiagrams } from './api/generated/gallery/gallery';
import PublicGalleryShell from './PublicGalleryShell';

const mockedUseGetGalleryDiagram = vi.mocked(useGetGalleryDiagram);
const mockedUseListGalleryDiagrams = vi.mocked(useListGalleryDiagrams);

const renderAt = (path: string) => {
  const routes: RouteObject[] = [
    {
      path: '/gallery',
      element: <PublicGalleryShell />,
      children: [
        {
          path: ':namespace/:slug',
          element: <div>gallery-viewer</div>,
        },
        {
          index: true,
          element: <Outlet />,
        },
      ],
    },
  ];

  return renderToStaticMarkup(
    <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />,
  );
};

describe('PublicGalleryShell', () => {
  it('shows repository identity and viewer metadata in the top bar', () => {
    mockedUseGetGalleryDiagram.mockReturnValue({
      data: {
        status: 200,
        data: {
          namespace: 'tarskia',
          slug: 'outline',
          title: 'Outline',
          raw: 'metadata:\n  name: Outline\n',
          checkpointedAt: '2026-04-23T12:00:00Z',
          visibility: 'listed',
        },
      },
    } as never);
    mockedUseListGalleryDiagrams.mockReturnValue({
      data: {
        status: 200,
        data: [
          {
            namespace: 'tarskia',
            slug: 'outline',
            sourceRepository: {
              url: 'https://github.com/outline/outline',
              commit: 'eefa8d422289a378c0e4cc4bb730ece7372b40b3',
            },
            workerBuild: {
              model: 'gpt-5.4-mini',
              nodes: 23,
              approxTotalTokens: 21282403,
            },
          },
        ],
      },
    } as never);

    const html = renderAt('/gallery/tarskia/outline');

    expect(html).toContain('outline/outline');
    expect(html).not.toContain('>Gallery<');
    expect(html).toContain('src="/tarskia-icon.svg"');
    expect(html).toContain('aria-label="Open repository in a new tab"');
    expect(html).toContain('lucide-external-link');
    expect(html).toContain('eefa8d4');
    expect(html).toContain('23 nodes');
    expect(html).toContain('21M tokens');
    expect(html).toContain('gpt-5.4-mini');
    expect(html).toContain('href="https://github.com/outline/outline"');
    expect(html).toContain('aria-label="Open gallery feedback menu"');
    expect(html).toContain('aria-label="Toggle theme"');
  });

  it('keeps the viewer mounted inside a fixed-height shell when the gallery list is not an array', () => {
    mockedUseGetGalleryDiagram.mockReturnValue({
      data: {
        status: 200,
        data: {
          namespace: 'tarskia',
          slug: 'outline',
          title: 'Outline',
          raw: 'metadata:\n  name: Outline\n',
        },
      },
    } as never);
    mockedUseListGalleryDiagrams.mockReturnValue({
      data: {
        status: 200,
        data: { diagrams: [] },
      },
    } as never);

    const html = renderAt('/gallery/tarskia/outline');

    expect(html).toContain('gallery-viewer');
    expect(html).toContain('h-screen');
    expect(html).toContain('overflow-hidden');
  });

  it('uses raw detail repository metadata while repository summary metadata is unavailable', () => {
    mockedUseGetGalleryDiagram.mockReturnValue({
      data: {
        status: 200,
        data: {
          namespace: 'tarskia',
          slug: 'outline',
          title: 'Outline',
          raw:
            'metadata:\n' +
            '  name: Outline\n' +
            '  sourceRepository:\n' +
            '    url: https://github.com/outline/outline\n',
        },
      },
    } as never);
    mockedUseListGalleryDiagrams.mockReturnValue({
      data: {
        status: 200,
        data: [],
      },
    } as never);

    const html = renderAt('/gallery/tarskia/outline');

    expect(html).toContain('outline/outline');
    expect(html).not.toContain('>Outline<');
  });
});
