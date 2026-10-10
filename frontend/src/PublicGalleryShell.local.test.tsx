// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import diagram from './gallery/fixtures/local-example.yaml?raw';
import schema from './gallery/fixtures/local-example-schema.yaml?raw';

vi.mock('./api/generated/gallery/gallery', () => ({
  useGetGalleryDiagram: vi.fn(() => ({ data: undefined })),
  useListGalleryDiagrams: vi.fn(() => ({ isPending: false, data: { status: 200, data: [] } })),
}));
vi.mock('./gallery/PublicGalleryViewer', () => ({
  default: () => <div>hosted viewer</div>,
  GalleryDiagramViewer: ({ title, shareIdentity }: { title: string; shareIdentity?: unknown }) => (
    <div data-local-viewer="true" data-share={Boolean(shareIdentity)}>
      {title}
    </div>
  ),
}));

import { appRoutes } from './AppShell';
import { useListGalleryDiagrams } from './api/generated/gallery/gallery';

let dispose: (() => Promise<void>) | undefined;
afterEach(async () => {
  await dispose?.();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function mount(path = '/gallery') {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  await act(async () => root.render(<RouterProvider router={router} />));
  dispose = async () => {
    await act(async () => root.unmount());
    router.dispose();
    host.remove();
  };
  return { host, router };
}
const file = (name: string, raw: string) => ({ name, size: raw.length, text: async () => raw });
async function choose(host: HTMLElement, files: unknown[]) {
  const input = host.querySelector('input[type=file]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
function drag(type: string, files: unknown[] = []) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], files, dropEffect: '' },
  });
  window.dispatchEvent(event);
  return event;
}
it('opens with picker, displays local metadata/search without Share, and retains memory across history', async () => {
  const { host, router } = await mount();
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Open file')!;
  expect(button.title).toBe(
    'Open a diagram you built, with its schema file if it has one. Nothing is uploaded.',
  );
  expect(host.querySelector('input[type=file]')?.getAttribute('accept')).toBe('.yaml,.yml');
  await choose(host, [file('example.yaml', diagram), file('schema.yaml', schema)]);
  expect(router.state.location.pathname).toBe('/gallery/open');
  expect(host.textContent).toContain('Opened from example.yaml. Nothing was uploaded.');
  expect(host.querySelector('[data-local-viewer]')?.getAttribute('data-share')).toBe('false');
  expect(host.querySelector('input[placeholder="Search diagram"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Copy link to this view"]')).toBeNull();
  expect(vi.mocked(useListGalleryDiagrams).mock.calls.at(-1)?.[0]?.query?.enabled).toBe(false);
  await act(async () => router.navigate(-1));
  expect(host.textContent).toContain('Open file');
  await act(async () => router.navigate(1));
  expect(host.textContent).toContain('Opened from example.yaml. Nothing was uploaded.');
  await act(async () => router.navigate('/gallery/open/'));
  expect(host.textContent).toContain('Opened from example.yaml. Nothing was uploaded.');
  expect(host.querySelector('[aria-label="Copy link to this view"]')).toBeNull();
});
it('redirects a fresh local route to the gallery', async () => {
  const { router, host } = await mount('/gallery/open');
  expect(router.state.location.pathname).toBe('/gallery');
  expect(host.textContent).toContain('Open file');
});
it('shows the file drag overlay, opens a dropped pair and clears errors on the next attempt', async () => {
  const { host, router } = await mount();
  await choose(host, [file('example.yaml', diagram)]);
  expect(host.querySelector('[role=alert]')?.textContent).toContain(
    'This diagram needs the schema repo/example@0.1.',
  );
  await act(async () => {
    drag('dragenter');
  });
  expect(host.textContent).toContain(
    'Drop a diagram file, and its schema file if it has one, to open it here',
  );
  await act(async () => {
    expect(
      drag('drop', [file('example.yaml', diagram), file('schema.yaml', schema)]).defaultPrevented,
    ).toBe(true);
  });
  expect(router.state.location.pathname).toBe('/gallery/open');
  expect(host.querySelector('[role=alert]')).toBeNull();
});
it('ignores an old read after a newer file selection completes', async () => {
  const { host, router } = await mount();
  let finish!: (raw: string) => void;
  const pending = new Promise<string>((resolve) => {
    finish = resolve;
  });
  await choose(host, [{ name: 'old.yaml', size: 1, text: () => pending }]);
  await choose(host, [file('new.yaml', diagram), file('schema.yaml', schema)]);
  await act(async () => finish('unreadable'));
  expect(router.state.location.pathname).toBe('/gallery/open');
  expect(host.textContent).toContain('Opened from new.yaml. Nothing was uploaded.');
});
