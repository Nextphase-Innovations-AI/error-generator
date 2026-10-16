import { describe, expect, it } from 'vitest';
import { decideWait, isRateLimited, withBackoff } from '../src/backoff.js';

const settings = { baseDelaySeconds: 1, maxDelaySeconds: 60, now: () => 1_000_000 * 1000 };

describe('isRateLimited', () => {
  it('treats 429 as rate limited', () => {
    expect(isRateLimited(429, {})).toBe(true);
  });
  it('treats 403 with no remaining budget as rate limited', () => {
    expect(isRateLimited(403, { 'x-ratelimit-remaining': '0' })).toBe(true);
    expect(isRateLimited(403, { 'x-ratelimit-remaining': '12' })).toBe(false);
  });
  it('never retries other statuses', () => {
    expect(isRateLimited(200, {})).toBe(false);
    expect(isRateLimited(404, { 'x-ratelimit-remaining': '0' })).toBe(false);
  });
});

describe('decideWait', () => {
  it('prefers retry-after', () => {
    expect(decideWait(1, { 'retry-after': '7', 'x-ratelimit-reset': '1' }, settings)).toEqual({
      seconds: 7,
      reason: 'retry-after header',
    });
  });
  it('waits until the reset when the budget is exhausted', () => {
    const reset = String(1_000_000 + 30);
    expect(
      decideWait(1, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }, settings),
    ).toEqual({ seconds: 30, reason: 'x-ratelimit-reset header' });
  });
  it('falls back to exponential growth capped at the maximum', () => {
    expect(decideWait(1, {}, settings).seconds).toBe(1);
    expect(decideWait(3, {}, settings).seconds).toBe(4);
    expect(decideWait(10, {}, settings).seconds).toBe(60);
  });
});

describe('withBackoff', () => {
  const answer = (status: number, headers: Record<string, string> = {}) => ({ status, headers });

  it('returns immediately on success without sleeping', async () => {
    const sleeps: number[] = [];
    const outcome = await withBackoff(() => Promise.resolve(answer(200)), {
      sleep: (s) => {
        sleeps.push(s);
        return Promise.resolve();
      },
    });
    expect(outcome.attempts).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('retries after a 429 and honours retry-after', async () => {
    const answers = [answer(429, { 'retry-after': '2' }), answer(200)];
    const sleeps: number[] = [];
    const outcome = await withBackoff(() => Promise.resolve(answers.shift() ?? answer(500)), {
      sleep: (s) => {
        sleeps.push(s);
        return Promise.resolve();
      },
    });
    expect(outcome.attempts).toBe(2);
    expect(sleeps).toEqual([2]);
    expect(outcome.result.status).toBe(200);
  });

  it('gives up after maxAttempts and returns the last 429', async () => {
    let calls = 0;
    const outcome = await withBackoff(
      () => {
        calls += 1;
        return Promise.resolve(answer(429, { 'retry-after': '1' }));
      },
      { maxAttempts: 3, sleep: () => Promise.resolve() },
    );
    expect(calls).toBe(3);
    expect(outcome.attempts).toBe(3);
    expect(outcome.waits).toHaveLength(2);
    expect(outcome.result.status).toBe(429);
  });

  it('does not retry a 404', async () => {
    let calls = 0;
    await withBackoff(() => {
      calls += 1;
      return Promise.resolve(answer(404));
    });
    expect(calls).toBe(1);
  });
});
