import { toBlob } from 'html-to-image';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { canCopyDiagramViewToClipboard, copyDiagramViewToClipboard } from './copy-diagram-view';

vi.mock('html-to-image', () => ({
  toBlob: vi.fn(),
}));

class MockHTMLElement {
  readonly classList: { contains: (className: string) => boolean };

  constructor(classes: string[] = []) {
    this.classList = {
      contains: (className: string) => classes.includes(className),
    };
  }
}

class MockClipboardItem {
  constructor(readonly items: Record<string, Blob>) {}
}

const mockedToBlob = vi.mocked(toBlob);

function enableClipboardSupport(write = vi.fn().mockResolvedValue(undefined)) {
  vi.stubGlobal('window', { devicePixelRatio: 3 });
  vi.stubGlobal('HTMLElement', MockHTMLElement);
  vi.stubGlobal('ClipboardItem', MockClipboardItem);
  vi.stubGlobal('navigator', { clipboard: { write } });
  return write;
}

describe('copyDiagramViewToClipboard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports support only when clipboard image APIs are available', () => {
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn() } });
    expect(canCopyDiagramViewToClipboard()).toBe(false);

    vi.stubGlobal('ClipboardItem', MockClipboardItem);
    expect(canCopyDiagramViewToClipboard()).toBe(true);
  });

  it('renders the visible canvas to PNG and writes it to the clipboard', async () => {
    const write = enableClipboardSupport();
    const blob = new Blob(['png'], { type: 'image/png' });
    mockedToBlob.mockResolvedValue(blob);
    const element = new MockHTMLElement(['canvas']) as unknown as HTMLElement;

    await copyDiagramViewToClipboard(element);

    expect(mockedToBlob).toHaveBeenCalledTimes(1);
    const [capturedElement, options] = mockedToBlob.mock.calls[0] ?? [];
    expect(capturedElement).toBe(element);
    expect(options).toEqual(
      expect.objectContaining({
        backgroundColor: '#0c0f14',
        cacheBust: true,
        pixelRatio: 2,
        skipFonts: true,
      }),
    );
    expect(options?.filter?.(new MockHTMLElement(['debug-panel']) as unknown as HTMLElement)).toBe(
      false,
    );
    expect(
      options?.filter?.(new MockHTMLElement(['react-flow__controls']) as unknown as HTMLElement),
    ).toBe(false);
    expect(
      options?.filter?.(new MockHTMLElement(['react-flow__minimap']) as unknown as HTMLElement),
    ).toBe(false);
    expect(options?.filter?.(new MockHTMLElement(['canvas']) as unknown as HTMLElement)).toBe(true);

    expect(write).toHaveBeenCalledTimes(1);
    const clipboardItems = write.mock.calls[0]?.[0] as MockClipboardItem[];
    expect(clipboardItems).toHaveLength(1);
    expect(clipboardItems[0]).toBeInstanceOf(MockClipboardItem);
    expect(clipboardItems[0]?.items['image/png']).toBe(blob);
  });

  it('fails cleanly when clipboard image copy is unavailable', async () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('HTMLElement', MockHTMLElement);
    vi.stubGlobal('navigator', {});

    await expect(
      copyDiagramViewToClipboard(new MockHTMLElement(['canvas']) as unknown as HTMLElement),
    ).rejects.toThrow('Clipboard image copy is not available in this browser.');
  });

  it('fails when the current view cannot be rendered to an image blob', async () => {
    enableClipboardSupport();
    mockedToBlob.mockResolvedValue(null);

    await expect(
      copyDiagramViewToClipboard(new MockHTMLElement(['canvas']) as unknown as HTMLElement),
    ).rejects.toThrow('Failed to render the current diagram view.');
  });
});
