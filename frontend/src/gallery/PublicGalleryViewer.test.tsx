// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../api/generated/gallery/gallery', () => ({
  useGetGalleryDiagram: vi.fn(),
}));

import { useGetGalleryDiagram } from '../api/generated/gallery/gallery';
import { GalleryQueryError } from './gallery-query';

import PublicGalleryViewer, { shouldDelayGalleryCanvasMount } from './PublicGalleryViewer';

describe('PublicGalleryViewer', () => {
  it.each([
    { raw: 'entities: [ { id: a, type: x\n  oops: : :' },
    { raw: '' },
    undefined,
  ])('shows the unreadable fallback without canvas controls for %s', (detail) => {
    vi.mocked(useGetGalleryDiagram).mockReturnValue({
      isPending: false,
      isFetching: false,
      isError: false,
      data: detail ? { status: 200, data: detail } : undefined,
    } as never);
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/gallery/tarskia/n8n']}>
        <Routes>
          <Route element={<Outlet context={{ setViewerSearchChrome: vi.fn() }} />}>
            <Route path="/gallery/:namespace/:slug" element={<PublicGalleryViewer />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(html).toContain('This diagram couldn&#x27;t be loaded.');
    expect(html).toContain('href="/gallery"');
    expect(html).toContain('Back to gallery');
    expect(html).not.toContain('Expand all');
    expect(html).not.toContain('react-flow');
  });

  it.each([
    new GalleryQueryError('Service unavailable', 503),
    new TypeError('Failed to fetch'),
  ])('shows a retryable error for a rejected query: %s', (error) => {
    vi.mocked(useGetGalleryDiagram).mockReturnValue({
      isPending: false,
      isFetching: false,
      isError: true,
      error,
      data: undefined,
      refetch: vi.fn(),
    } as never);
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/gallery/tarskia/n8n']}>
        <Routes>
          <Route element={<Outlet context={{ setViewerSearchChrome: vi.fn() }} />}>
            <Route path="/gallery/:namespace/:slug" element={<PublicGalleryViewer />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(html).toContain('Couldn&#x27;t load this diagram.');
    expect(html).toMatch(/<button[^>]*>Retry<\/button>/);
    expect(html).toContain('href="/gallery"');
    expect(html).toContain('Back to gallery');
    expect(html).not.toContain(error.message);
  });

  it('keeps the canvas loader active until the parsed gallery document is committed', () => {
    expect(
      shouldDelayGalleryCanvasMount({
        viewerDocumentReady: false,
        hasSceneContent: false,
        isLiveCanvasVisible: true,
      }),
    ).toBe(true);
  });

  it('keeps delaying contentful diagrams until the opening viewport is available', () => {
    expect(
      shouldDelayGalleryCanvasMount({
        viewerDocumentReady: true,
        hasSceneContent: true,
        isLiveCanvasVisible: false,
      }),
    ).toBe(true);
    expect(
      shouldDelayGalleryCanvasMount({
        viewerDocumentReady: true,
        hasSceneContent: true,
        defaultViewport: { x: 120, y: 80, zoom: 0.9 },
        isLiveCanvasVisible: false,
      }),
    ).toBe(false);
  });

  it('keeps an already visible committed canvas mounted while measurements settle', () => {
    expect(
      shouldDelayGalleryCanvasMount({
        viewerDocumentReady: true,
        hasSceneContent: true,
        isLiveCanvasVisible: true,
      }),
    ).toBe(false);
  });
});

it('registers Share for the hosted viewer after the canvas is ready', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    width: 1000,
    height: 700,
    top: 0,
    left: 0,
    right: 1000,
    bottom: 700,
    toJSON: () => ({}),
  });
  vi.mocked(useGetGalleryDiagram).mockReturnValue({
    data: {
      status: 200,
      data: { raw: 'version: 0.1.0\nschemaRefs: []\nentities: []\nrelations: []', title: 'Hosted' },
    },
  } as never);
  const setViewerShareAction = vi.fn();
  const setViewerSearchChrome = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={['/gallery/tarskia/example']}>
          <Routes>
            <Route element={<Outlet context={{ setViewerShareAction, setViewerSearchChrome }} />}>
              <Route path="/gallery/:namespace/:slug" element={<PublicGalleryViewer />} />
            </Route>
          </Routes>
        </MemoryRouter>,
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(setViewerShareAction.mock.calls.some(([action]) => typeof action === 'function')).toBe(
      true,
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    rect.mockRestore();
    vi.unstubAllGlobals();
  }
});
