import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, Outlet, type RouteObject, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('js-yaml', async (importOriginal) => {
  const actual = await importOriginal<typeof import('js-yaml')>();
  return { ...actual, load: vi.fn(actual.load) };
});

vi.mock('./api/generated/gallery/gallery', () => ({
  useGetGalleryDiagram: vi.fn(),
  useListGalleryDiagrams: vi.fn(),
}));

import { useGetGalleryDiagram, useListGalleryDiagrams } from './api/generated/gallery/gallery';
import PublicGalleryViewer from './gallery/PublicGalleryViewer';
import {
  describePublicGalleryRepository,
  formatPublicGalleryCommit,
} from './gallery/public-gallery-repository';
import PublicGalleryShell from './PublicGalleryShell';

const mockedUseGetGalleryDiagram = vi.mocked(useGetGalleryDiagram);
const mockedUseListGalleryDiagrams = vi.mocked(useListGalleryDiagrams);

const renderAt = (path: string, withViewer = false) => {
  const routes: RouteObject[] = [
    {
      path: '/gallery',
      element: <PublicGalleryShell />,
      children: [
        {
          path: ':namespace/:slug',
          element: withViewer ? <PublicGalleryViewer /> : <div>gallery-viewer</div>,
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

const curatedEntries = JSON.parse(
  readFileSync(new URL('../../gallery/curated/manifest.json', import.meta.url), 'utf8'),
) as { namespace: string; slug: string; file: string }[];

describe('PublicGalleryShell', () => {
  it.each(curatedEntries)('retains repository identity and commit for $file', (entry) => {
    const raw = readFileSync(
      new URL(`../../gallery/curated/${entry.file}`, import.meta.url),
      'utf8',
    );
    const document = load(raw) as {
      metadata: { sourceRepository: { url?: string; repo?: string; commit?: string } };
    };
    const sourceRepository = document.metadata.sourceRepository;
    mockedUseGetGalleryDiagram.mockReturnValue({ data: { status: 200, data: { raw } } } as never);
    mockedUseListGalleryDiagrams.mockReturnValue({
      isPending: false,
      data: { status: 200, data: [{ ...entry, sourceRepository }] },
    } as never);
    const html = renderAt(`/gallery/${entry.namespace}/${entry.slug}`);
    expect(html).toContain(describePublicGalleryRepository({ ...entry, sourceRepository }).label);
    const commit = formatPublicGalleryCommit(sourceRepository?.commit);
    if (commit) expect(html).toContain(commit);
  });

  it('parses the raw diagram only once when the summary supplies repository metadata', () => {
    const raw = readFileSync(new URL('../../gallery/curated/n8n.yaml', import.meta.url), 'utf8');
    mockedUseGetGalleryDiagram.mockReturnValue({
      data: { status: 200, data: { namespace: 'tarskia', slug: 'n8n', raw } },
    } as never);
    mockedUseListGalleryDiagrams.mockReturnValue({
      isPending: false,
      data: {
        status: 200,
        data: [
          {
            namespace: 'tarskia',
            slug: 'n8n',
            sourceRepository: { url: 'https://github.com/n8n-io/n8n', commit: 'abcdef123456' },
          },
        ],
      },
    } as never);
    vi.mocked(load).mockClear();
    const html = renderAt('/gallery/tarskia/n8n', true);
    expect(vi.mocked(load).mock.calls.filter(([text]) => text === raw)).toHaveLength(1);
    expect(html).toContain('n8n-io/n8n');
    expect(html).toContain('abcdef1');
  });

  it('waits for the gallery list to settle before parsing raw repository metadata', () => {
    const raw = 'metadata:\n  sourceRepository:\n    url: https://github.com/outline/outline\n';
    mockedUseGetGalleryDiagram.mockReturnValue({ data: { status: 200, data: { raw } } } as never);
    mockedUseListGalleryDiagrams.mockReturnValue({ isPending: true } as never);
    vi.mocked(load).mockClear();
    renderAt('/gallery/tarskia/outline');
    expect(load).not.toHaveBeenCalled();
    mockedUseListGalleryDiagrams.mockReturnValue({ isPending: false, isError: true } as never);
    expect(renderAt('/gallery/tarskia/outline')).toContain('outline/outline');
    expect(vi.mocked(load).mock.calls.filter(([text]) => text === raw)).toHaveLength(1);
  });

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
