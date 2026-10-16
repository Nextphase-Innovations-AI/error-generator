# security-alerts

Fixtures for Category 2. Each sub-directory holds exactly one trigger for one GitHub alert type.

| Directory              | Alert type             | Trigger                                            |
| ---------------------- | ---------------------- | -------------------------------------------------- |
| `vulnerable-manifest/` | Dependabot alert       | `lodash@4.17.20`, advisory GHSA-35jh-r3h4-6jhm     |
| `codeql/`              | Code scanning (CodeQL) | Unreachable `exec` call fed by `req.query`         |
| `secret-scanning/`     | Secret scanning        | Synthetic Slack incoming-webhook URL               |
| (branch)               | Dependency review      | `scripts/trigger-all` opens a PR adding a manifest |

The dependency-review trigger lives on a branch rather than here: the action only fails when a
vulnerable dependency is _introduced_ by a pull request, so `scripts/trigger-all --category 2`
creates `ci-error/dependency-review`, adds `security-alerts/dependency-review/package.json`
pinning `minimist@1.2.5` (GHSA-xvch-5gv4-984h), and opens the pull request.
