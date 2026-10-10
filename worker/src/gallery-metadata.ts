const DEFAULT_MAX_TEXT_LENGTH = 420;
export const GALLERY_DESCRIPTION_MAX_LENGTH = 80;

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function truncateAtSentenceBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const sentenceBoundary = Math.max(
    value.lastIndexOf('.', maxLength),
    value.lastIndexOf('!', maxLength),
    value.lastIndexOf('?', maxLength),
  );
  if (sentenceBoundary >= Math.floor(maxLength * 0.45)) {
    return value.slice(0, sentenceBoundary + 1).trim();
  }
  const contentLimit = Math.max(0, maxLength - 3);
  const wordBoundary = value.lastIndexOf(' ', contentLimit);
  return `${value.slice(0, wordBoundary > 40 ? wordBoundary : contentLimit).trim()}...`;
}

export function normalizeGalleryMetadataText(
  value: unknown,
  maxLength = DEFAULT_MAX_TEXT_LENGTH,
): string | undefined {
  const normalized = trimToUndefined(value);
  if (!normalized || !/[A-Za-z]/.test(normalized)) {
    return undefined;
  }
  return truncateAtSentenceBoundary(normalized, maxLength);
}

export function normalizeGalleryDescriptionText(value: unknown): string | undefined {
  return normalizeGalleryMetadataText(value, GALLERY_DESCRIPTION_MAX_LENGTH);
}
