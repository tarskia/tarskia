// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AppShell from '../AppShell';
import diagramRaw from './fixtures/local-example.yaml?raw';
import schemaRaw from './fixtures/local-example-schema.yaml?raw';
import type { LocalDiagram } from './local-diagram';

vi.mock('../PublicGalleryShell', () => ({
  default: function Shell() {
    const [localDiagram, setLocalDiagram] = useState<LocalDiagram>();
    return (
      <>
        <span>{useLocation().pathname}</span>
        <Outlet context={{ localDiagram, setLocalDiagram }} />
      </>
    );
  },
}));
vi.mock('./PublicGalleryViewer', () => ({
  default: () => null,
  GalleryDiagramViewer: ({ raw }: { raw: string }) => <pre>{raw}</pre>,
}));
vi.mock('./PublicGalleryIndex', () => ({ default: () => <div>Gallery index</div> }));

let root: Root;
let host: HTMLDivElement;
const served = () => ({
  name: 'workspace',
  kind: 'folder',
  files: ['one', 'two'].flatMap((name) => [
    { path: `${name}/.tarskia/${name}.yaml`, raw: diagramRaw.replace('Local example', name) },
    { path: `${name}/.tarskia/${name}.schema.yaml`, raw: schemaRaw },
  ]),
});
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.head.innerHTML = '<meta name="tarskia-open" content="true">';
  host = document.createElement('div');
  root = createRoot(host);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(served()))),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.head.innerHTML = '';
  vi.unstubAllGlobals();
});
async function mount(route: string) {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <AppShell />
      </MemoryRouter>,
    ),
  );
}
it('opens a served folder from home without visiting the gallery', async () => {
  await mount('/');
  expect(host.textContent).toContain('/gallery/open');
  expect(host.textContent).toContain('one');
  expect(host.textContent).toContain('two');
  expect(host.textContent).not.toContain('Gallery index');
  expect(fetch).toHaveBeenCalledWith(
    '/__tarskia/open',
    expect.objectContaining({ cache: 'no-store' }),
  );
});
it('fetches again when the open route is reloaded', async () => {
  await mount('/gallery/open');
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount('/gallery/open');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain('one');
});
it.each([
  '/',
  '/gallery/open',
])('does not fetch startup data without the flag at %s', async (route) => {
  document.head.innerHTML = '';
  await mount(route);
  expect(fetch).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Gallery index');
});
it('shows an endpoint error without redirecting to the gallery', async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ error: 'File was removed.' }), { status: 500 }),
  );
  await mount('/');
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('File was removed.');
});
