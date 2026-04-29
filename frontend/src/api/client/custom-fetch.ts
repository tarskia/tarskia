export interface ApiErrorPayload {
  error?: string;
  message?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const resolveApiBaseUrl = () => {
  const configured =
    import.meta.env.VITE_API_BASE_URL?.trim() ||
    (typeof process !== 'undefined' ? process.env.VITE_API_BASE_URL?.trim() : undefined);
  if (configured) {
    return configured.endsWith('/') ? configured.slice(0, -1) : configured;
  }
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return '';
};

export const resolveRequestUrl = (url: string) => {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  const baseUrl = resolveApiBaseUrl();
  if (!baseUrl) {
    return url;
  }
  return `${baseUrl}${url.startsWith('/') ? url : `/${url}`}`;
};

const parseResponseBody = async (response: Response) => {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
};

export const customFetch = async <TData>(
  url: string,
  options: RequestInit = {},
): Promise<TData> => {
  const requestInit: RequestInit = {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  };

  const response = await fetch(resolveRequestUrl(url), requestInit);
  const body = await parseResponseBody(response);
  return {
    data: body,
    status: response.status,
    headers: response.headers,
  } as TData;
};
