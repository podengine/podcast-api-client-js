import { describe, expect, test } from 'bun:test';

import { PodEngineCore, type EndpointDescriptor } from '../src/core/client-core';
import { PodEngineApiError, PodEngineConnectionError } from '../src/core/errors';

import { failingFetch, mockFetch } from './helpers';

const desc = (overrides: Partial<EndpointDescriptor>): EndpointDescriptor => ({
  method: 'GET',
  path: '/api/v1/test',
  pathParams: [],
  queryParams: [],
  body: 'none',
  binary: false,
  ...overrides,
});

describe('PodEngineCore — configuration', () => {
  test('throws if no apiKey is provided', () => {
    expect(() => new PodEngineCore({ apiKey: '' })).toThrow(PodEngineApiError);
  });

  test('sends auth, source and custom headers', async () => {
    const { fetch, calls } = mockFetch([{ json: { status: 'OK', data: { ok: true } } }]);
    const core = new PodEngineCore({ apiKey: 'sk_test', source: 'my-app', headers: { 'x-extra': '1' }, fetch });
    await core.request(desc({}), {}, { headers: { 'x-call': '2' } });
    const { headers } = calls[0]!;
    expect(headers.Authorization).toBe('sk_test');
    expect(headers['x-source']).toBe('my-app');
    expect(headers['x-extra']).toBe('1');
    expect(headers['x-call']).toBe('2');
  });

  test('defaults baseUrl to production and strips trailing slashes', async () => {
    const { fetch, calls } = mockFetch([{ json: { data: null } }]);
    const core = new PodEngineCore({ apiKey: 'k', fetch, baseUrl: 'https://staging.example.com/' });
    await core.request(desc({ path: '/api/v1/x' }));
    expect(calls[0]!.url).toBe('https://staging.example.com/api/v1/x');
  });
});

describe('PodEngineCore — request building', () => {
  test('substitutes and encodes path params', async () => {
    const { fetch, calls } = mockFetch([{ json: { data: {} } }]);
    const core = new PodEngineCore({ apiKey: 'k', fetch, baseUrl: 'https://api.test' });
    await core.request(
      desc({ path: '/api/v1/episodes/{episodeId}/details', pathParams: ['episodeId'] }),
      { episodeId: 'a b/c' }
    );
    expect(calls[0]!.url).toBe('https://api.test/api/v1/episodes/a%20b%2Fc/details');
  });

  test('throws if a required path param is missing', async () => {
    const { fetch } = mockFetch([{ json: { data: {} } }]);
    const core = new PodEngineCore({ apiKey: 'k', fetch });
    await expect(
      core.request(desc({ path: '/api/v1/x/{id}', pathParams: ['id'] }), {})
    ).rejects.toThrow(/Missing required path parameter "id"/);
  });

  test('serializes query params and ignores non-query keys', async () => {
    const { fetch, calls } = mockFetch([{ json: { data: {} } }]);
    const core = new PodEngineCore({ apiKey: 'k', fetch, baseUrl: 'https://api.test' });
    await core.request(
      desc({ path: '/api/v1/charts/latest', queryParams: ['chartType', 'country', 'positionsLimit'] }),
      { chartType: 'apple', country: 'us', positionsLimit: 10, ignored: 'x' }
    );
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get('chartType')).toBe('apple');
    expect(url.searchParams.get('country')).toBe('us');
    expect(url.searchParams.get('positionsLimit')).toBe('10');
    expect(url.searchParams.has('ignored')).toBe(false);
  });

  test('merge body mode sends non-path/query params as JSON body', async () => {
    const { fetch, calls } = mockFetch([{ json: { data: { id: '1' } } }]);
    const core = new PodEngineCore({ apiKey: 'k', fetch });
    await core.request(
      desc({ method: 'POST', path: '/api/v1/x/{id}', pathParams: ['id'], queryParams: ['q'], body: 'merge' }),
      { id: '1', q: 'search', alertName: 'A', enabled: true }
    );
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ alertName: 'A', enabled: true });
  });

  test('field body mode sends params.body verbatim', async () => {
    const { fetch, calls } = mockFetch([{ json: { data: {} } }]);
    const core = new PodEngineCore({ apiKey: 'k', fetch });
    await core.request(
      desc({ method: 'PUT', path: '/api/v1/x/{id}/links', pathParams: ['id'], body: 'field' }),
      { id: '1', body: [{ socialMediaType: 'twitter', url: 'https://x.com/a' }] }
    );
    expect(JSON.parse(calls[0]!.body!)).toEqual([{ socialMediaType: 'twitter', url: 'https://x.com/a' }]);
  });

  test('no body mode sends no request body or content-type', async () => {
    const { fetch, calls } = mockFetch([{ json: { data: {} } }]);
    const core = new PodEngineCore({ apiKey: 'k', fetch });
    await core.request(desc({ method: 'DELETE', path: '/api/v1/x/{id}', pathParams: ['id'] }), { id: '1' });
    expect(calls[0]!.body).toBeUndefined();
    expect(calls[0]!.headers['Content-Type']).toBeUndefined();
  });
});

describe('PodEngineCore — responses', () => {
  test('unwraps the { status, data } envelope', async () => {
    const { fetch } = mockFetch([{ json: { status: 'OK', data: { hello: 'world' } } }]);
    const core = new PodEngineCore({ apiKey: 'k', fetch });
    const result = await core.request<{ hello: string }>(desc({}));
    expect(result).toEqual({ hello: 'world' });
  });

  test('hydrates ISO date-time strings in the response', async () => {
    const { fetch } = mockFetch([{ json: { data: { publishedAt: '2024-01-31T12:00:00.000Z' } } }]);
    const core = new PodEngineCore({ apiKey: 'k', fetch });
    const result = await core.request<{ publishedAt: Date }>(desc({}));
    expect(result.publishedAt).toBeInstanceOf(Date);
  });

  test('returns a Blob for binary endpoints', async () => {
    const blob = new Blob(['file-bytes'], { type: 'application/octet-stream' });
    const { fetch } = mockFetch([{ blob }]);
    const core = new PodEngineCore({ apiKey: 'k', fetch });
    const result = await core.request<Blob>(desc({ binary: true }));
    expect(result).toBeInstanceOf(Blob);
    expect(await (result as Blob).text()).toBe('file-bytes');
  });

  test('returns undefined for 204 No Content', async () => {
    const { fetch } = mockFetch([{ status: 204 }]);
    const core = new PodEngineCore({ apiKey: 'k', fetch });
    const result = await core.request(desc({ method: 'DELETE' }));
    expect(result).toBeUndefined();
  });
});

describe('PodEngineCore — errors', () => {
  test('throws PodEngineApiError with status and extracted message', async () => {
    const { fetch } = mockFetch([{ status: 404, json: { data: { message: 'Podcast not found' } } }]);
    const core = new PodEngineCore({ apiKey: 'k', fetch, maxRetries: 0 });
    const err = await core.request(desc({})).catch((e) => e);
    expect(err).toBeInstanceOf(PodEngineApiError);
    expect((err as PodEngineApiError).status).toBe(404);
    expect((err as PodEngineApiError).message).toBe('Podcast not found');
  });

  test('captures x-request-id on errors', async () => {
    const { fetch } = mockFetch([{ status: 400, json: { message: 'bad' }, headers: { 'x-request-id': 'req_123' } }]);
    const core = new PodEngineCore({ apiKey: 'k', fetch, maxRetries: 0 });
    const err = (await core.request(desc({})).catch((e) => e)) as PodEngineApiError;
    expect(err.requestId).toBe('req_123');
  });

  test('throws PodEngineConnectionError on network failure (after retries)', async () => {
    const { fetch, count } = failingFetch();
    const core = new PodEngineCore({ apiKey: 'k', fetch, maxRetries: 2 });
    const err = await core.request(desc({})).catch((e) => e);
    expect(err).toBeInstanceOf(PodEngineConnectionError);
    expect(count()).toBe(3); // initial + 2 retries
  });
});

describe('PodEngineCore — retries', () => {
  test('retries on 429 then succeeds', async () => {
    const { fetch, calls } = mockFetch([
      { status: 429, headers: { 'retry-after': '0' }, json: { message: 'slow down' } },
      { json: { data: { ok: true } } },
    ]);
    const core = new PodEngineCore({ apiKey: 'k', fetch, maxRetries: 2 });
    const result = await core.request<{ ok: boolean }>(desc({}));
    expect(result).toEqual({ ok: true });
    expect(calls.length).toBe(2);
  });

  test('retries on 500 up to maxRetries then throws', async () => {
    const { fetch, calls } = mockFetch([{ status: 500, json: { message: 'boom' } }]);
    const core = new PodEngineCore({ apiKey: 'k', fetch, maxRetries: 1 });
    const err = await core.request(desc({})).catch((e) => e);
    expect(err).toBeInstanceOf(PodEngineApiError);
    expect((err as PodEngineApiError).status).toBe(500);
    expect(calls.length).toBe(2); // initial + 1 retry
  });

  test('does not retry on 4xx (except 408/429)', async () => {
    const { fetch, calls } = mockFetch([{ status: 400, json: { message: 'bad request' } }]);
    const core = new PodEngineCore({ apiKey: 'k', fetch, maxRetries: 3 });
    await core.request(desc({})).catch(() => {});
    expect(calls.length).toBe(1);
  });
});
