import { describe, expect, it } from 'vitest';
import {
  GALLERY_DESCRIPTION_MAX_LENGTH,
  normalizeGalleryDescriptionText,
} from './gallery-metadata';

describe('gallery metadata', () => {
  it('normalizes gallery descriptions to the table-sized limit', () => {
    const description = normalizeGalleryDescriptionText(
      'Durable execution platform for resilient workflow orchestration across services and background workers.',
    );

    expect(description).toBe(
      'Durable execution platform for resilient workflow orchestration across...',
    );
    expect(description?.length).toBeLessThanOrEqual(GALLERY_DESCRIPTION_MAX_LENGTH);
  });
});
