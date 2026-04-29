const DIAGRAM_CAPTURE_EXCLUDED_CLASSES = [
  'react-flow__controls',
  'react-flow__attribution',
  'react-flow__minimap',
  'edge-search',
  'edge-menu',
  'debug-panel',
];

export const canCopyDiagramViewToClipboard = () =>
  typeof navigator !== 'undefined' &&
  Boolean(navigator.clipboard?.write) &&
  typeof ClipboardItem !== 'undefined';

const shouldExcludeFromDiagramCapture = (node: HTMLElement) =>
  DIAGRAM_CAPTURE_EXCLUDED_CLASSES.some((className) => node.classList.contains(className));

export async function copyDiagramViewToClipboard(element: HTMLElement) {
  if (!canCopyDiagramViewToClipboard()) {
    throw new Error('Clipboard image copy is not available in this browser.');
  }

  const { toBlob } = await import('html-to-image');
  const blob = await toBlob(element, {
    backgroundColor: '#0c0f14',
    cacheBust: true,
    pixelRatio: Math.min(2, Math.max(1, window.devicePixelRatio || 1)),
    skipFonts: true,
    filter: (node) => !(node instanceof HTMLElement) || !shouldExcludeFromDiagramCapture(node),
  });

  if (!blob) {
    throw new Error('Failed to render the current diagram view.');
  }

  await navigator.clipboard.write([
    new ClipboardItem({
      [blob.type]: blob,
    }),
  ]);
}
