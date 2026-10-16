# actions-failures

Fixtures for Category 1. Every file here is broken on purpose and is excluded from the root
`typecheck`, `lint`, `format:check` and `test` scripts so the default branch stays green. Each
directory is exercised only by the matching workflow in `.github/workflows/`.

| Directory       | Workflow                                 | What is wrong                            |
| --------------- | ---------------------------------------- | ---------------------------------------- |
| `build-error/`  | `.github/workflows/build-error.yml`      | Syntax error, `tsc` cannot parse it      |
| `failing-test/` | `.github/workflows/failing-test.yml`     | Assertion `1 + 1 === 3`                  |
| `lint-error/`   | `.github/workflows/lint-error.yml`       | Unused variable and undefined identifier |
| `type-error/`   | `.github/workflows/type-error.yml`       | `string` assigned to `number`            |
| `invalid-yaml/` | copied to `.github/workflows` on trigger | Mis-indented `steps` mapping             |

The remaining Category 1 workflows (timeout, missing secret, shell exit, dependency install,
matrix) need no fixture file; the failure is expressed entirely in the workflow.
