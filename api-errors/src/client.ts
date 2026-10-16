import { parseArgs } from 'node:util';
import { withBackoff, type RateLimitHeaders } from './backoff.js';

export const GITHUB_API_BASE = 'https://api.github.com';
export const GITHUB_API_VERSION = '2022-11-28';

/** Headers worth logging for every error response. */
export const RELEVANT_HEADERS = [
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-used',
  'x-ratelimit-resource',
  'retry-after',
  'x-github-request-id',
  'etag',
  'x-accepted-github-permissions',
  'x-accepted-oauth-scopes',
  'x-oauth-scopes',
] as const;

// SYNTHETIC: deliberately malformed so GitHub answers 401. It has no token prefix on purpose,
// so secret scanning never mistakes it for a credential.
export const MALFORMED_TOKEN = 'not-a-real-token';
export const NONEXISTENT_REPOSITORY =
  'error-generator-nonexistent-owner-7f3c/this-repository-does-not-exist';
/** A public repository nobody running this script administers. */
export const PUBLIC_REPOSITORY_WITHOUT_ADMIN = 'octocat/Hello-World';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CaseContext {
  token: string;
  repository: string;
  fetchImpl: FetchLike;
  apiBase: string;
}

export interface RequestRecord {
  method: string;
  url: string;
  status: number;
  message: string;
  headers: Record<string, string>;
}

export interface CaseResult {
  name: string;
  expectedStatus: number;
  description: string;
  requests: RequestRecord[];
  notes: string[];
}

export interface ApiErrorCase {
  name: string;
  expectedStatus: number;
  description: string;
  run(context: CaseContext): Promise<CaseResult>;
}

export function pickHeaders(headers: Headers): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of RELEVANT_HEADERS) {
    const value = headers.get(name);
    if (value !== null) picked[name] = value;
  }
  return picked;
}

export async function sendOnce(
  context: CaseContext,
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<RequestRecord> {
  const url = `${context.apiBase}${path}`;
  const response = await context.fetchImpl(url, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${options.token ?? context.token}`,
      'x-github-api-version': GITHUB_API_VERSION,
      'user-agent': 'error-generator-api-errors',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let message = '';
  try {
    const parsed = JSON.parse(text) as { message?: string; errors?: unknown };
    message = parsed.message ?? '';
    if (parsed.errors) message += ` ${JSON.stringify(parsed.errors)}`;
  } catch {
    message = text.slice(0, 200);
  }
  return { method, url, status: response.status, message, headers: pickHeaders(response.headers) };
}

const makeCase = (
  name: string,
  expectedStatus: number,
  description: string,
  run: (context: CaseContext, result: CaseResult) => Promise<void>,
): ApiErrorCase => ({
  name,
  expectedStatus,
  description,
  async run(context) {
    const result: CaseResult = { name, expectedStatus, description, requests: [], notes: [] };
    await run(context, result);
    return result;
  },
});

export const API_ERROR_CASES: readonly ApiErrorCase[] = [
  makeCase(
    '401-unauthorized',
    401,
    'GET /user with an obviously malformed token',
    async (ctx, r) => {
      r.requests.push(await sendOnce(ctx, 'GET', '/user', { token: MALFORMED_TOKEN }));
    },
  ),
  makeCase(
    '403-forbidden',
    403,
    `GET /repos/${PUBLIC_REPOSITORY_WITHOUT_ADMIN}/actions/secrets, which needs admin rights the token lacks`,
    async (ctx, r) => {
      r.requests.push(
        await sendOnce(ctx, 'GET', `/repos/${PUBLIC_REPOSITORY_WITHOUT_ADMIN}/actions/secrets`),
      );
      r.notes.push(
        'A user token answers "You must have repository read permissions or have the repository secrets fine-grained permission"; the Actions GITHUB_TOKEN answers "Resource not accessible by integration". Both are 403.',
      );
    },
  ),
  makeCase('404-not-found', 404, `GET /repos/${NONEXISTENT_REPOSITORY}`, async (ctx, r) => {
    r.requests.push(await sendOnce(ctx, 'GET', `/repos/${NONEXISTENT_REPOSITORY}`));
  }),
  makeCase(
    '422-unprocessable-entity',
    422,
    'POST /repos/{repo}/issues with an empty body, so the required title is missing',
    async (ctx, r) => {
      r.requests.push(await sendOnce(ctx, 'POST', `/repos/${ctx.repository}/issues`, { body: {} }));
      r.notes.push('Nothing is created: validation rejects the request before any write.');
    },
  ),
  makeCase(
    '304-not-modified',
    304,
    'GET /repos/{repo} with If-None-Match set to the ETag of a priming request',
    async (ctx, r) => {
      const priming = await sendOnce(ctx, 'GET', `/repos/${ctx.repository}`);
      r.requests.push(priming);
      const etag = priming.headers['etag'];
      if (!etag) {
        r.notes.push('Priming request returned no ETag; the conditional request was skipped.');
        return;
      }
      r.requests.push(
        await sendOnce(ctx, 'GET', `/repos/${ctx.repository}`, {
          headers: { 'if-none-match': etag },
        }),
      );
      r.notes.push(
        'This is the only case that makes two requests: the first one exists solely to obtain the ETag. A 304 does not count against the rate limit.',
      );
    },
  ),
  makeCase(
    '429-rate-limit',
    429,
    'GET /rate_limit to read the live budget, then back-off demonstrated against a mocked 429',
    async (ctx, r) => {
      r.requests.push(await sendOnce(ctx, 'GET', '/rate_limit'));
      r.notes.push(
        'Exhausting the real limit is deliberately out of scope. The mocked exchange below shows the back-off logic in api-errors/src/backoff.ts.',
      );
      const mock = mockedRateLimitedSend();
      const outcome = await withBackoff(mock, {
        maxAttempts: 3,
        sleep: async () => {},
        onWait: (attempt, seconds, reason) =>
          r.notes.push(`mock attempt ${attempt}: 429, would wait ${seconds}s (${reason})`),
      });
      r.requests.push(...mock.history);
      r.notes.push(`mock: succeeded after ${outcome.attempts} attempts`);
    },
  ),
];

interface MockSend {
  (): Promise<RequestRecord & { headers: RateLimitHeaders & Record<string, string> }>;
}

/** Two synthetic 429 answers (retry-after, then reset-based), then a 200. No network involved. */
function mockedRateLimitedSend(): MockSend & { history: RequestRecord[] } {
  const history: RequestRecord[] = [];
  const answers: RequestRecord[] = [
    {
      method: 'GET',
      url: 'mock://api.github.com/rate-limited',
      status: 429,
      message: 'API rate limit exceeded (mocked)',
      headers: { 'retry-after': '2', 'x-ratelimit-remaining': '0' },
    },
    {
      method: 'GET',
      url: 'mock://api.github.com/rate-limited',
      status: 429,
      message: 'API rate limit exceeded (mocked)',
      headers: {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3),
      },
    },
    {
      method: 'GET',
      url: 'mock://api.github.com/rate-limited',
      status: 200,
      message: 'ok (mocked)',
      headers: { 'x-ratelimit-remaining': '4999' },
    },
  ];
  const send = (() => {
    const next = answers.shift();
    if (!next) return Promise.reject(new Error('mock exhausted'));
    history.push(next);
    return Promise.resolve(next);
  }) as MockSend & { history: RequestRecord[] };
  send.history = history;
  return send;
}

export async function runCases(
  context: CaseContext,
  only?: string,
  log: (line: string) => void = console.log,
): Promise<CaseResult[]> {
  const selected = API_ERROR_CASES.filter((entry) => !only || entry.name === only);
  if (selected.length === 0) throw new Error(`unknown case "${only}"`);
  const results: CaseResult[] = [];
  for (const entry of selected) {
    const result = await entry.run(context);
    results.push(result);
    const observed = result.requests.some((request) => request.status === result.expectedStatus);
    const verdict = observed ? 'observed as expected' : 'NOT OBSERVED';
    log(`\n=== ${result.name}: ${result.description}`);
    for (const request of result.requests) {
      log(`${request.method} ${request.url}`);
      log(`  status:  ${request.status}`);
      log(`  message: ${request.message || '(empty)'}`);
      for (const [name, value] of Object.entries(request.headers)) {
        log(`  ${name}: ${value}`);
      }
    }
    for (const note of result.notes) log(`  note: ${note}`);
    log(`  expected HTTP ${result.expectedStatus}: ${verdict}`);
  }
  return results;
}

const isMain = process.argv[1]?.endsWith('client.ts') ?? false;
if (isMain) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      case: { type: 'string' },
      repository: { type: 'string', default: process.env['GITHUB_REPOSITORY'] ?? '' },
    },
  });
  const token = process.env['GITHUB_TOKEN'] ?? '';
  if (!token) {
    console.error('GITHUB_TOKEN is required (for example: export GITHUB_TOKEN=$(gh auth token))');
    process.exit(1);
  }
  if (!values.repository) {
    console.error('GITHUB_REPOSITORY (owner/repo) or --repository is required');
    process.exit(1);
  }
  runCases(
    {
      token,
      repository: values.repository,
      fetchImpl: (input, init) => fetch(input, init),
      apiBase: GITHUB_API_BASE,
    },
    values.case,
  ).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
