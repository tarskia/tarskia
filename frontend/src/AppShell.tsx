import { Navigate, type RouteObject, useParams, useRoutes } from 'react-router-dom';

import AboutPage from './AboutPage';
import { DiagramErrorBoundary } from './gallery/DiagramErrorBoundary';
import PublicGalleryIndex from './gallery/PublicGalleryIndex';
import PublicGalleryViewer from './gallery/PublicGalleryViewer';
import PublicGalleryShell from './PublicGalleryShell';

function GalleryDiagramRoute() {
  const { namespace, slug } = useParams();
  return (
    <DiagramErrorBoundary key={`${namespace}/${slug}`}>
      <PublicGalleryViewer />
    </DiagramErrorBoundary>
  );
}

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
        element: <GalleryDiagramRoute />,
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/gallery" replace />,
  },
];

export default function AppShell() {
  return useRoutes(appRoutes);
}
