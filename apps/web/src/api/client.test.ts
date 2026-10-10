import { describe, expect, it } from 'vitest';
import { mockApi } from '../test/utils.tsx';
import { ApiError, api } from './client.ts';

describe('api client', () => {
  it('sends JSON with same-origin credentials', async () => {
    const fetchMock = mockApi({ 'POST /auth/login': { body: { status: 'ok' } } });
    await expect(api.post('/auth/login', { login: 'a', password: 'b' })).resolves.toEqual({
      status: 'ok',
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/auth/login');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.['content-type']).toBe('application/json');
  });

  it('throws a typed ApiError with code and details', async () => {
    mockApi({
      'POST /auth/register': {
        status: 422,
        body: {
          error: 'validation_failed',
          message: 'Some fields are invalid',
          details: [{ path: 'email', message: 'Invalid email' }],
        },
      },
    });
    const error = await api.post('/auth/register', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: 'validation_failed' });
    expect((error as ApiError).fieldIssues).toEqual([{ path: 'email', message: 'Invalid email' }]);
  });
});
