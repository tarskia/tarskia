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
