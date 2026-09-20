/**
 * The one place ARCA talks to the network.
 *
 * Every upstream in this system publishes a different failure dialect:
 * DeepFire answers a too-broad query with HTTP 500 and a timeout message,
 * 503 with `Retry-After` when the shared concurrency cap is full, and 401 when
 * a cached token has aged out. Talaia answers an oversized polygon with 403 and
 * a sentence telling you how to split it. Treating all of those as "request
 * failed" would either retry the ones that will never succeed or give up on the
 * ones that would.
 */

/** Keep the endpoint and the shape of the query; drop the bulk. */
function shortenUrl(url: string, max = 240): string {
  if (url.length <= max) return url;
  const cut = url.indexOf("?");
  const base = cut === -1 ? url : url.slice(0, cut);
  return `${base}?… (${url.length - base.length - 1} chars of query elided)`;
}

export class HttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly retryAfterMs: number | null;
  readonly url: string;

  constructor(opts: {
    status: number;
    body: string;
    url: string;
    retryAfterMs?: number | null;
    message?: string;
  }) {
    // A CQL2 filter over a few hundred cluster ids makes a URL thousands of
    // characters long, and putting that in an Error message buries the actual
    // failure under a wall of UUIDs in every log line that touches it.
    super(opts.message ?? `HTTP ${opts.status} from ${shortenUrl(opts.url)}: ${opts.body.slice(0, 300)}`);
    this.name = "HttpError";
    this.status = opts.status;
    this.body = opts.body;
    this.url = opts.url;
    this.retryAfterMs = opts.retryAfterMs ?? null;
  }

  /** 429/503 mean "later"; 5xx usually means "narrower". 4xx means "different". */
  get retryable(): boolean {
    if (this.status === 429 || this.status === 503) return true;
    return this.status >= 500;
  }
}

export interface RequestOptions extends Omit<RequestInit, "signal"> {
  timeoutMs?: number;
  retries?: number;
  /** Base delay for exponential backoff. Honoured only when no Retry-After. */
  retryDelayMs?: number;
  /** Called before each retry so callers can log or emit a timeline event. */
  onRetry?: (attempt: number, error: unknown, waitMs: number) => void;
  /** Return true to retry a non-HttpError (network reset, DNS blip). */
  signalTimeoutMessage?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/** Full jitter: retries spread out instead of stampeding a recovering service. */
function backoff(attempt: number, base: number): number {
  const ceiling = Math.min(base * 2 ** attempt, 20_000);
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

export async function request(url: string, options: RequestOptions = {}): Promise<Response> {
  const {
    timeoutMs = 30_000,
    retries = 2,
    retryDelayMs = 500,
    onRetry,
    signalTimeoutMessage,
    ...init
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (response.ok) return response;

      const body = await response.text().catch(() => "");
      const error = new HttpError({
        status: response.status,
        body,
        url,
        retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
      });

      if (!error.retryable || attempt === retries) throw error;
      const wait = error.retryAfterMs ?? backoff(attempt, retryDelayMs);
      onRetry?.(attempt + 1, error, wait);
      await sleep(wait);
      lastError = error;
    } catch (error) {
      if (error instanceof HttpError) {
        if (!error.retryable || attempt === retries) throw error;
        lastError = error;
      } else {
        const aborted = error instanceof Error && error.name === "AbortError";
        const wrapped = aborted
          ? new Error(signalTimeoutMessage ?? `Request to ${url} timed out after ${timeoutMs} ms`)
          : error;
        if (attempt === retries) throw wrapped;
        const wait = backoff(attempt, retryDelayMs);
        onRetry?.(attempt + 1, wrapped, wait);
        await sleep(wait);
        lastError = wrapped;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error(`Request to ${url} failed`);
}

export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(url, {
    ...options,
    headers: { accept: "application/json", ...(options.headers ?? {}) },
  });
  return (await response.json()) as T;
}

/** Bounded concurrency without pulling in p-queue. */
export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

/** Time-boxed memo. Used for tokens, static masks and weather. */
export class TtlCache<T> {
  private readonly store = new Map<string, { value: T; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + (ttlMs ?? this.ttlMs) });
  }

  async wrap(key: string, fn: () => Promise<T>, ttlMs?: number): Promise<T> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = await fn();
    this.set(key, value, ttlMs);
    return value;
  }

  clear(): void {
    this.store.clear();
  }
}
