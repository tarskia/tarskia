export function toLowercaseSlug(value: string, fallback = 'area'): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized.length > 0 ? normalized : fallback;
}

export function normalizeAreaLookupKey(value: string): string {
  return toLowercaseSlug(value, 'area');
}
