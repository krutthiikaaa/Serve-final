import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, NETWORK_MESSAGE, errorMessage, fieldErrors } from '../src/api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const errorBody = (code: string, message = 'msg', details?: unknown) => ({
  error: { code, message, requestId: 'req-1', ...(details ? { details } : {}) },
});

function client(
  responses: Response[],
  overrides: Partial<ConstructorParameters<typeof ApiClient>[0]> = {},
) {
  const fetchImpl = vi.fn(async () => responses.shift()!);
  const getToken = vi.fn(async (force?: boolean) => (force ? 'fresh-token' : 'cached-token'));
  const onUnauthorized = vi.fn();
  const api = new ApiClient({
    baseUrl: 'http://localhost:5001',
    getToken,
    onUnauthorized,
    fetchImpl,
    ...overrides,
  });
  return { api, fetchImpl, getToken, onUnauthorized };
}

describe('ApiClient', () => {
  it('prefixes /api, encodes the query, drops empty values and sends the bearer token', async () => {
    const { api, fetchImpl } = client([json(200, { data: [] })]);
    await api.get('/staff/orders', { status: 'active', cursor: undefined, limit: 10, q: '' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:5001/api/staff/orders?status=active&limit=10');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer cached-token');
  });

  it('unwraps { data } and sends JSON bodies', async () => {
    const { api, fetchImpl } = client([json(201, { data: { id: 'x' } })]);
    await expect(
      api.data('POST', '/staff/menu/categories', { body: { name: 'Snacks' } }),
    ).resolves.toEqual({ id: 'x' });
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.body).toBe('{"name":"Snacks"}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('skips the Authorization header for anonymous calls', async () => {
    const { api, fetchImpl, getToken } = client([json(200, { data: [] })]);
    await api.data('GET', '/hostels', { anonymous: true });
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(getToken).not.toHaveBeenCalled();
  });

  it('retries exactly once with a force-refreshed token after AUTH_TOKEN_EXPIRED', async () => {
    const { api, fetchImpl, getToken, onUnauthorized } = client([
      json(401, errorBody('AUTH_TOKEN_EXPIRED')),
      json(200, { data: 'ok' }),
    ]);
    await expect(api.get('/auth/me')).resolves.toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenLastCalledWith(true);
    const retry = (fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect((retry.headers as Record<string, string>).Authorization).toBe('Bearer fresh-token');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('signs out on other 401s and surfaces the error code', async () => {
    const { api, onUnauthorized } = client([json(401, errorBody('AUTH_TOKEN_REVOKED', 'Revoked'))]);
    await expect(api.get('/auth/me')).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_TOKEN_REVOKED',
    });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('maps network failures to a friendly status-0 error', async () => {
    const api = new ApiClient({
      baseUrl: 'http://localhost:5001',
      getToken: async () => 't',
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const err = await api.get('/health').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).isNetwork).toBe(true);
    expect(errorMessage(err)).toBe(NETWORK_MESSAGE);
  });

  it('keeps the backend error envelope (code, message, requestId)', async () => {
    const { api } = client([
      json(409, errorBody('INVALID_STATUS_TRANSITION', 'Order is already READY')),
    ]);
    const err = (await api
      .data('PATCH', '/staff/orders/1/status', { body: { status: 'READY' } })
      .catch((e: unknown) => e)) as ApiError;
    expect(err).toMatchObject({
      status: 409,
      code: 'INVALID_STATUS_TRANSITION',
      requestId: 'req-1',
    });
    expect(errorMessage(err)).toBe('Order is already READY');
  });
});

describe('error helpers', () => {
  it.each([
    [401, 'Your session has expired. Please sign in again.'],
    [429, 'Too many requests. Please wait a moment and try again.'],
    [503, NETWORK_MESSAGE],
    [500, 'Something went wrong. Please try again.'],
  ])('maps %s to a user-facing message', (status, message) => {
    expect(errorMessage(new ApiError(status, 'X', 'internal detail'))).toBe(message);
  });

  it('never leaks unknown errors', () => {
    expect(errorMessage(new Error('stack trace here'))).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('extracts 422 field errors', () => {
    const err = new ApiError(422, 'VALIDATION_ERROR', 'Validation failed', [
      { path: 'pricePaise', message: 'Must be at least 100 paise (₹1)' },
      { path: 'name', message: 'Required' },
    ]);
    expect(fieldErrors(err)).toEqual({
      pricePaise: 'Must be at least 100 paise (₹1)',
      name: 'Required',
    });
    expect(fieldErrors(new ApiError(409, 'X', 'y'))).toEqual({});
  });
});
