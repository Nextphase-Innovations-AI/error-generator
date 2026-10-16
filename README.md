# error-generator

A small, self-contained repository whose only purpose is to deliberately produce one example of
every kind of error GitHub can surface, so an issue-monitoring tool can be exercised against a
known set of red signals. Nothing here is accidental: every failure is labelled `INTENTIONAL` in
the code, is reproducible, and is triggered on demand.

The default branch is always green: `yarn install && yarn typecheck && yarn lint && yarn test`
passes. Failures live in fixtures that the root scripts exclude, and are triggered by explicit
workflows, scripts or `ci-error/*` branches.

## Stack

Mirrors the stack of the Issue-monitoring project: Node 22.15, Yarn 4.10.3 (corepack),
TypeScript 5.9, Vitest 4, ESLint 9 with typescript-eslint, Prettier 3.6, `tsx` for running
TypeScript directly, and Express 5 for the HTTP service. Nothing else was added. The
`trigger-all` and `reset` scripts are plain Bash around the `gh` CLI.

## Layout

| Path                 | Category                                        |
| -------------------- | ----------------------------------------------- |
| `.github/workflows/` | Every workflow (categories 1, 2 and 3)          |
| `actions-failures/`  | Category 1: fixtures that fail on purpose       |
| `security-alerts/`   | Category 2: Dependabot, CodeQL, secret scanning |
| `runtime-errors/`    | Category 3: Express service and issue reporter  |
| `api-errors/`        | Category 4: GitHub REST API error client        |
| `scripts/`           | `trigger-all`, `reset`, Yarn guard              |

## Quick start

```bash
corepack enable
yarn install
yarn typecheck && yarn lint && yarn format:check && yarn test
```

See [SETUP.md](SETUP.md) for creating the test repository, enabling the security features and
the first trigger run.

## Error table

How to read the columns: **Where** is the GitHub surface the error appears on. **Trigger** is
the on-demand action. **Verify** is how to see that it appeared. **Reset** is how to clear it.
`T` is shorthand for `scripts/trigger-all`, `R` for `scripts/reset`.

### Category 1: GitHub Actions workflow failures

Every workflow runs on `workflow_dispatch` and on a push to its own branch
`ci-error/<name>`, so one dispatch or one branch push produces exactly one failure of a known
kind. `T --category 1` does both for every workflow. All ten appear under **Actions** as a failed
run and are verified with `gh run list --workflow <file>`; a run is reset only by the normal
history (it stays listed), while `R` deletes the `ci-error/*` branches.

| Error                     | Where                                | Trigger                                                                                        | Verify                                                             | Reset                                         |
| ------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------- |
| Build or compile error    | Actions run `build-error.yml`        | `gh workflow run build-error.yml` or push `ci-error/build-error`                               | Run fails in step "Compile a file that does not parse" with TS1005 | Nothing to reset; `R` removes branch          |
| Failing unit test         | Actions run `failing-test.yml`       | `gh workflow run failing-test.yml` or push `ci-error/failing-test`                             | Vitest reports 1 failed test                                       | `R` removes branch                            |
| Lint error                | Actions run `lint-error.yml`         | `gh workflow run lint-error.yml` or push `ci-error/lint-error`                                 | ESLint reports `no-unused-vars` and `no-undef`                     | `R` removes branch                            |
| Type-check error          | Actions run `type-error.yml`         | `gh workflow run type-error.yml` or push `ci-error/type-error`                                 | tsc reports TS2322                                                 | `R` removes branch                            |
| Job timeout               | Actions run `timeout.yml`            | `gh workflow run timeout.yml` or push `ci-error/timeout`                                       | Step fails with "has timed out after 1 minutes"                    | `R` removes branch                            |
| Missing required secret   | Actions run `missing-secret.yml`     | `gh workflow run missing-secret.yml` or push `ci-error/missing-secret`                         | Error annotation "Missing secret"                                  | `R` removes branch                            |
| Invalid workflow YAML     | Actions, run for `invalid-yaml.yml`  | `T --category 1` pushes `ci-error/invalid-yaml` with the file copied into `.github/workflows/` | Run with conclusion `startup_failure`: "Invalid workflow file"     | `R` removes branch; file never reaches `main` |
| Non-zero shell exit       | Actions run `shell-exit.yml`         | `gh workflow run shell-exit.yml` or push `ci-error/shell-exit`                                 | Step fails with exit code 7                                        | `R` removes branch                            |
| Failed dependency install | Actions run `dependency-install.yml` | `gh workflow run dependency-install.yml` or push `ci-error/dependency-install`                 | `yarn add` fails: package not found on the registry                | `R` removes branch                            |
| One failing matrix cell   | Actions run `matrix-one-cell.yml`    | `gh workflow run matrix-one-cell.yml` or push `ci-error/matrix-one-cell`                       | Cells `passes-a`, `passes-b` green, `fails` red                    | `R` removes branch                            |
| Healthy control (passes)  | Actions run `healthy.yml`            | `gh workflow run healthy.yml`, any push to `main`, any pull request                            | Green run                                                          | Not applicable                                |

Notes:

- The invalid-YAML file is kept at `actions-failures/invalid-yaml/invalid-yaml.yml`, outside
  `.github/workflows/`, so that it is inert on `main`. If it lived in `.github/workflows/`, GitHub
  would report the parse error on every push to every branch, which removes your control over
  when the error appears. `trigger-all` commits it into place on the `ci-error/invalid-yaml`
  branch only, using Git plumbing so your working tree is untouched. `workflow_dispatch` cannot
  be used for this one: GitHub refuses to dispatch a workflow it cannot parse.
- The timeout is a step-level `timeout-minutes: 1` with a bounded `sleep 100`, inside a job-level
  `timeout-minutes: 3`. A step timeout is always reported as `failure`.
- Exceeding artifact or log size limits is out of scope by design.

### Category 2: Security and code-quality alerts

These depend on repository settings you must enable; see [SETUP.md](SETUP.md#3-enable-the-security-features).
On a private repository, code scanning, dependency review and secret scanning need GitHub Code
Security and Secret Protection; Dependabot alerts are free everywhere. All four were confirmed on
a public repository: every alert type appeared within minutes of the first push.

| Error                        | Where                                                        | Trigger                                                                                                                                              | Verify                                                                                                                                                                                           | Reset                                                  |
| ---------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Dependabot alert             | Security > Dependabot                                        | Present on `main`: `security-alerts/vulnerable-manifest/package.json` pins `lodash@4.17.20`                                                          | Five alerts for the one pin: GHSA-35jh-r3h4-6jhm, GHSA-29mw-wpgm-hmr9, GHSA-xxjr-mmjv-4gpg, GHSA-f23m-r3pf-42rh, GHSA-r5fr-rjxr-66jc; `gh api repos/{owner}/{repo}/dependabot/alerts`            | Dismiss the alert in the Security tab, or bump the pin |
| Code scanning alert (CodeQL) | Security > Code scanning                                     | `gh workflow run codeql.yml` (also runs on push to `main` and on pull requests)                                                                      | Alert `js/command-line-injection` on `security-alerts/codeql/command-injection.ts` (the same handler also yields `js/missing-rate-limiting`); `gh api repos/{owner}/{repo}/code-scanning/alerts` | Dismiss in the Security tab                            |
| Secret scanning alert        | Security > Secret scanning                                   | Present on `main`: `security-alerts/secret-scanning/synthetic-secret.txt`                                                                            | Alert "Slack Incoming Webhook URL"; `gh api repos/{owner}/{repo}/secret-scanning/alerts`                                                                                                         | Close the alert as "Used in tests"                     |
| Dependency review failure    | Checks on the pull request from `ci-error/dependency-review` | `T --category 2` creates the branch adding `security-alerts/dependency-review/package.json` (`minimist@1.2.5`, GHSA-xvch-5gv4-984h) and opens the PR | `dependency-review.yml` check fails on the PR; `gh pr checks`                                                                                                                                    | `R` closes the PR and deletes the branch               |

Notes:

- The vulnerable manifest is not a Yarn workspace and is never installed, so `node_modules` never
  contains the vulnerable code. Dependabot still reads it because it scans every manifest.
- The CodeQL target is an Express handler registered on an app that never listens and is never
  imported by the runtime service, so it cannot execute. CodeQL analyses files regardless of
  reachability. The `codeql.yml` workflow uses the `security-extended` query suite with
  `build-mode: none`.
- The secret-scanning string is a synthetic Slack incoming-webhook URL: correct shape, never
  issued by Slack, pointing at no workspace. **Push protection may block the push** that adds it.
  GitHub prints an unblock URL in the rejected push; open it, choose "It's used in tests", and
  push again. Do this for the test repository only. Details in [SETUP.md](SETUP.md#5-push-protection).
- `dependency-review.yml` uses `fail-on-severity: low`, so any advisory fails the check. It needs
  the dependency graph enabled, and runs only on `pull_request`, which is why the trigger is a
  pull request rather than a push.

### Category 3: Runtime errors reported as GitHub Issues

`runtime-errors/src/app.ts` is an Express 5 service with one route per error under `/errors/`.
Every route always responds with the status in the table and a JSON body
`{ error: { name, message, status, stack } }`. `GET /errors` lists the catalogue, `GET /health`
answers 200.

| Error                       | Route                         | HTTP | Error name                  |
| --------------------------- | ----------------------------- | ---- | --------------------------- |
| Unhandled exception         | `/errors/unhandled-exception` | 500  | `Error`                     |
| Null or undefined reference | `/errors/null-reference`      | 500  | `TypeError`                 |
| Type error                  | `/errors/type-error`          | 500  | `TypeError`                 |
| Out-of-range or index error | `/errors/index-out-of-range`  | 500  | `RangeError`                |
| Request timeout             | `/errors/request-timeout`     | 408  | `RequestTimeoutError`       |
| HTTP 400                    | `/errors/http-400`            | 400  | `BadRequestError`           |
| HTTP 401                    | `/errors/http-401`            | 401  | `UnauthorizedError`         |
| HTTP 403                    | `/errors/http-403`            | 403  | `ForbiddenError`            |
| HTTP 404                    | `/errors/http-404`            | 404  | `NotFoundError`             |
| HTTP 409                    | `/errors/http-409`            | 409  | `ConflictError`             |
| HTTP 422                    | `/errors/http-422`            | 422  | `UnprocessableEntityError`  |
| HTTP 429                    | `/errors/http-429`            | 429  | `TooManyRequestsError`      |
| HTTP 500                    | `/errors/http-500`            | 500  | `InternalServerErrorError`  |
| HTTP 502                    | `/errors/http-502`            | 502  | `BadGatewayError`           |
| HTTP 503                    | `/errors/http-503`            | 503  | `ServiceUnavailableError`   |
| Unhandled promise rejection | `/errors/unhandled-rejection` | 500  | `UnhandledPromiseRejection` |
| Out-of-memory simulation    | `/errors/out-of-memory`       | 500  | `OutOfMemorySimulation`     |

Where, trigger, verify and reset are the same for all seventeen:

| Where                                                                     | Trigger                                                                                                                | Verify                                                                                                     | Reset                                                                  |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Issues, label `runtime-errors`, title prefix `[error-generator] runtime:` | `gh workflow run report-runtime-errors.yml` (what `T --category 3` does), or locally `yarn start &` then `yarn report` | `gh issue list --label runtime-errors` shows 17 open issues, each with the status and a fenced stack trace | `R` closes them; the reporter re-creates only the ones that are closed |

Notes:

- The out-of-memory route allocates a single 64 MiB buffer and then throws; it never grows and
  never approaches the real heap limit. The request-timeout route waits 1000 ms and then fails
  with 408; the reporter's own per-route timeout is 5000 ms.
- Node 22 terminates a process on an unhandled rejection, so the service installs an
  `unhandledRejection` listener (`runtime-errors/src/rejection-sink.ts`) that records the
  rejection; the route then reports it with HTTP 500 and the process stays alive.
- The reporter (`runtime-errors/src/reporter.ts`) is idempotent: it lists open issues with the
  label and skips any whose title already exists. `yarn report --dry-run` prints every issue it
  would create without touching the API. It reads `GITHUB_TOKEN` and `GITHUB_REPOSITORY`; the
  workflow uses the built-in Actions token with `issues: write`.
- Tests start the service in a child process and walk every route (`yarn test`).

### Category 4: GitHub REST API error responses

`yarn api-errors` (`api-errors/src/client.ts`) makes exactly one request per case and logs the
status, the message and the relevant headers (`x-ratelimit-*`, `retry-after`,
`x-github-request-id`, `etag`, scope and permission headers). It needs `GITHUB_TOKEN` and
`GITHUB_REPOSITORY`; `T --category 4` sets both from `gh`. `--case <name>` runs one case.

| Error                      | Where         | Trigger (request)                                                                             | Verify                                                                                          | Reset          |
| -------------------------- | ------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------- |
| 401 Unauthorized           | Script output | `GET /user` with the malformed token `not-a-real-token`                                       | `status: 401`, `message: Bad credentials`                                                       | Not applicable |
| 403 Forbidden              | Script output | `GET /repos/octocat/Hello-World/actions/secrets` (needs admin rights nobody running this has) | `status: 403`, message about missing repository permission                                      | Not applicable |
| 404 Not Found              | Script output | `GET /repos/error-generator-nonexistent-owner-7f3c/this-repository-does-not-exist`            | `status: 404`, `message: Not Found`                                                             | Not applicable |
| 422 Unprocessable Entity   | Script output | `POST /repos/{repo}/issues` with body `{}`                                                    | `status: 422`, `Validation Failed`, `title` `missing_field`; nothing is created                 | Not applicable |
| 304 Not Modified           | Script output | `GET /repos/{repo}` with `If-None-Match` set to the ETag of a priming request                 | `status: 304`, empty message                                                                    | Not applicable |
| 429 / secondary rate limit | Script output | `GET /rate_limit` for the live budget, then back-off against a mocked 429                     | Two mocked 429 answers, waits computed from `retry-after` and `x-ratelimit-reset`, then success | Not applicable |

Notes:

- The 304 case is the only one that makes two requests; the first exists solely to obtain the
  ETag. A 304 does not count against the rate limit.
- The rate limit is deliberately never exhausted: doing so would require thousands of requests
  and would disturb anything else using the same token. Instead the live `/rate_limit` endpoint
  is read once, and the back-off logic in `api-errors/src/backoff.ts` is demonstrated against a
  mocked exchange: a 429 with `retry-after`, a 429 with `x-ratelimit-remaining: 0` and
  `x-ratelimit-reset`, then a 200. The mock's sleeps are skipped, so the demo is instant. Unit
  tests cover the back-off rules.
- Nothing retries except the back-off demo, which is capped at three attempts and runs only
  against the mock.

## Scripts

| Command                                                         | Purpose                                                                                                                                 |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/trigger-all [--category N]`                            | Dispatch every workflow, push every `ci-error/*` branch, open the dependency-review PR, run the API client. `--dry-run` prints instead. |
| `scripts/reset`                                                 | Close `runtime-errors` issues, close the dependency-review PR, delete `ci-error/*` branches.                                            |
| `yarn start`                                                    | Run the runtime error service on `127.0.0.1:3000`.                                                                                      |
| `yarn report [--dry-run]`                                       | Walk the routes and open issues.                                                                                                        |
| `yarn api-errors [--case name]`                                 | Run the REST API error cases.                                                                                                           |
| `yarn typecheck`, `yarn lint`, `yarn format:check`, `yarn test` | The green default-branch checks, also run by `healthy.yml`.                                                                             |

## Safety

- No real credential appears anywhere. Every token-shaped string is synthetic and marked
  `SYNTHETIC` in a comment beside it.
- No infinite loops, no retries beyond the mocked back-off demo, no network hammering: every
  API case makes one request, the reporter makes at most one request per route plus one per
  issue, and every sleep is bounded.
- Nothing destructive touches anything outside the test repository: `scripts/reset` closes
  issues and deletes `ci-error/*` branches on `origin` only.

## Environment variables

See [.env.example](.env.example): `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `HOST`, `PORT`,
`ERROR_SERVICE_URL`.

## License

[MIT](LICENSE).
