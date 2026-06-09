/**
 * Error types thrown by the Pod Engine SDK.
 *
 * Every failure surfaces as a `PodEngineError` subclass so consumers can `catch` a single
 * base type and narrow with `instanceof` when they care about the specifics.
 */

/** Base class for every error thrown by the SDK. */
export class PodEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PodEngineError';
    // Restore prototype chain for downlevel-compiled targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The API returned a non-2xx response. Carries the HTTP status, the request URL, and the
 * best-effort parsed error message / raw body for debugging.
 */
export class PodEngineApiError extends PodEngineError {
  readonly status: number;
  readonly url: string;
  readonly method: string;
  /** Raw parsed response body, when available (JSON object or text). */
  readonly body: unknown;
  /** Value of the `x-request-id` response header, when present. */
  readonly requestId: string | undefined;

  constructor(args: {
    status: number;
    message: string;
    url: string;
    method: string;
    body?: unknown;
    requestId?: string;
  }) {
    super(args.message);
    this.name = 'PodEngineApiError';
    this.status = args.status;
    this.url = args.url;
    this.method = args.method;
    this.body = args.body;
    this.requestId = args.requestId;
  }
}

/**
 * The request never produced an HTTP response — DNS failure, connection refused, timeout,
 * or an aborted request. There is no status code.
 */
export class PodEngineConnectionError extends PodEngineError {
  readonly url: string;
  readonly method: string;
  readonly cause: unknown;

  constructor(args: { message: string; url: string; method: string; cause?: unknown }) {
    super(args.message);
    this.name = 'PodEngineConnectionError';
    this.url = args.url;
    this.method = args.method;
    this.cause = args.cause;
  }
}
