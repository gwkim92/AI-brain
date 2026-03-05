import { buildProviderHttpError } from './retry';

export function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function joinPath(baseUrl: string, path: string): string {
  const base = stripTrailingSlash(baseUrl);
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

export function readTextSafely(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

export function ensureOk(response: Response, bodyText: string): void {
  if (!response.ok) {
    throw buildProviderHttpError({
      status: response.status,
      statusText: response.statusText,
      bodyText,
      retryAfterHeader: response.headers.get('retry-after')
    });
  }
}
