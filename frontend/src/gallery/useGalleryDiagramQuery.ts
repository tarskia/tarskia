import { useGetGalleryDiagram } from '../api/generated/gallery/gallery';
import {
  GALLERY_QUERY_STALE_TIME_MS,
  galleryRetryDelay,
  getGalleryDiagramWithLocalFallback,
  retryGalleryQuery,
} from './gallery-query';

export const useGalleryDiagramQuery = (namespace: string, slug: string) =>
  useGetGalleryDiagram(namespace, slug, {
    query: {
      enabled: Boolean(namespace && slug),
      staleTime: GALLERY_QUERY_STALE_TIME_MS,
      retry: retryGalleryQuery,
      retryDelay: galleryRetryDelay,
      queryFn: ({ signal }) => getGalleryDiagramWithLocalFallback(namespace, slug, { signal }),
    },
  });
