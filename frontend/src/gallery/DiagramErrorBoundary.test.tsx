// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../api/generated/gallery/gallery', () => ({
  useGetGalleryDiagram: () => ({ data: undefined }),
  useListGalleryDiagrams: () => ({ data: undefined, isPending: true }),
}));
vi.mock('./PublicGalleryViewer', () => ({
  default: () => {
    const { slug } = useParams();
    if (slug === 'broken') throw new Error('Render failure');
    return <div>Working diagram</div>;
  },
}));

import { appRoutes } from '../AppShell';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('contains viewer crashes, keeps the header, reloads, and resets on another diagram', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/gallery/tarskia/broken'] });
  try {
    await act(async () => root.render(<RouterProvider router={router} />));
    expect(host.querySelector('header')).not.toBeNull();
    expect(host.textContent).toContain('Something went wrong displaying this diagram.');
    expect(errorLog).toHaveBeenCalled();
    const back = Array.from(host.querySelectorAll('a')).find(
      (link) => link.textContent === 'Back to gallery',
    );
    expect(back?.getAttribute('href')).toBe('/gallery');
    const reloadButton = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'Reload',
    );
    expect(reloadButton).toBeDefined();
    await act(async () => reloadButton?.click());
    expect(reload).toHaveBeenCalledOnce();
    await act(async () => {
      await router.navigate('/gallery/tarskia/working');
    });
    expect(host.textContent).toContain('Working diagram');
    expect(host.textContent).not.toContain('Something went wrong displaying this diagram.');
    expect(host.querySelector('header')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    router.dispose();
    host.remove();
  }
});
