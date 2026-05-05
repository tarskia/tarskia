import { Navigate, type RouteObject, useRoutes } from 'react-router-dom';

import AboutPage from './AboutPage';
import EditorShell from './EditorShell';
import PublicGalleryIndex from './gallery/PublicGalleryIndex';
import PublicGalleryViewer from './gallery/PublicGalleryViewer';
import PublicGalleryShell from './PublicGalleryShell';

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <Navigate to="/gallery" replace />,
  },
  {
    path: '/about',
    element: <AboutPage />,
  },
  {
    path: '/gallery',
    element: <PublicGalleryShell />,
    children: [
      {
        index: true,
        element: <PublicGalleryIndex />,
      },
      {
        path: ':namespace/:slug',
        element: <PublicGalleryViewer />,
      },
    ],
  },
  {
    path: '/studio/*',
    element: <EditorShell />,
  },
  {
    path: '*',
    element: <Navigate to="/gallery" replace />,
  },
];

export default function AppShell() {
  return useRoutes(appRoutes);
}
