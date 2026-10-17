/**
 * Transport core for the Pod Engine SDK.
 *
 * The generated resource methods are thin wrappers that hand a static `EndpointDescriptor`
 * plus the caller's params to {@link PodEngineCore.request}. All HTTP concerns — auth, URL
 * building, query serialization, retries, error normalization, envelope unwrapping and date
 * hydration — live here. This file has zero dependencies and zero internal imports so the
 * package can be published and mirrored standalone.
 */
import { PodEngineApiError, PodEngineConnectionError } from './errors';
import { buildSearchParams, hydrateDates, type QueryValue } from './transform';

/** Cross-runtime `fetch` signature (Node 18+, Bun, Deno, browsers all provide this). */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const DEFAULT_BASE_URL = 'https://api.podengine.ai';
const DEFAULT_SOURCE = 'api';
const DEFAULT_MAX_RETRIES = 2;

export interface ClientOptions {
  /** Your Pod Engine API key. Get one at https://www.podengine.ai/get-started. */
  apiKey: string;
  /** Override the API base URL (e.g. for a staging environment). Defaults to production. */
  baseUrl?: string;
  /** Sent as the `x-source` header so Pod Engine can attribute traffic. Defaults to `"api"`. */
  source?: string;
  /** Extra headers added to every request. */
  headers?: Record<string, string>;
  /** Inject a custom `fetch` implementation (defaults to the global `fetch`). */
  fetch?: FetchLike;
  /** Max automatic retries for transient failures (429 / 5xx / network). Defaults to 2. */
  maxRetries?: number;
  /** Per-attempt timeout in milliseconds, including response reads. Unset means no attempt timeout. */
  timeout?: number;
  /** Overall deadline in milliseconds, including retries and response reads. Defaults to 60_000; null disables it. */
  totalTimeout?: number | null;
}

/** Per-call overrides. */
export interface RequestOptions {
  /** Abort the request via an `AbortSignal`. */
  signal?: AbortSignal;
  /** Extra headers for this request only (merged over the client headers). */
  headers?: Record<string, string>;
  /** Override the timeout (ms) for this request only. */
  timeout?: number;
  /** Overall deadline in milliseconds, including retries and response reads. Defaults to 60_000; null disables it. */
  totalTimeout?: number | null;
  /** Override automatic retries for this request only. */
  maxRetries?: number;
}

/** Static metadata the generator emits for each endpoint. */
export interface EndpointDescriptor {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path template with `{param}` placeholders, e.g. `/api/v1/episodes/{episodeId}/details`. */
  path: string;
  /** Names of params that fill `{...}` placeholders in the path. */
  pathParams: readonly string[];
  /** Names of params serialized into the query string. */
  queryParams: readonly string[];
  /**
   * How the JSON request body is assembled from the call params:
   * - `'none'`  — no request body
   * - `'merge'` — body is every param that is not a path/query param (object bodies)
   * - `'field'` — body is the `params.body` value verbatim (array / non-object bodies)
   */
  body: 'none' | 'merge' | 'field';
  /** Whether the success response is a binary download (returned as a `Blob`). */
  binary: boolean;
}

const isAbortError = (err: unknown): boolean =>
  err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');

const isRetriableStatus = (status: number): boolean => status === 429 || status === 408 || status >= 500;

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const deadline = performance.now() + ms;
    const tick = () => {
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      } else timer = setTimeout(tick, Math.min(remaining, 2_147_483_647));
    };
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    tick();
  });

const validateTotalTimeout = (value: number | null): void => {
  if (value !== null && (!Number.isFinite(value) || value <= 0)) {
    throw new RangeError('totalTimeout must be a finite positive number or null.');
  }
};

// Explicit cleanup also supports runtimes without AbortSignal.any.
const abortScope = (parent?: AbortSignal, timeout?: number) => {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) onAbort();
  else parent?.addEventListener('abort', onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeout && !controller.signal.aborted) {
    const deadline = performance.now() + timeout;
    const tick = () => {
      const remaining = deadline - performance.now();
      if (remaining <= 0) controller.abort(new DOMException('Timed out', 'TimeoutError'));
      else timer = setTimeout(tick, Math.min(remaining, 2_147_483_647));
    };
    tick();
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
};

const withSignal = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });

const pick = (value: unknown, key: string): unknown =>
  value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;

// Pull the most useful human-readable message out of the many error envelope shapes the
// API may return, falling back to the raw text / status.
const extractErrorMessage = (body: unknown, fallback: string): string => {
  if (typeof body === 'string') return body || fallback;
  if (body && typeof body === 'object') {
    const data = pick(body, 'data');
    const candidate =
      pick(data, 'message') ??
      pick(body, 'message') ??
      pick(data, 'error') ??
      pick(body, 'error') ??
      pick(data, 'errorMessage') ??
      pick(body, 'errorMessage') ??
      pick(data, 'errorDetails') ??
      pick(body, 'errorDetails');
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    if (candidate != null) return JSON.stringify(candidate);
  }
  return fallback;
};

export class PodEngineCore {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly source: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: FetchLike;
  private readonly maxRetries: number;
  private readonly timeout: number | undefined;
  private readonly totalTimeout: number | null;

  constructor(options: ClientOptions) {
    if (!options?.apiKey) {
      throw new PodEngineApiError({
        status: 0,
        method: 'CONFIG',
        url: '',
        message: 'A Pod Engine `apiKey` is required. Get one at https://www.podengine.ai/get-started.',
      });
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.source = options.source ?? DEFAULT_SOURCE;
    this.headers = options.headers ?? {};
    const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;
    const resolvedFetch = options.fetch ?? globalFetch;
    if (!resolvedFetch) {
      throw new PodEngineApiError({
        status: 0,
        method: 'CONFIG',
        url: '',
        message: 'No global `fetch` found. Use Node 18+, or pass a `fetch` implementation via the client options.',
      });
    }
    this.fetchImpl = resolvedFetch;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeout = options.timeout;
    this.totalTimeout = options.totalTimeout === undefined ? 60_000 : options.totalTimeout;
    validateTotalTimeout(this.totalTimeout);
  }

  /** Execute an endpoint. Returns the unwrapped `data` payload (or a `Blob` for downloads). */
  async request<TResult>(
    descriptor: EndpointDescriptor,
    params?: Record<string, unknown>,
    options: RequestOptions = {}
  ): Promise<TResult> {
    const allParams = params ?? {};
    const pathParamSet = new Set(descriptor.pathParams);
    const queryParamSet = new Set(descriptor.queryParams);

    // Substitute path params.
    let path = descriptor.path;
    for (const name of descriptor.pathParams) {
      const value = allParams[name];
      if (value === undefined || value === null) {
        throw new PodEngineApiError({
          status: 0,
          method: descriptor.method,
          url: this.baseUrl + path,
          message: `Missing required path parameter "${name}" for ${descriptor.method} ${descriptor.path}.`,
        });
      }
      path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
    }

    // Build query string.
    const query: Record<string, QueryValue> = {};
    for (const name of descriptor.queryParams) {
      if (allParams[name] !== undefined) query[name] = allParams[name] as QueryValue;
    }
    const search = buildSearchParams(query).toString();

    // Assemble the JSON body according to the descriptor's body mode.
    const hasBody = descriptor.body !== 'none';
    let body: unknown;
    if (descriptor.body === 'merge') {
      const bodyObj: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(allParams)) {
        if (!pathParamSet.has(key) && !queryParamSet.has(key)) bodyObj[key] = value;
      }
      body = bodyObj;
    } else if (descriptor.body === 'field') {
      body = allParams.body;
    }

    const url = `${this.baseUrl}${path}${search ? `?${search}` : ''}`;
    const headers: Record<string, string> = {
      Authorization: this.apiKey,
      'x-source': this.source,
      ...this.headers,
      ...options.headers,
    };
    if (hasBody) headers['Content-Type'] = 'application/json';

    const init: RequestInit = {
      method: descriptor.method,
      headers,
      body: hasBody ? JSON.stringify(body) : undefined,
    };

    const maxRetries = options.maxRetries ?? this.maxRetries;
    const timeout = options.timeout ?? this.timeout;

    const totalTimeout = options.totalTimeout === undefined ? this.totalTimeout : options.totalTimeout;
    validateTotalTimeout(totalTimeout);
    const deadline = totalTimeout === null ? Infinity : performance.now() + totalTimeout;
    const overall = abortScope(options.signal, totalTimeout ?? undefined);
    const deadlineError = () =>
      new PodEngineConnectionError({
        message: `Overall request deadline of ${totalTimeout}ms exceeded for ${url}.`,
        url,
        method: descriptor.method,
      });
    const waitToRetry = async (delay: number) => {
      if (delay >= deadline - performance.now())
        throw new PodEngineConnectionError({
          message: `Retry delay of ${delay}ms cannot fit within the remaining overall request deadline for ${url}.`,
          url,
          method: descriptor.method,
        });
      await sleep(delay, overall.signal);
    };
    let attempt = 0;
    try {
      for (;;) {
        if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Aborted', 'AbortError');
        if (performance.now() >= deadline || overall.signal.aborted) throw deadlineError();
        const scope = abortScope(overall.signal, timeout);
        try {
          const response = await withSignal(this.fetchImpl(url, { ...init, signal: scope.signal }), scope.signal);
          if (!response.ok) {
            if (isRetriableStatus(response.status) && attempt < maxRetries) {
              attempt++;
              const retryAfter = this.retryAfterMs(response);
              const delay =
                retryAfter === undefined ? this.backoffMs(attempt) : retryAfter + 1 + Math.floor(Math.random() * 250);
              // Release the connection before waiting; the error body is not needed for a retry.
              void response.body?.cancel().catch(() => {
                /* Cancellation cleanup must not replace the request outcome. */
              });
              scope.dispose();
              await waitToRetry(delay);
              continue;
            }
            return await withSignal(this.throwApiError(response, url, descriptor.method, scope.signal), scope.signal);
          }
          const result = await withSignal(
            this.parseSuccess<TResult>(response, descriptor, url, scope.signal),
            scope.signal
          );
          // Parsing and date hydration can consume budget before the timer callback gets a turn.
          if (performance.now() >= deadline || overall.signal.aborted) throw deadlineError();
          if (scope.signal.aborted) throw scope.signal.reason;
          return result;
        } catch (err) {
          if (options.signal?.aborted) throw options.signal.reason ?? err;
          if (overall.signal.aborted || performance.now() >= deadline) throw deadlineError();
          if (err instanceof PodEngineApiError || err instanceof PodEngineConnectionError) throw err;
          scope.dispose();
          if (attempt < maxRetries) {
            attempt++;
            await waitToRetry(this.backoffMs(attempt));
            continue;
          }
          throw new PodEngineConnectionError({
            message:
              isAbortError(err) && timeout
                ? `Request to ${url} timed out after ${timeout}ms.`
                : `Unable to reach the Pod Engine API at ${url}. ${err instanceof Error ? err.message : String(err)}`,
            url,
            method: descriptor.method,
            cause: err,
          });
        } finally {
          scope.dispose();
        }
      }
    } catch (err) {
      if (options.signal?.aborted) throw options.signal.reason ?? err;
      if (overall.signal.aborted || performance.now() >= deadline) throw deadlineError();
      throw err;
    } finally {
      overall.dispose();
    }
  }

  private async parseSuccess<TResult>(
    response: Response,
    descriptor: EndpointDescriptor,
    url: string,
    signal: AbortSignal
  ): Promise<TResult> {
    if (descriptor.binary) {
      const bytes = await this.readBody(response, signal);
      return new Blob([bytes], { type: response.headers.get('content-type') ?? '' }) as TResult;
    }
    if (response.status === 204) return undefined as TResult;

    const text = new TextDecoder().decode(await this.readBody(response, signal));
    if (!text) return undefined as TResult;

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      // A JSON endpoint returned a 2xx whose body isn't JSON (e.g. an HTML error page from
      // an intermediary, or a truncated response). Returning the raw text would violate the
      // method's typed contract and surface as a confusing failure far downstream, so fail loudly.
      throw new PodEngineApiError({
        status: response.status,
        method: descriptor.method,
        url,
        message: `Expected a JSON response but the body could not be parsed (status ${response.status}): ${text.slice(0, 200)}`,
        body: text,
        requestId: response.headers.get('x-request-id') ?? undefined,
      });
    }
    hydrateDates(json);

    // Unwrap the `{ status, data }` envelope the API uses for JSON responses.
    if (json && typeof json === 'object' && 'data' in (json as Record<string, unknown>)) {
      return (json as { data: TResult }).data;
    }
    return json as TResult;
  }

  private async throwApiError(response: Response, url: string, method: string, signal: AbortSignal): Promise<never> {
    let body: unknown;
    const raw = new TextDecoder().decode(await this.readBody(response, signal));
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    throw new PodEngineApiError({
      status: response.status,
      method,
      url,
      message: extractErrorMessage(body, `Request failed with status ${response.status}`),
      body,
      requestId: response.headers.get('x-request-id') ?? undefined,
    });
  }

  private async readBody(response: Response, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await withSignal(reader.read(), signal);
        if (done) break;
        chunks.push(value);
        length += value.length;
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    } finally {
      if (signal.aborted)
        void reader.cancel(signal.reason).catch(() => {
          /* Cancellation cleanup must not replace the request outcome. */
        });
      reader.releaseLock();
    }
  }

  private backoffMs(attempt: number): number {
    // Exponential backoff with jitter, capped at 8s.
    const base = Math.min(8000, 250 * 2 ** (attempt - 1));
    return base + Math.floor(base * 0.25 * Math.random());
  }

  private retryAfterMs(response: Response): number | undefined {
    const header = response.headers.get('retry-after');
    if (!header) return undefined;
    const value = header.trim();
    // Reject negative/nonfinite numbers before date parsing (Date.parse accepts some numbers).
    if (/^[+]?(?:\d+\.?\d*|\.\d+)$/.test(value)) {
      const ms = Number(value) * 1000;
      return Number.isFinite(ms) ? ms : undefined;
    }
    if (!/^[A-Za-z]{3},?\s/.test(value)) return undefined;
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
  }
}
