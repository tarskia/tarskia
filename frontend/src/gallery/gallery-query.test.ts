import { describe, expect, it, vi } from 'vitest';

vi.mock('../api/generated/gallery/gallery', () => ({
  getGalleryDiagram: vi.fn(),
  listGalleryDiagrams: vi.fn(),
}));

import { getGalleryDiagram, listGalleryDiagrams } from '../api/generated/gallery/gallery';
import {
  GalleryQueryError,
  getGalleryDiagramWithRetryableFailures,
  listGalleryDiagramsWithRetryableFailures,
  retryGalleryQuery,
} from './gallery-query';

const mockedGetGalleryDiagram = vi.mocked(getGalleryDiagram);
const mockedListGalleryDiagrams = vi.mocked(listGalleryDiagrams);

describe('gallery query helpers', () => {
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
});
