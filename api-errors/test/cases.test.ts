import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CASES,
  MALFORMED_TOKEN,
  NONEXISTENT_REPOSITORY,
  pickHeaders,
  runCases,
  type CaseContext,
  type FetchLike,
} from '../src/client.js';

interface Seen {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/** Answers every GitHub call with the status the case expects, recording what was sent. */
function fakeGitHub(): { fetchImpl: FetchLike; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl: FetchLike = (input, init) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    const method = init?.method ?? 'GET';
    seen.push({
      method,
      url: input,
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const path = new URL(input).pathname;
    const common = { 'x-github-request-id': 'FAKE:0001', 'x-ratelimit-remaining': '4999' };

    if (headers['authorization'] === `Bearer ${MALFORMED_TOKEN}`) {
      return Promise.resolve(
        Response.json({ message: 'Bad credentials' }, { status: 401, headers: common }),
      );
    }
    if (path.endsWith('/actions/secrets')) {
      return Promise.resolve(
        Response.json(
          { message: 'Must have admin rights to Repository.' },
          { status: 403, headers: common },
        ),
      );
    }
    if (path.startsWith(`/repos/${NONEXISTENT_REPOSITORY}`)) {
      return Promise.resolve(
        Response.json({ message: 'Not Found' }, { status: 404, headers: common }),
      );
    }
    if (method === 'POST' && path.endsWith('/issues')) {
      return Promise.resolve(
        Response.json(
          { message: 'Validation Failed', errors: [{ field: 'title', code: 'missing_field' }] },
          { status: 422, headers: common },
        ),
      );
    }
    if (path === '/repos/octo/test') {
      if (headers['if-none-match'] === '"abc"') {
        return Promise.resolve(
          new Response(null, { status: 304, headers: { ...common, etag: '"abc"' } }),
        );
      }
      return Promise.resolve(
        Response.json({ full_name: 'octo/test' }, { headers: { ...common, etag: '"abc"' } }),
      );
    }
    if (path === '/rate_limit') {
      return Promise.resolve(
        Response.json(
          { resources: { core: { limit: 5000, remaining: 4999 } } },
          { headers: common },
        ),
      );
    }
    return Promise.resolve(new Response('unexpected', { status: 500 }));
  };
  return { fetchImpl, seen };
}

const context = (fetchImpl: FetchLike): CaseContext => ({
  token: 'synthetic-test-token-not-real', // SYNTHETIC: only ever sent to the fake above.
  repository: 'octo/test',
  fetchImpl,
  apiBase: 'https://api.github.test',
});

describe('pickHeaders', () => {
  it('keeps only the relevant headers', () => {
    const headers = new Headers({
      'x-ratelimit-remaining': '1',
      etag: '"x"',
      'content-type': 'application/json',
    });
    expect(pickHeaders(headers)).toEqual({ 'x-ratelimit-remaining': '1', etag: '"x"' });
  });
});

describe('API error cases', () => {
  it('covers every documented status exactly once', () => {
    expect(API_ERROR_CASES.map((entry) => entry.expectedStatus).sort()).toEqual(
      [304, 401, 403, 404, 422, 429].sort(),
    );
  });

  it('every case except 304 makes exactly one network request', async () => {
    for (const entry of API_ERROR_CASES) {
      const { fetchImpl, seen } = fakeGitHub();
      await entry.run(context(fetchImpl));
      expect(seen.length, entry.name).toBe(entry.name === '304-not-modified' ? 2 : 1);
    }
  });

  it('receives the expected status for every case', async () => {
    const { fetchImpl } = fakeGitHub();
    const results = await runCases(context(fetchImpl), undefined, () => {});
    for (const result of results) {
      const statuses = result.requests.map((request) => request.status);
      expect(statuses, result.name).toContain(result.expectedStatus);
    }
  });

  it('sends the malformed token only for the 401 case', async () => {
    const { fetchImpl, seen } = fakeGitHub();
    await runCases(context(fetchImpl), undefined, () => {});
    const malformed = seen.filter(
      (s) => s.headers['authorization'] === `Bearer ${MALFORMED_TOKEN}`,
    );
    expect(malformed).toHaveLength(1);
    expect(malformed[0]?.url).toContain('/user');
  });

  it('posts an empty body for the 422 case', async () => {
    const { fetchImpl, seen } = fakeGitHub();
    await runCases(context(fetchImpl), '422-unprocessable-entity', () => {});
    expect(seen[0]?.method).toBe('POST');
    expect(seen[0]?.body).toBe('{}');
  });

  it('demonstrates back-off against the mocked 429 without sleeping', async () => {
    const { fetchImpl } = fakeGitHub();
    const started = Date.now();
    const [result] = await runCases(context(fetchImpl), '429-rate-limit', () => {});
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result?.requests.filter((r) => r.status === 429)).toHaveLength(2);
    expect(result?.notes.some((n) => n.includes('retry-after header'))).toBe(true);
    expect(result?.notes.some((n) => n.includes('x-ratelimit-reset header'))).toBe(true);
  });
});
