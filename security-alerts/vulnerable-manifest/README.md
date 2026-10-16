# vulnerable-manifest

INTENTIONAL (Category 2, Dependabot alert). This manifest pins `lodash@4.17.20`, which is covered
by advisory [GHSA-35jh-r3h4-6jhm](https://github.com/advisories/GHSA-35jh-r3h4-6jhm)
(CVE-2021-23337, command injection via `template`, fixed in 4.17.21) and by
[GHSA-29mw-wpgm-hmr9](https://github.com/advisories/GHSA-29mw-wpgm-hmr9) (CVE-2020-28500, ReDoS).

It is deliberately not a Yarn workspace of the root project and is never installed, so the
vulnerable code is not present in `node_modules`. Dependabot reads every manifest in the
repository, so the alert appears as soon as Dependabot alerts are enabled and the default branch
is scanned.
