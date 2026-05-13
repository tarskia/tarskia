import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_ANIMATION_SETTINGS,
  DEFAULT_VIEWPORT_FIT_PADDING,
} from '../canvas/rendering/transition/animation-constants';
import { computeViewportForBoundsInVisibleCanvas } from '../canvas/viewport-visibility';
import {
  resolvePendingBootstrapAction,
  useCanvasBootstrapController,
} from './useCanvasBootstrapController';

describe('useCanvasBootstrapController', () => {
  it('keeps initial viewport bootstrap pending while async document content has no scene bounds yet', () => {
    expect(
      resolvePendingBootstrapAction({
        initialViewportKey: 'diagram-1',
        pendingKey: 'diagram-1',
        hasUsableCanvas: true,
        defaultViewport: undefined,
        canvasReady: true,
      }),
    ).toBe('wait');
  });

  it('requests initial navigation only after a usable viewport target and live canvas are available', () => {
    const defaultViewport = { x: 120, y: 80, zoom: 0.9 };

    expect(
      resolvePendingBootstrapAction({
        initialViewportKey: 'diagram-1',
        pendingKey: 'diagram-1',
        hasUsableCanvas: true,
        defaultViewport,
        canvasReady: false,
      }),
    ).toBe('wait');
    expect(
      resolvePendingBootstrapAction({
        initialViewportKey: 'diagram-1',
        pendingKey: 'diagram-1',
        hasUsableCanvas: true,
        defaultViewport,
        canvasReady: true,
      }),
    ).toBe('request-navigation');
    expect(
      resolvePendingBootstrapAction({
        initialViewportKey: 'diagram-1',
        pendingKey: undefined,
        hasUsableCanvas: true,
        defaultViewport,
        canvasReady: true,
      }),
    ).toBe('idle');
  });

  it('resolves the opening viewport from the latest usable canvas measurement', () => {
    let currentCanvasSize: { width: number; height: number } | null = null;
    let captured: ReturnType<typeof useCanvasBootstrapController> | null = null;
    const sceneBounds = { x: 0, y: 0, width: 480, height: 320 };

    function Harness({ canvasLayoutVersion }: { canvasLayoutVersion: number }) {
      captured = useCanvasBootstrapController({
        initialViewportKey: 'diagram-1',
        getCurrentCanvasSize: () => currentCanvasSize,
        canvasLayoutVersion,
        sceneBounds,
        minZoom: 0.1,
        maxZoom: 2,
        animationSettings: DEFAULT_ANIMATION_SETTINGS,
        getLeftOcclusion: () => 0,
        canvasReady: false,
        requestNavigation: vi.fn(),
      });
      return null;
    }

    renderToStaticMarkup(<Harness canvasLayoutVersion={0} />);
    expect(captured?.defaultViewport).toBeUndefined();

    currentCanvasSize = { width: 960, height: 640 };
    renderToStaticMarkup(<Harness canvasLayoutVersion={1} />);

    expect(captured?.defaultViewport).toEqual(
      computeViewportForBoundsInVisibleCanvas({
        bounds: sceneBounds,
        canvas: currentCanvasSize,
        minZoom: 0.1,
        maxZoom: 2,
        padding: DEFAULT_VIEWPORT_FIT_PADDING,
        leftOcclusion: 0,
      }),
    );
  });
});
