import type { FetchLike } from '../src/core/client-core';

export interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface MockResponseSpec {
  status?: number;
  json?: unknown;
  text?: string;
  blob?: Blob;
  headers?: Record<string, string>;
}

/**
 * Build a `FetchLike` stub that replays a queue of responses and records every request.
 * If the queue is exhausted, the last spec is reused (handy for retry tests).
 */
export const mockFetch = (
  responses: MockResponseSpec[]
): { fetch: FetchLike; calls: CapturedRequest[] } => {
  const calls: CapturedRequest[] = [];
  let index = 0;

  const fetch: FetchLike = async (input, init) => {
    const headers: Record<string, string> = {};
    const initHeaders = init?.headers as Record<string, string> | undefined;
    if (initHeaders) for (const [k, v] of Object.entries(initHeaders)) headers[k] = v;

    calls.push({
      url: input,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });

    const spec = responses[Math.min(index, responses.length - 1)] ?? {};
    index++;

    const status = spec.status ?? 200;
    const respHeaders = new Headers(spec.headers ?? {});

    let bodyInit: BodyInit | null = null;
    if (spec.blob) {
      bodyInit = spec.blob;
    } else if (spec.json !== undefined) {
      bodyInit = JSON.stringify(spec.json);
      if (!respHeaders.has('content-type')) respHeaders.set('content-type', 'application/json');
    } else if (spec.text !== undefined) {
      bodyInit = spec.text;
    }

    return new Response(bodyInit, { status, headers: respHeaders });
  };

  return { fetch, calls };
};

/** A fetch stub that always rejects with a network-style error. */
export const failingFetch = (message = 'fetch failed'): { fetch: FetchLike; count: () => number } => {
  let n = 0;
  const fetch: FetchLike = async () => {
    n++;
    throw new TypeError(message);
  };
  return { fetch, count: () => n };
};
