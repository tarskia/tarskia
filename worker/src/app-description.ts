const APP_DESCRIPTION_MAX_LENGTH = 80;

export function normalizeAppDescriptionText(value: string | null | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  if (normalized.length <= APP_DESCRIPTION_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, APP_DESCRIPTION_MAX_LENGTH - 3).trimEnd()}...`;
}
