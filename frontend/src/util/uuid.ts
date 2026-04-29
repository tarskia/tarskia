const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const sanitizeOptionalUuid = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return UUID_PATTERN.test(trimmed) ? trimmed : undefined;
};
