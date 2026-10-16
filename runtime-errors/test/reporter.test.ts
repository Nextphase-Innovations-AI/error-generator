import { describe, expect, it } from 'vitest';
import { ERROR_ROUTES } from '../src/catalogue.js';
import { ISSUE_LABEL, ISSUE_TITLE_PREFIX, issueBody, issueTitle, report } from '../src/reporter.js';
import type { FetchLike } from '../src/github.js';

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

/** Fakes both the error service and the GitHub API so no network is touched. */
function fakeFetch(openTitles: string[]): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (input, init) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, url: input, body });

    if (input.startsWith('http://service')) {
      const route = ERROR_ROUTES.find((entry) => input.endsWith(entry.path));
      if (!route) return Promise.resolve(new Response('not found', { status: 404 }));
      const payload = {
        error: {
          name: 'FakeError',
          message: `fake ${route.name}`,
          status: route.status,
          stack: `FakeError: fake ${route.name}\n    at fake (fake.ts:1:1)`,
        },
      };
      return Promise.resolve(Response.json(payload, { status: route.status }));
    }
    if (method === 'POST' && input.endsWith('/labels')) {
      return Promise.resolve(
        Response.json(
          { message: 'Validation Failed', errors: [{ code: 'already_exists' }] },
          { status: 422 },
        ),
      );
    }
    if (method === 'GET' && input.includes('/issues?')) {
      const issues = openTitles.map((title, index) => ({
        number: index + 1,
        title,
        html_url: `https://example.invalid/issues/${index + 1}`,
      }));
      return Promise.resolve(Response.json(issues));
    }
    if (method === 'POST' && input.endsWith('/issues')) {
      const title = (body as { title: string }).title;
      return Promise.resolve(
        Response.json(
          { number: 99, title, html_url: 'https://example.invalid/issues/99' },
          { status: 201 },
        ),
      );
    }
    return Promise.resolve(new Response('unexpected', { status: 500 }));
  };
  return { fetchImpl, calls };
}

const baseOptions = {
  baseUrl: 'http://service',
  repository: 'octo/test',
  token: 'synthetic-test-token-not-real', // SYNTHETIC: never sent anywhere, the fetch is faked.
  log: () => {},
};

describe('reporter', () => {
  it('builds a stable title with prefix, route name and status', () => {
    const route = ERROR_ROUTES[0];
    if (!route) throw new Error('catalogue is empty');
    const title = issueTitle({
      route,
      status: route.status,
      name: 'Error',
      message: 'm',
      stack: 's',
      capturedAt: 'now',
    });
    expect(title).toBe(`${ISSUE_TITLE_PREFIX} ${route.name} (HTTP ${route.status})`);
  });

  it('puts the stack trace in a fenced code block', () => {
    const route = ERROR_ROUTES[0];
    if (!route) throw new Error('catalogue is empty');
    const body = issueBody(
      {
        route,
        status: 500,
        name: 'Error',
        message: 'm',
        stack: 'Error: m\n    at x',
        capturedAt: 'now',
      },
      'http://service',
    );
    expect(body).toContain('```text\nError: m\n    at x\n```');
    expect(body).toContain('| HTTP status | 500 |');
  });

  it('creates one issue per route with the category label', async () => {
    const { fetchImpl, calls } = fakeFetch([]);
    const result = await report({ ...baseOptions, dryRun: false, fetchImpl });
    const creates = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/issues'));
    expect(creates).toHaveLength(ERROR_ROUTES.length);
    expect(result.created).toHaveLength(ERROR_ROUTES.length);
    expect(result.skipped).toHaveLength(0);
    for (const call of creates) {
      expect((call.body as { labels: string[] }).labels).toEqual([ISSUE_LABEL]);
    }
  });

  it('skips routes whose issue is already open', async () => {
    const existing = ERROR_ROUTES.slice(0, 3).map((route) =>
      issueTitle({ route, status: route.status, name: '', message: '', stack: '', capturedAt: '' }),
    );
    const { fetchImpl, calls } = fakeFetch(existing);
    const result = await report({ ...baseOptions, dryRun: false, fetchImpl });
    expect(result.skipped).toEqual(existing);
    expect(result.created).toHaveLength(ERROR_ROUTES.length - 3);
    const creates = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/issues'));
    expect(creates).toHaveLength(ERROR_ROUTES.length - 3);
  });

  it('calls no GitHub endpoint in dry-run mode', async () => {
    const { fetchImpl, calls } = fakeFetch([]);
    const lines: string[] = [];
    const result = await report({
      ...baseOptions,
      dryRun: true,
      fetchImpl,
      log: (line) => lines.push(line),
    });
    expect(calls.every((call) => call.url.startsWith('http://service'))).toBe(true);
    expect(result.created).toHaveLength(ERROR_ROUTES.length);
    expect(lines.filter((line) => line.startsWith('[dry-run] would create'))).toHaveLength(
      ERROR_ROUTES.length,
    );
  });
});
