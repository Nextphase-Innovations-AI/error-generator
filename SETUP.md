# Setup

First-time steps to put this repository on GitHub and produce every error once.

## 1. Prerequisites

- Node 22.15.x and corepack (`corepack enable` makes `yarn@4.10.3` available).
- The `gh` CLI, logged in: `gh auth status`.
- A GitHub account or organisation where you can create a private repository.

## 2. Create the private test repository

```bash
git init -b main
git add .
git commit -m "Initial error generator"
gh repo create <owner>/error-generator --private --source=. --remote=origin --push
```

The first push may be blocked by secret-scanning push protection because of
`security-alerts/secret-scanning/synthetic-secret.txt`. See
[Push protection](#5-push-protection) below.

## 3. Enable the security features

Open **Settings > Advanced Security** (older UI: **Settings > Code security and analysis**) in
the test repository and enable:

| Setting                                                          | Needed by                                     |
| ---------------------------------------------------------------- | --------------------------------------------- |
| Dependency graph                                                 | Dependabot alerts, dependency review          |
| Dependabot alerts                                                | Category 2, Dependabot alert                  |
| Code scanning (CodeQL, default or via the `codeql.yml` workflow) | Category 2, code scanning alert               |
| Secret scanning                                                  | Category 2, secret scanning alert             |
| Push protection                                                  | Only if you want to exercise the blocked push |

Billing note: on a **private** repository, code scanning, dependency review and secret scanning
require GitHub Code Security and GitHub Secret Protection (formerly GitHub Advanced Security). On
a **public** repository all of them are free. If the organisation has not purchased them, the API
answers `Advanced security has not been purchased` and the CodeQL workflow fails with `Code
scanning is not enabled for this repository`. The way out is to make the test repository public:

```bash
gh repo edit <owner>/error-generator --visibility public --accept-visibility-change-consequences
```

Dependabot alerts are free on every repository. The same settings can be set from the CLI:

```bash
gh api -X PUT repos/<owner>/error-generator/vulnerability-alerts
```

```bash
gh api -X PATCH repos/<owner>/error-generator --input - <<< '{"security_and_analysis":{"secret_scanning":{"status":"enabled"}}}'
```

Code scanning on a public repository needs no setting: the `codeql.yml` workflow uploads its
results as soon as it runs.

Code scanning: because `codeql.yml` is committed, choose **Advanced** setup (or leave default
setup off). Default setup and an advanced workflow conflict with each other.

## 4. Actions permissions

Open **Settings > Actions > General**:

- **Actions permissions**: allow all actions, or at least `actions/*`, `github/codeql-action/*`
  and `actions/dependency-review-action`.
- **Workflow permissions**: _Read repository contents and packages permissions_ is enough. Every
  workflow declares what it needs with a `permissions` block:
  - `report-runtime-errors.yml` needs `issues: write` (declared in the file).
  - `codeql.yml` needs `security-events: write` (declared in the file).
  - `dependency-review.yml` needs `pull-requests: write` for its summary comment (declared).
- Leave **Allow GitHub Actions to create and approve pull requests** off; the dependency-review
  pull request is opened by `gh` with your own token, not by a workflow.

Do **not** create a repository secret named `ERROR_GENERATOR_MISSING_SECRET`; the
`missing-secret.yml` workflow depends on its absence.

## 5. Push protection

If push protection is on, the push that adds `synthetic-secret.txt` is rejected and GitHub prints
an "unblock" URL. For this test repository only, open that URL, choose **It's used in tests**
and push again. Alternatively turn push protection off for this repository under
**Settings > Advanced Security > Push protection**; the secret scanning alert itself still
appears either way. Do not change organisation-wide settings for this.

## 6. Trigger everything the first time

```bash
export GITHUB_TOKEN=$(gh auth token)
scripts/trigger-all
```

Or one category at a time:

```bash
scripts/trigger-all --category 1   # Actions failures
scripts/trigger-all --category 2   # CodeQL run and dependency-review pull request
scripts/trigger-all --category 3   # report-runtime-errors workflow
scripts/trigger-all --category 4   # REST API error client, runs locally
```

`--dry-run` prints every command without executing it.

## 7. Watch and reset

```bash
gh run list --limit 40
gh issue list --label runtime-errors
gh pr list
scripts/reset
```

`scripts/reset` closes the generated issues and pull request and deletes the `ci-error/*`
branches. Workflow runs stay in the Actions history; alerts stay until you dismiss them in the
Security tab.
