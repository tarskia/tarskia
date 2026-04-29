import type { DtoGalleryDiagramSummaryResponse } from '../api/generated/model';

export function coerceSuccessfulResponseBody<TBody>(value: unknown): TBody | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === 'object' && 'status' in value) {
    const response = value as { data?: unknown; status?: unknown };
    return response.status === 200 ? (response.data as TBody) : undefined;
  }
  return value as TBody;
}

export function coerceGallerySummaryArray(value: unknown): DtoGalleryDiagramSummaryResponse[] {
  if (Array.isArray(value)) {
    return value as DtoGalleryDiagramSummaryResponse[];
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  const nested = (value as { data?: unknown }).data;
  return Array.isArray(nested) ? (nested as DtoGalleryDiagramSummaryResponse[]) : [];
}
