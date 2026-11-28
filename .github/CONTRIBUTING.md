# Contributing to Esure

Thank you for helping make Stellar development easier to test and understand.

## Before starting

1. Choose an open, unassigned issue.
2. Read its scope and acceptance criteria completely.
3. Comment with a short implementation plan.
4. Wait for a maintainer to assign the issue.

Do not begin work based only on an issue title. Assignment prevents duplicate
work during time-boxed contribution campaigns.

## Build dependency order and clean-install commands

The three packages have a fixed build dependency order:

```
esure-backend  (no internal deps — build first)
      ↓  npm file: link
esure-cli      (depends on esure-backend dist — build second)

esure-frontend (no internal deps — independent, can build in any order)
```

**esure-cli depends on esure-backend at two distinct levels:**

- **npm package dependency**: `esure-cli/package.json` declares
  `"@esure/backend": "file:../esure-backend"`. This is a local file-link that
  npm resolves at install time. `npm ci` inside `esure-cli` reads compiled
  output from `esure-backend/dist/`, so the backend must be built before the
  CLI is typechecked, tested, or built.
- **Runtime API dependency**: at runtime the CLI calls the esure backend HTTP
  API (`POST /api/v1/runs`, etc.) over the network. That is a separate concern
  from the npm link. The CLI does not embed or bundle the backend server; it
  only imports shared types and schema validators from the backend package.

**Clean-install sequence for the full monorepo:**

```sh
# 1. Backend — install, check, and build first
cd esure-backend
npm ci
npm run check
npm run build

# 2. CLI — install after backend dist exists
cd ../esure-cli
npm ci
npm run check
npm run build

# 3. Frontend — independent, can run in parallel with the above
cd ../esure-frontend
npm ci
npm run check
npm run build
```

Alternatively, from the monorepo root (runs check in all three workspaces in
the declared order, but does not install dependencies):

```sh
npm run check
```

The root `package.json` does not define an install step across workspaces; run
`npm ci` in each package directory individually as shown above.

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

### Contracts

`esure-contracts/` is **proposal-only** during the classic payment MVP. No
on-chain contract code is accepted until a written proposal passes the design
gate. Before adding contract code, the proposal must show:

- a demonstrated testing need that classic Stellar operations cannot cover;
- completion of the admission checklist in
  [`esure-contracts/DESIGN.md`](../esure-contracts/DESIGN.md);
- maintainer approval of the proposal in
  [`esure-contracts/PROPOSAL.md`](../esure-contracts/PROPOSAL.md);
- Testnet-only scope, consistent with the MVP constraints above.

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

