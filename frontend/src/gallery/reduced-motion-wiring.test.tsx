// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../api/generated/gallery/gallery', () => ({
  useGetGalleryDiagram: () => ({
    data: {
      status: 200,
      data: { raw: 'version: 0.1.0\nschemaRefs: []\nentities: []\nrelations: []' },
    },
  }),
}));
vi.mock('../diagram/useDiagramEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../diagram/useDiagramEngine')>();
  return { ...actual, useDiagramEngine: vi.fn(actual.useDiagramEngine) };
});

import { useDiagramEngine } from '../diagram/useDiagramEngine';
import PublicGalleryViewer from './PublicGalleryViewer';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('wires reduced motion into the engine and follows changes while mounted', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const listeners = new Set<() => void>();
  const media = {
    matches: false,
    addEventListener: vi.fn((_type, listener) => listeners.add(listener)),
    removeEventListener: vi.fn((_type, listener) => listeners.delete(listener)),
  };
  const matchMedia = vi.fn(() => media);
  vi.stubGlobal('matchMedia', matchMedia);
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={['/gallery/tarskia/n8n']}>
          <Routes>
            <Route element={<Outlet context={{ setViewerSearchChrome: vi.fn() }} />}>
              <Route path="/gallery/:namespace/:slug" element={<PublicGalleryViewer />} />
            </Route>
          </Routes>
        </MemoryRouter>,
      ),
    );
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(vi.mocked(useDiagramEngine).mock.lastCall?.[0].skipTransitions).toBe(false);
    await act(async () => {
      media.matches = true;
      for (const listener of listeners) listener();
    });
    expect(vi.mocked(useDiagramEngine).mock.lastCall?.[0].skipTransitions).toBe(true);
    await act(async () => {
      media.matches = false;
      for (const listener of listeners) listener();
    });
    expect(vi.mocked(useDiagramEngine).mock.lastCall?.[0].skipTransitions).toBe(false);
  } finally {
    await act(async () => root.unmount());
  }
  expect(listeners.size).toBe(0);
});
