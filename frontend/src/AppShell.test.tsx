import { isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createMemoryRouter,
  Navigate,
  Outlet,
  type RouteObject,
  RouterProvider,
} from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./gallery/PublicGalleryIndex', () => ({
  default: () => <div>gallery-index</div>,
}));

vi.mock('./gallery/PublicGalleryViewer', () => ({
  default: () => <div>gallery-viewer</div>,
}));

vi.mock('./PublicGalleryShell', () => ({
  default: () => (
    <div>
      gallery-shell
      <Outlet />
    </div>
  ),
}));

import { appRoutes } from './AppShell';

const renderAt = (path: string, routes: RouteObject[] = appRoutes) =>
  renderToStaticMarkup(
    <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />,
  );

describe('AppShell routes', () => {
  it('defines local opening inside the gallery shell before the hosted viewer route', () => {
    const gallery = appRoutes.find((route) => route.path === '/gallery');
    expect(gallery?.children?.map((route) => route.path)).toEqual([
      undefined,
      'open',
      ':namespace/:slug',
    ]);
  });
  it('redirects / to /gallery', () => {
    const rootRoute = appRoutes.find((route) => route.path === '/');
    if (!isValidElement(rootRoute?.element)) {
      throw new Error('Expected root route to render a redirect element');
    }
    const props = rootRoute.element.props as { to: string; replace?: boolean };

    expect(rootRoute.element.type).toBe(Navigate);
    expect(props.to).toBe('/gallery');
    expect(props.replace).toBe(true);
  });

  it('renders the gallery index at /gallery', () => {
    const html = renderAt('/gallery');

    expect(html).toContain('gallery-index');
    expect(html).not.toContain('gallery-viewer');
  });

  it('renders the public viewer at /gallery/:namespace/:slug', () => {
    const html = renderAt('/gallery/acme/payments');

    expect(html).toContain('gallery-viewer');
    expect(html).not.toContain('gallery-index');
  });

  it('redirects unknown routes to the gallery', () => {
    const wildcardRoute = appRoutes.find((route) => route.path === '*');
    if (!isValidElement(wildcardRoute?.element)) {
      throw new Error('Expected wildcard route to render a redirect element');
    }
    const props = wildcardRoute.element.props as { to: string; replace?: boolean };

    expect(wildcardRoute.element.type).toBe(Navigate);
    expect(props.to).toBe('/gallery');
    expect(props.replace).toBe(true);
  });
});
