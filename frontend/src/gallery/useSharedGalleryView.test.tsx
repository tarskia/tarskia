// @vitest-environment happy-dom
import {
  buildSemanticIndex,
  type DiagramView,
  type SavedDiagramView,
} from '@tarskia/diagram-semantics';
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { decodeSharedView } from './shared-view-link';
import { useSharedGalleryView } from './useSharedGalleryView';

vi.mock('./shared-view-link', () => ({ decodeSharedView: vi.fn() }));
const index = buildSemanticIndex(
  { version: '1', schemaRefs: [], entities: [{ id: 'a', type: 'node' }], relations: [] },
  { owner: 'core', name: 'test', version: '1', types: [{ id: 'node' }], relations: [] },
);
const defaultView: DiagramView = {
  kind: 'semantic-diagram-view',
  version: 3,
  camera: { rect: { x: 0, y: 0, width: 100, height: 200 } },
};
const saved = (missing = false): SavedDiagramView => ({
  kind: 'semantic-diagram-saved-view',
  version: 1,
  diagram: { namespace: 'tarskia', slug: 'n8n' },
  revision: '000000000000',
  view: { ...defaultView, nodesById: { [missing ? 'gone' : 'a']: { expanded: true } } },
});
let result: ReturnType<typeof useSharedGalleryView>;
function Harness({ encoded }: { encoded: string | null }) {
  result = useSharedGalleryView({
    index,
    defaultView,
    encoded,
    namespace: 'tarskia',
    slug: 'n8n',
    enabled: true,
  });
  return (
    <div>
      {result.ready ? 'ready' : 'loading'}
      {result.notice ? 'notice' : ''}
    </div>
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('waits for decode, ignores cancelled results and applies only the current link', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  let resolveOld!: (value: SavedDiagramView) => void;
  let resolveNew!: (value: SavedDiagramView) => void;
  vi.mocked(decodeSharedView)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNew = resolve;
        }),
    );
  await act(async () => root.render(<Harness encoded="old" />));
  expect(host.textContent).toBe('loading');
  await act(async () => root.render(<Harness encoded="new" />));
  await act(async () => resolveOld(saved(true)));
  expect(host.textContent).toBe('loading');
  await act(async () => resolveNew(saved()));
  expect(host.textContent).toBe('ready');
  expect(result.view?.nodesById).toEqual({ a: { expanded: true } });
  expect(result.savedCamera).toEqual(defaultView.camera);
  await act(async () => root.unmount());
});
it.each([
  'malformed',
  'truncated',
  'oversized',
])('falls back to default with exactly one warning in StrictMode: %s', async (encoded) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(decodeSharedView).mockRejectedValue(new Error('bad'));
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const root = createRoot(document.createElement('div'));
  await act(async () =>
    root.render(
      <StrictMode>
        <Harness encoded={encoded} />
      </StrictMode>,
    ),
  );
  expect(result.ready).toBe(true);
  expect(result.view).toBe(defaultView);
  expect(result.notice).toBe(false);
  expect(warning).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});
it('notices only dropped IDs, expires after 8 seconds, and can be dismissed', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.mocked(decodeSharedView).mockResolvedValue(saved());
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Harness encoded="mismatch-only" />));
  expect(result.notice).toBe(false);
  vi.mocked(decodeSharedView).mockResolvedValue(saved(true));
  await act(async () => root.render(<Harness encoded="dropped" />));
  expect(result.notice).toBe(true);
  await act(async () => vi.advanceTimersByTime(7999));
  expect(result.notice).toBe(true);
  await act(async () => vi.advanceTimersByTime(1));
  expect(result.notice).toBe(false);
  await act(async () => root.render(<Harness encoded="dropped-again" />));
  expect(result.notice).toBe(true);
  await act(async () => result.dismissNotice());
  expect(result.notice).toBe(false);
  await act(async () => root.unmount());
});

it('does not warn or commit when a failed decode completes after unmount', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let reject!: (error: Error) => void;
  vi.mocked(decodeSharedView).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Harness encoded="pending" />));
  expect(result.ready).toBe(false);
  await act(async () => root.unmount());
  await act(async () => reject(new Error('late failure')));
  expect(warning).not.toHaveBeenCalled();
});
