import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from 'bun:test';

import { type EndpointDescriptor, PodEngineCore } from '@/core/client-core';
import { PodEngineConnectionError } from '@/core/errors';

const endpoint: EndpointDescriptor = {
  method: 'GET',
  path: '/test',
  pathParams: [],
  queryParams: [],
  body: 'none',
  binary: false,
};
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const advance = async (ms: number) => {
  jest.advanceTimersByTime(ms);
  await flush();
};
const ok = () => new Response('{"data":"ok"}');

beforeEach(() => {
  jest.useFakeTimers();
  spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('overall request deadline', () => {
  test('bounds an unresponsive fetch and does not retry after expiration', async () => {
    let calls = 0;
    const core = new PodEngineCore({
      apiKey: 'k',
      totalTimeout: 1000,
      fetch: () => {
        calls++;
        return new Promise<Response>(() => {
          /* Intentionally never settles. */
        });
      },
    });
    const result = core.request(endpoint).catch((e) => e);
    await advance(1000);
    expect(await result).toBeInstanceOf(PodEngineConnectionError);
    expect(calls).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('shares budget across attempts and sleeps', async () => {
    let calls = 0;
    const core = new PodEngineCore({
      apiKey: 'k',
      totalTimeout: 1000,
      fetch: async () => {
        calls++;
        if (calls === 1) return new Response('', { status: 503, headers: { 'retry-after': '0.5' } });
        return new Promise<Response>(() => {
          /* Intentionally never settles. */
        });
      },
    });
    const result = core.request(endpoint).catch((e) => e);
    await flush();
    await advance(501);
    expect(calls).toBe(2);
    await advance(499);
    expect(((await result) as Error).message).toMatch(/Overall request deadline/);
    expect(calls).toBe(2);
  });

  test('a 7200-second maintenance retry fails promptly under the default budget', async () => {
    let calls = 0;
    const core = new PodEngineCore({
      apiKey: 'k',
      fetch: async () => {
        calls++;
        return new Response('', { status: 503, headers: { 'retry-after': '7200' } });
      },
    });
    await expect(core.request(endpoint)).rejects.toThrow(/Retry delay.*cannot fit/);
    expect(calls).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('an override honors Retry-After as a minimum with positive jitter', async () => {
    let calls = 0;
    const core = new PodEngineCore({
      apiKey: 'k',
      totalTimeout: 1000,
      fetch: async () => (++calls === 1 ? new Response('', { status: 429, headers: { 'retry-after': '2' } }) : ok()),
    });
    const result = core.request(endpoint, {}, { totalTimeout: 3000 });
    await flush();
    await advance(2000);
    expect(calls).toBe(1);
    await advance(1);
    expect(await result).toBe('ok');
    expect(calls).toBe(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('large Retry-After with no deadline does not overflow the timer', async () => {
    const controller = new AbortController();
    let calls = 0;
    const core = new PodEngineCore({
      apiKey: 'k',
      totalTimeout: null,
      fetch: async () => {
        calls++;
        return new Response('', { status: 503, headers: { 'retry-after': '3000000' } });
      },
    });
    const result = core.request(endpoint, {}, { signal: controller.signal }).catch((e) => e);
    await flush();
    await advance(2_147_483_647);
    expect(calls).toBe(1);
    controller.abort();
    expect(((await result) as Error).name).toBe('AbortError');
    expect(jest.getTimerCount()).toBe(0);
  });

  for (const binary of [false, true]) {
    test(`bounds and cancels a stalled ${binary ? 'binary' : 'JSON'} response read`, async () => {
      let cancelled = false;
      const core = new PodEngineCore({
        apiKey: 'k',
        totalTimeout: 1000,
        fetch: async () =>
          new Response(
            new ReadableStream({
              cancel() {
                cancelled = true;
              },
            })
          ),
      });
      const result = core.request({ ...endpoint, binary }).catch((e) => e);
      await flush();
      await advance(1000);
      expect(await result).toBeInstanceOf(PodEngineConnectionError);
      await flush();
      expect(cancelled).toBe(true);
    });
  }

  test('caller cancellation interrupts fetch, sleep and response reads', async () => {
    for (const phase of ['fetch', 'sleep', 'body']) {
      const controller = new AbortController();
      let calls = 0;
      const core = new PodEngineCore({
        apiKey: 'k',
        fetch: async () => {
          calls++;
          if (phase === 'fetch')
            return new Promise<Response>(() => {
              /* Intentionally never settles. */
            });
          if (phase === 'sleep') return new Response('', { status: 503, headers: { 'retry-after': '2' } });
          return new Response(new ReadableStream());
        },
      });
      const result = core.request(endpoint, {}, { signal: controller.signal }).catch((e) => e);
      await flush();
      const reason = new Error('caller cancelled');
      controller.abort(reason);
      expect(await result).toBe(reason);
      expect(calls).toBe(1);
      expect(jest.getTimerCount()).toBe(0);
    }
  });

  test('keeps the per-attempt timeout available independently', async () => {
    let calls = 0;
    const core = new PodEngineCore({
      apiKey: 'k',
      timeout: 100,
      totalTimeout: 1000,
      fetch: async () =>
        ++calls === 1
          ? new Promise<Response>(() => {
              /* Intentionally never settles. */
            })
          : ok(),
    });
    const result = core.request(endpoint);
    await advance(100);
    await advance(250);
    expect(await result).toBe('ok');
    expect(calls).toBe(2);
  });

  test('checks the deadline after synchronous JSON decoding', async () => {
    const parse = JSON.parse;
    const now = performance.now.bind(performance);
    spyOn(JSON, 'parse').mockImplementation((...args: Parameters<typeof JSON.parse>) => {
      const value = parse(...args);
      // Simulate CPU work without running any timeout callbacks.
      spyOn(performance, 'now').mockReturnValue(now() + 2000);
      return value;
    });
    const core = new PodEngineCore({ apiKey: 'k', totalTimeout: 1000, fetch: async () => ok() });
    await expect(core.request(endpoint)).rejects.toThrow(/Overall request deadline/);
  });

  test('validates total timeout values', () => {
    for (const value of [-1, 0, NaN, Infinity])
      expect(() => new PodEngineCore({ apiKey: 'k', totalTimeout: value })).toThrow(RangeError);
  });
});

describe('Retry-After parsing', () => {
  for (const value of [
    '',
    ' ',
    '-1',
    'NaN',
    'Infinity',
    '-Infinity',
    '1e309',
    '1e2',
    '0x10',
    'garbage',
    '9'.repeat(400),
  ]) {
    test(`rejects ${JSON.stringify(value)}`, () => {
      const core = new PodEngineCore({ apiKey: 'k' });
      expect(core['retryAfterMs'](new Response('', { headers: { 'retry-after': value } }))).toBeUndefined();
    });
  }
  test('accepts zero, fractional seconds and HTTP dates', () => {
    const core = new PodEngineCore({ apiKey: 'k' });
    const parse = (value: string) => core['retryAfterMs'](new Response('', { headers: { 'retry-after': value } }));
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    expect(parse('0')).toBe(0);
    expect(parse(' 1.5 ')).toBe(1500);
    expect(parse('Thu, 01 Jan 2026 00:00:02 GMT')).toBe(2000);
    expect(parse('Wed, 31 Dec 2025 23:59:59 GMT')).toBe(0);
  });
});
