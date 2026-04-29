import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/generated/gallery/gallery', () => ({
  getGalleryDiagram: vi.fn(),
  listGalleryDiagrams: vi.fn(),
}));

import { getGalleryDiagram, listGalleryDiagrams } from '../api/generated/gallery/gallery';
import {
  GalleryQueryError,
  getGalleryDiagramWithLocalFallback,
  getGalleryDiagramWithRetryableFailures,
  listGalleryDiagramsWithLocalFallback,
  listGalleryDiagramsWithRetryableFailures,
  retryGalleryQuery,
} from './gallery-query';

const mockedGetGalleryDiagram = vi.mocked(getGalleryDiagram);
const mockedListGalleryDiagrams = vi.mocked(listGalleryDiagrams);

describe('gallery query helpers', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('retries transient transport errors and server-side gallery failures only', () => {
    expect(retryGalleryQuery(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(retryGalleryQuery(0, { name: 'AbortError' })).toBe(true);
    expect(retryGalleryQuery(0, new GalleryQueryError('backend failed', 500))).toBe(true);
    expect(retryGalleryQuery(0, new GalleryQueryError('not found', 404))).toBe(false);
    expect(retryGalleryQuery(0, new Error('invalid diagram'))).toBe(false);
    expect(retryGalleryQuery(2, new TypeError('Failed to fetch'))).toBe(false);
  });

  it('keeps not-found detail responses available to the viewer', async () => {
    mockedGetGalleryDiagram.mockResolvedValue({
      status: 404,
      data: { message: 'missing' },
      headers: new Headers(),
    } as never);

    await expect(
      getGalleryDiagramWithRetryableFailures('tarskia', 'missing'),
    ).resolves.toMatchObject({
      status: 404,
      data: { message: 'missing' },
    });
  });

  it('turns server responses into retryable query errors', async () => {
    mockedListGalleryDiagrams.mockResolvedValue({
      status: 500,
      data: { message: 'temporary outage' },
      headers: new Headers(),
    } as never);

    await expect(listGalleryDiagramsWithRetryableFailures()).rejects.toMatchObject({
      name: 'GalleryQueryError',
      status: 500,
      message: 'temporary outage',
    });
  });

  it('falls back to checked-in gallery data in local dev when the API is unavailable', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    mockedListGalleryDiagrams.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(listGalleryDiagramsWithLocalFallback()).resolves.toMatchObject({
      status: 200,
      data: expect.arrayContaining([
        expect.objectContaining({
          namespace: 'tarskia',
          slug: 'outline',
          title: 'Outline',
        }),
      ]),
    });
  });

  it('can read checked-in gallery detail data after an API miss in local dev', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    mockedGetGalleryDiagram.mockResolvedValue({
      status: 404,
      data: { message: 'missing' },
      headers: new Headers(),
    } as never);

    await expect(getGalleryDiagramWithLocalFallback('tarskia', 'outline')).resolves.toMatchObject({
      status: 200,
      data: {
        namespace: 'tarskia',
        slug: 'outline',
        title: 'Outline',
        raw: expect.stringContaining('name: Outline'),
      },
    });
  });
});
