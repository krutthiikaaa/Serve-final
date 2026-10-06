import type { ApiErrorBody } from '@serve/contracts';

/** Error raised for every non-2xx response or network failure. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export const NETWORK_MESSAGE = 'Unable to connect to SERVE. Please try again.';

/** A short, user-facing message for an error (never a stack trace). */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 0:
        return NETWORK_MESSAGE;
      case 401:
        return 'Your session has expired. Please sign in again.';
      case 403:
        return err.message || 'You do not have permission to do that.';
      case 404:
        return err.message || 'This item is no longer available.';
      case 409:
        return err.message || 'This changed in the meantime. Refresh and try again.';
      case 422:
        return err.message || 'Please check the highlighted fields.';
      case 429:
        return 'Too many requests. Please wait a moment and try again.';
      case 503:
        return NETWORK_MESSAGE;
      default:
        return 'Something went wrong. Please try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}

/** Field-level messages from a 422 VALIDATION_ERROR (`details: [{ path, message }]`). */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || err.status !== 422 || !Array.isArray(err.details)) return {};
  const out: Record<string, string> = {};
  for (const issue of err.details as { path?: unknown; message?: unknown }[]) {
    if (typeof issue.path === 'string' && typeof issue.message === 'string' && !out[issue.path])
      out[issue.path] = issue.message;
  }
  return out;
}

export interface ApiClientOptions {
  /** Backend origin, e.g. http://localhost:5001 (no trailing slash). */
  baseUrl: string;
  /** Current Firebase ID token; `forceRefresh` after an expired-token response. */
  getToken: (forceRefresh?: boolean) => Promise<string | null>;
  /** Called when the backend rejects the session for good. */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
}

export type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  body?: unknown;
  query?: Query;
  headers?: Record<string, string>;
  /** Public endpoints (e.g. /hostels) skip the Authorization header. */
  anonymous?: boolean;
}

export interface ApiResponse<T> {
  body: T;
  headers: Headers;
  status: number;
}

/**
 * Typed HTTP client for the SERVE backend. One place for auth headers,
 * error mapping and the single retry after an expired Firebase token.
 */
export class ApiClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ApiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
  }

  async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const attempt = async (forceRefresh: boolean): Promise<Response> => {
      const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      if (!options.anonymous) {
        const token = await this.options.getToken(forceRefresh);
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      try {
        return await this.fetchImpl(this.url(path, options.query), {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
      } catch {
        throw new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE);
      }
    };

    let res = await attempt(false);
    if (res.status === 401 && !options.anonymous) {
      const code = await peekCode(res);
      if (code === 'AUTH_TOKEN_EXPIRED') res = await attempt(true);
      else {
        this.options.onUnauthorized?.();
        throw await toError(res, code);
      }
    }
    if (!res.ok) {
      if (res.status === 401) this.options.onUnauthorized?.();
      throw await toError(res);
    }
    const body = (res.status === 204 ? undefined : await res.json()) as T;
    return { body, headers: res.headers, status: res.status };
  }

  /** Convenience for `{ data }` responses. */
  async data<T>(method: string, path: string, options?: RequestOptions): Promise<T> {
    return (await this.request<{ data: T }>(method, path, options)).body.data;
  }

  get<T>(path: string, query?: Query) {
    return this.data<T>('GET', path, { query });
  }

  private url(path: string, query?: Query): string {
    const url = new URL(`/api${path}`, this.options.baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '')
        url.searchParams.set(key, String(value));
    }
    return url.toString();
  }
}

async function peekCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.clone().json()) as ApiErrorBody;
    return body.error.code;
  } catch {
    return undefined;
  }
}

async function toError(res: Response, knownCode?: string): Promise<ApiError> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    return new ApiError(
      res.status,
      body.error.code ?? knownCode,
      body.error.message,
      body.error.details,
      body.error.requestId,
    );
  } catch {
    return new ApiError(res.status, knownCode ?? 'UNKNOWN', res.statusText || 'Request failed');
  }
}
