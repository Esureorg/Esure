# Contributing to Esure

Thank you for helping make Stellar development easier to test and understand.

## Before starting

1. Choose an open, unassigned issue.
2. Read its scope and acceptance criteria completely.
3. Comment with a short implementation plan.
4. Wait for a maintainer to assign the issue.

Do not begin work based only on an issue title. Assignment prevents duplicate
work during time-boxed contribution campaigns.

## Development workflow

1. Fork the relevant repository.
2. Create a branch such as `feat/scenario-filter` or `fix/report-download`.
3. Make the smallest change that fully meets the acceptance criteria.
4. Add or update automated tests.
5. Run the repository's documented check command.
6. Open a pull request that closes the assigned issue.

## Pull requests

- Keep one issue per pull request unless a maintainer approves otherwise.
- Explain the user-visible outcome and how it was verified.
- Include screenshots for visual changes.
- Do not include generated secret keys, `.env` files, credentials, or real funds.
- Respond to review feedback within the campaign window when applicable.
- Maintainers may close abandoned or out-of-scope pull requests.

## Engineering rules

- Esure's MVP is restricted to Stellar Testnet.
- Amounts are decimal strings, never floating-point values.
- API and scenario schemas reject unknown properties.
- The backend owns canonical API and scenario schemas.
- Secret keys must never appear in API responses, reports, logs, snapshots, or
  committed fixtures.
- New dependencies require a clear need and must pass the repository audit.
- Accessibility and reduced-motion behavior are required for frontend changes.

## Migration and text files

Text files use UTF-8 with LF line endings, a final newline, and two-space
indentation, as set in `.editorconfig`.

Migration hashes are SHA-256 digests of each file's exact contents
(`esure-backend/src/database.ts`). A changed byte in an applied migration
therefore fails the checksum check, and a CRLF conversion or a trailing-newline
edit counts as a change. For that reason:

- Never edit a migration that has been applied to any environment. Add a new,
  higher-numbered migration instead.
- Do not reformat or re-save existing migration files. The EditorConfig
  section for `esure-backend/migrations/*.sql` turns off final-newline and
  trailing-whitespace edits for them.
- Do not change line endings of existing files in a formatting-only commit.

## Scenario inventory

The bundled scenarios in `esure-backend/scenarios` are the source of truth. The
ID table in `esure-docs/SCENARIOS.md` and the scenario counts in `README.md`
must match them. Check both from the backend package:

```bash
cd esure-backend
npm run check:scenarios
```

The command prints the sorted scenario IDs and exits with status 1 when a
definition is invalid or a document drifts, for example:

```text
inventory drift: esure-docs/SCENARIOS.md: account-missing is missing from the table
inventory drift: README.md: states 13 bundled scenarios, found 23
Scenario inventory check failed with 2 finding(s).
```

When you add or remove a bundled scenario, update the table and both counts in
the same pull request.

## Continuous integration

The `Monorepo CI` workflow (`.github/workflows/ci.yml`) runs the backend,
frontend, and CLI checks on pull requests and on pushes to `main`.

Runs share one concurrency group per workflow and Git ref. When new commits
are pushed to a pull request, the superseded run is cancelled. Pushes to `main`
are never cancelled, so every merged commit keeps its own result. Runs for
different branches use different refs and never cancel each other.

## Dependency updates

Dependabot (`.github/dependabot.yml`) proposes updates weekly for the npm
packages in `esure-backend`, `esure-frontend`, and `esure-cli`, and for the
GitHub Actions in the workflows. Minor and patch updates are grouped per
package, and each package keeps at most five open update pull requests. Major
updates arrive as separate pull requests.

Dependabot pull requests are not merged automatically. They must pass the
required CI checks and a maintainer review.

## Issue labels and sizing

Issue forms apply a type label: `bug` or `enhancement`. Maintainers add one or
more area labels: `backend`, `frontend`, `cli`, `scenarios`, `documentation`, or
`testing`.

Difficulty labels describe the expected scope, not contributor ability:

- `trivial`: documentation or a very small isolated correction
- `medium`: a focused feature or fix requiring edge-case and regression coverage
- `hard`: architecture, security, or multi-component integration

Use `good first issue` only for small, well-scoped work; do not apply it
automatically to medium or hard issues. Maintainers have the final say on issue
scope and completion.

## Conduct and security

Participation is governed by the Code of Conduct. Report vulnerabilities
privately according to `SECURITY.md`; do not open public security issues.

