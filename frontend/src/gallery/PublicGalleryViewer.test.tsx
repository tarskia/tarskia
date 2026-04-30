import { describe, expect, it } from 'vitest';

import { shouldDelayGalleryCanvasMount } from './PublicGalleryViewer';

describe('PublicGalleryViewer', () => {
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
