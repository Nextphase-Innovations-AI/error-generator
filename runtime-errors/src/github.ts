export const GITHUB_API_BASE = 'https://api.github.com';
export const GITHUB_API_VERSION = '2022-11-28';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GitHubClientOptions {
  token: string;
  repository: string;
  fetchImpl?: FetchLike;
  apiBase?: string;
}

export interface IssueSummary {
  number: number;
  title: string;
  html_url: string;
}

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: string,
  ) {
    super(`${method} ${path} failed with HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = 'GitHubApiError';
  }
}

/** Minimal REST client: only the calls the reporter needs, one request per call, no retries. */
export class GitHubClient {
  private readonly fetchImpl: FetchLike;
  private readonly apiBase: string;

  constructor(private readonly options: GitHubClientOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.apiBase = options.apiBase ?? GITHUB_API_BASE;
  }

  async listOpenIssues(label: string): Promise<IssueSummary[]> {
    const issues: IssueSummary[] = [];
    // Bounded pagination: the reporter never creates more than ERROR_ROUTES.length issues.
    for (let page = 1; page <= 5; page += 1) {
      const query = new URLSearchParams({
        state: 'open',
        labels: label,
        per_page: '100',
        page: String(page),
      });
      const batch = await this.request<IssueSummary[]>(
        'GET',
        `/repos/${this.options.repository}/issues?${query.toString()}`,
      );
      issues.push(...batch);
      if (batch.length < 100) break;
    }
    return issues;
  }

  async ensureLabel(name: string, color: string, description: string): Promise<void> {
    try {
      await this.request('POST', `/repos/${this.options.repository}/labels`, {
        name,
        color,
        description,
      });
    } catch (error) {
      // 422 "already_exists" is the expected answer on every run after the first.
      if (error instanceof GitHubApiError && error.status === 422) return;
      throw error;
    }
  }

  async createIssue(title: string, body: string, labels: string[]): Promise<IssueSummary> {
    return this.request<IssueSummary>('POST', `/repos/${this.options.repository}/issues`, {
      title,
      body,
      labels,
    });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.apiBase}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.options.token}`,
        'x-github-api-version': GITHUB_API_VERSION,
        'user-agent': 'error-generator-reporter',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new GitHubApiError(response.status, method, path, text);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
