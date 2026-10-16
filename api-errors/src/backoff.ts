/**
 * Back-off for GitHub rate limiting, following the documented guidance: honour `retry-after`
 * first, then wait until `x-ratelimit-reset` when the remaining budget is zero, otherwise grow
 * exponentially from one second. Never more than `maxAttempts` requests in total.
 */
export interface RateLimitHeaders {
  'retry-after'?: string;
  'x-ratelimit-remaining'?: string;
  'x-ratelimit-reset'?: string;
}

export interface BackoffOptions {
  maxAttempts?: number;
  /** Seconds, used when neither header gives a deadline. */
  baseDelaySeconds?: number;
  /** Upper bound for a single wait in seconds. */
  maxDelaySeconds?: number;
  now?: () => number;
  sleep?: (seconds: number) => Promise<void>;
  onWait?: (attempt: number, seconds: number, reason: string) => void;
}

export interface BackoffDecision {
  seconds: number;
  reason: string;
}

export function isRateLimited(status: number, headers: RateLimitHeaders): boolean {
  if (status === 429) return true;
  return status === 403 && headers['x-ratelimit-remaining'] === '0';
}

export function decideWait(
  attempt: number,
  headers: RateLimitHeaders,
  options: Required<Pick<BackoffOptions, 'baseDelaySeconds' | 'maxDelaySeconds' | 'now'>>,
): BackoffDecision {
  const retryAfter = Number(headers['retry-after']);
  if (headers['retry-after'] !== undefined && Number.isFinite(retryAfter) && retryAfter >= 0) {
    return { seconds: Math.min(retryAfter, options.maxDelaySeconds), reason: 'retry-after header' };
  }
  const reset = Number(headers['x-ratelimit-reset']);
  if (headers['x-ratelimit-remaining'] === '0' && Number.isFinite(reset) && reset > 0) {
    const untilReset = Math.max(0, reset - Math.floor(options.now() / 1000));
    return {
      seconds: Math.min(untilReset, options.maxDelaySeconds),
      reason: 'x-ratelimit-reset header',
    };
  }
  const exponential = options.baseDelaySeconds * 2 ** (attempt - 1);
  return {
    seconds: Math.min(exponential, options.maxDelaySeconds),
    reason: 'exponential back-off',
  };
}

export interface BackoffOutcome<T> {
  result: T;
  attempts: number;
  waits: BackoffDecision[];
}

/** `send` performs exactly one request and reports its status and rate-limit headers. */
export async function withBackoff<T extends { status: number; headers: RateLimitHeaders }>(
  send: () => Promise<T>,
  options: BackoffOptions = {},
): Promise<BackoffOutcome<T>> {
  const maxAttempts = options.maxAttempts ?? 3;
  const settings = {
    baseDelaySeconds: options.baseDelaySeconds ?? 1,
    maxDelaySeconds: options.maxDelaySeconds ?? 60,
    now: options.now ?? Date.now,
  };
  const sleep = options.sleep ?? defaultSleep;
  const waits: BackoffDecision[] = [];

  for (let attempt = 1; ; attempt += 1) {
    const result = await send();
    if (!isRateLimited(result.status, result.headers) || attempt >= maxAttempts) {
      return { result, attempts: attempt, waits };
    }
    const decision = decideWait(attempt, result.headers, settings);
    waits.push(decision);
    options.onWait?.(attempt, decision.seconds, decision.reason);
    await sleep(decision.seconds);
  }
}

function defaultSleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}
