import {
  getGalleryDiagram,
  type getGalleryDiagramResponse,
  listGalleryDiagrams,
  type listGalleryDiagramsResponse,
} from '../api/generated/gallery/gallery';
import {
  getLocalGalleryDiagram,
  listLocalGalleryDiagrams,
  shouldUseLocalGalleryFallback,
  shouldUseLocalGallerySource,
} from './local-gallery';

export const GALLERY_QUERY_STALE_TIME_MS = 30_000;

const MAX_GALLERY_QUERY_RETRIES = 2;

export class GalleryQueryError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'GalleryQueryError';
  }
}

const readErrorMessage = (payload: unknown) => {
  if (typeof payload === 'string' && payload.trim().length > 0) {
    return payload.trim();
  }
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  const message = record.message;
  if (typeof message === 'string' && message.trim().length > 0) {
    return message.trim();
  }
  const error = record.error;
  return typeof error === 'string' && error.trim().length > 0 ? error.trim() : undefined;
};

const isAbortError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === 'object' &&
      'name' in error &&
      (error as { name?: unknown }).name === 'AbortError',
  );

const isTransientFetchError = (error: unknown) => error instanceof TypeError || isAbortError(error);

const assertRetryableGalleryStatus = <TResponse extends { data?: unknown; status: number }>(
  response: TResponse,
): TResponse => {
  if (response.status >= 500) {
    throw new GalleryQueryError(
      readErrorMessage(response.data) ?? 'Failed to load gallery data.',
      response.status,
      response.data,
    );
  }
  return response;
};

export const retryGalleryQuery = (failureCount: number, error: unknown) => {
  if (failureCount >= MAX_GALLERY_QUERY_RETRIES) {
    return false;
  }
  if (error instanceof GalleryQueryError) {
    return typeof error.status === 'number' && error.status >= 500;
  }
  return isTransientFetchError(error);
};

export const galleryRetryDelay = (failureCount: number) => Math.min(250 * 2 ** failureCount, 1_000);

export const listGalleryDiagramsWithRetryableFailures = async (
  options?: RequestInit,
): Promise<listGalleryDiagramsResponse> =>
  assertRetryableGalleryStatus(await listGalleryDiagrams(options));

export const getGalleryDiagramWithRetryableFailures = async (
  namespace: string,
  slug: string,
  options?: RequestInit,
): Promise<getGalleryDiagramResponse> =>
  assertRetryableGalleryStatus(await getGalleryDiagram(namespace, slug, options));

export const listGalleryDiagramsWithLocalFallback = async (
  options?: RequestInit,
): Promise<listGalleryDiagramsResponse> => {
  if (shouldUseLocalGallerySource()) {
    return listLocalGalleryDiagrams();
  }
  try {
    return await listGalleryDiagramsWithRetryableFailures(options);
  } catch (error) {
    if (shouldUseLocalGalleryFallback()) {
      return listLocalGalleryDiagrams();
    }
    throw error;
  }
};

export const getGalleryDiagramWithLocalFallback = async (
  namespace: string,
  slug: string,
  options?: RequestInit,
): Promise<getGalleryDiagramResponse> => {
  if (shouldUseLocalGallerySource()) {
    return getLocalGalleryDiagram(namespace, slug);
  }
  try {
    const response = await getGalleryDiagramWithRetryableFailures(namespace, slug, options);
    if (response.status === 404 && shouldUseLocalGalleryFallback()) {
      return getLocalGalleryDiagram(namespace, slug);
    }
    return response;
  } catch (error) {
    if (shouldUseLocalGalleryFallback()) {
      return getLocalGalleryDiagram(namespace, slug);
    }
    throw error;
  }
};
