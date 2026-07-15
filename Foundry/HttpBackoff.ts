// Shared HTTP resilience for streaming web sources (data engine). A naive fetch loop that just
// `continue`s on every error turns a rate-limited endpoint (HTTP 429) into a tight failure storm:
// the Wikipedia collector once fired ~200,000 back-to-back failing requests because its retry ceiling
// was derived from a 2,000,000-item limit and it never waited between failures. This module gives
// every HTTP source three things: exponential backoff that HONORS a server `Retry-After`, a per-
// request attempt cap, and — across a whole run — a circuit breaker that stops after K consecutive
// failures instead of hammering forever. Injected sleep keeps it testable with no real waiting.

// An HTTP status error carrying the info backoff needs: the status (to decide retryable) and the
// server's Retry-After hint in ms (429/503 often send one). Network errors are NOT this type.
export class HttpError extends Error {
  constructor(
    public Status: number,
    public RetryAfterMs: number | null = null,
  ) {
    super(`HTTP ${Status}`);
    this.name = "HttpError";
  }
}

// Parse a `Retry-After` header (seconds, per RFC 7231) into ms. HTTP-date form is not honored (rare
// for rate limits); a non-numeric value yields null so backoff falls back to exponential.
export function RetryAfterToMs(Header: string | null): number | null {
  if (Header === null) return null;
  const Seconds = Number(Header.trim());
  return Number.isFinite(Seconds) && Seconds >= 0 ? Seconds * 1000 : null;
}

// Default retryable predicate: transient failures only. HTTP 429 (rate limit) and 5xx (server) are
// transient; any non-HttpError (network/socket/DNS) is transient too. A 4xx other than 429 (e.g. 404
// / 400) is a real client error and is NOT retried.
export function IsTransient(Error: unknown): boolean {
  if (Error instanceof HttpError) return Error.Status === 429 || Error.Status >= 500;
  return true; // network-level error
}

export type BackoffOptions = {
  MaxAttempts?: number; // total tries for ONE request before giving up (default 4)
  BaseDelayMs?: number; // first backoff; doubles each attempt (default 500)
  MaxDelayMs?: number; // cap for a single backoff (default 30_000)
  Sleep?: (Ms: number) => Promise<void>; // injected in tests (no real waiting)
  OnRetry?: (Attempt: number, DelayMs: number, Reason: string) => void;
};

// Retry one async request with exponential backoff, honoring a server Retry-After hint when present.
// Throws the last error once attempts are exhausted or the error is non-transient.
export async function FetchWithBackoff<T>(
  Attempt: () => Promise<T>,
  Options: BackoffOptions = {},
  IsRetryable: (Error: unknown) => boolean = IsTransient,
): Promise<T> {
  const MaxAttempts = Options.MaxAttempts ?? 4;
  const Base = Options.BaseDelayMs ?? 500;
  const MaxDelay = Options.MaxDelayMs ?? 30_000;
  const Sleep = Options.Sleep ?? ((Ms: number): Promise<void> => new Promise((Resolve) => setTimeout(Resolve, Ms)));
  let LastError: unknown;
  for (let A = 1; A <= MaxAttempts; A++) {
    try {
      return await Attempt();
    } catch (Caught) {
      LastError = Caught;
      if (!IsRetryable(Caught) || A === MaxAttempts) throw Caught;
      const Hint = Caught instanceof HttpError ? Caught.RetryAfterMs : null;
      const Delay = Math.min(MaxDelay, Hint ?? Base * 2 ** (A - 1));
      Options.OnRetry?.(A, Delay, (Caught as Error).message);
      await Sleep(Delay);
    }
  }
  throw LastError;
}

// Trips after `Limit` CONSECUTIVE failures (a success resets the count) so a run stops cleanly instead
// of spinning through an endpoint that is down or persistently rate-limiting.
export class CircuitBreaker {
  private Consecutive = 0;
  constructor(private Limit: number) {}
  Success(): void {
    this.Consecutive = 0;
  }
  /** Record a failure; returns true when the breaker has now tripped. */
  Fail(): boolean {
    this.Consecutive += 1;
    return this.Consecutive >= this.Limit;
  }
  get Tripped(): boolean {
    return this.Consecutive >= this.Limit;
  }
}
