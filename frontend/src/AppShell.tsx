import { Navigate, type RouteObject, useParams, useRoutes } from 'react-router-dom';
import AboutPage from './AboutPage';
import { DiagramErrorBoundary } from './gallery/DiagramErrorBoundary';
import LocalGalleryViewer from './gallery/LocalGalleryViewer';
import PublicGalleryIndex from './gallery/PublicGalleryIndex';
import PublicGalleryViewer from './gallery/PublicGalleryViewer';
import { hasStartupOpen } from './gallery/startup-open';
import PublicGalleryShell from './PublicGalleryShell';

function GalleryDiagramRoute() {
  const { namespace, slug } = useParams();
  return (
    <DiagramErrorBoundary key={`${namespace}/${slug}`}>
      <PublicGalleryViewer />
    </DiagramErrorBoundary>
  );
}

function HomeRoute() {
  return <Navigate to={hasStartupOpen() ? '/gallery/open' : '/gallery'} replace />;
}

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <HomeRoute />,
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
        path: 'open',
        element: <LocalGalleryViewer />,
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
