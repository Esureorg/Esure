# Esure Project Work Summary

Comprehensive dossier of features, architecture, merged pull requests, and ongoing progress in the **Esure** repository.

---

## 1. Project Overview

**Esure** is an open-source testing and simulation toolkit for **Stellar Testnet** payment flows. It enables developers to execute repeatable multi-step blockchain scenarios with isolated test accounts, structured test reports, transaction confirmation links, balance tracking, and human-readable failure explanations.

### Live Deployments & Health
- **Web Dashboard**: [esure-testnet.vercel.app](https://esure-testnet.vercel.app)
- **Backend Health Check**: [esure.onrender.com/health](https://esure.onrender.com/health)
- **OpenAPI Documentation**: [esure.onrender.com/openapi.json](https://esure.onrender.com/openapi.json)

---

## 2. Monorepo Architecture

The repository is organized into distinct, decoupled packages:

| Package / Directory | Technology Stack | Responsibility |
| --- | --- | --- |
| [`esure-frontend/`](esure-frontend/) | Next.js 16, React 19, TypeScript, Vitest, Playwright | Interactive web dashboard, scenario browser, real-time polling UI, and same-origin API proxy. |
| [`esure-backend/`](esure-backend/) | Fastify, `@stellar/stellar-sdk`, PostgreSQL, Vitest | Scenario engine, Friendbot funding manager, ledger verification, balance assertions, and sanitized error reporting. |
| [`esure-contracts/`](esure-contracts/) | Soroban / Stellar Smart Contracts (Roadmap) | Architecture and specifications for on-chain insurance, escrow, and assurance logic. |
| [`esure-docs/`](esure-docs/) | Markdown Specifications | Product specifications (MVP, Architecture, API specs, Scenario definitions, Backlog). |
| [`.github/workflows/`](.github/workflows/) | GitHub Actions CI | Monorepo CI pipelines validating type checks, unit tests, and Playwright end-to-end tests. |

---

## 3. Work Completed & Merged Pull Requests

### 1. Scenario Filtering by Operation Type (PR #10 / Issue #1)
- **Author**: `maccoder374-sudo` (Commit: `70cac53`)
- **Key Changes**:
  - Added interactive, accessible tab filters to [`esure-frontend/src/components/dashboard.tsx`](esure-frontend/src/components/dashboard.tsx) allowing users to filter by **All**, **XLM Payments**, **Issued Assets**, and **Expected Failures**.
  - Dynamic scenario counter updates matching the active filter.
  - User-friendly empty state handling when no scenarios match the selected filter.
  - Comprehensive unit testing suite added in [`esure-frontend/src/components/dashboard.test.tsx`](esure-frontend/src/components/dashboard.test.tsx).

### 2. Report Timestamps and Execution Duration (PR #8 / Issue #2)
- **Author**: `adeniran19-maker` (Commit: `008bbe9`)
- **Key Changes**:
  - Implemented created and completed timestamp displays in the test run summary using the user's browser locale.
  - Retained exact ISO 8601 timestamps in HTML `title` tooltips for debugging and auditing.
  - Real-time calculation and presentation of execution duration (e.g., `4.2s`) for terminal runs.
  - State guards preventing incomplete or misleading duration data during in-flight runs.
  - Verified with end-to-end assertions in [`esure-frontend/e2e/primary-journey.spec.ts`](esure-frontend/e2e/primary-journey.spec.ts).

### 3. Playwright E2E Coverage for Primary Journey (PR #7 / Issue #4)
- **Author**: Victor Peter (`Pvsaint`) (Commit: `018306e`)
- **Key Changes**:
  - Set up full Playwright E2E testing framework in [`esure-frontend/playwright.config.ts`](esure-frontend/playwright.config.ts).
  - Built comprehensive test suite [`esure-frontend/e2e/primary-journey.spec.ts`](esure-frontend/e2e/primary-journey.spec.ts) mocking backend requests at the browser boundary with zero external Stellar network dependencies.
  - Covered primary happy path execution, in-flight polling spinner states, loading skeletons, and error handling (HTTP 429 rate limiting, HTTP 503 service unavailable, failed assertions).
  - Configured CI runner step in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

### 4. Bounded Retry Behavior for Friendbot (PR #6 / Issue #5)
- **Author**: Victor Peter (`Pvsaint`) (Commit: `59a5896`)
- **Key Changes**:
  - Implemented resilient account funding in [`esure-backend/src/stellar-gateway.ts`](esure-backend/src/stellar-gateway.ts) to handle flaky Testnet Friendbot responses.
  - Exponential backoff with full jitter for transient issues (HTTP 429 rate limits, HTTP 5xx errors, network drops).
  - Immediate fail-fast logic for client-side non-retryable 4xx errors and request timeouts/aborts.
  - Sanitized `SafeRunError` handling ensuring secret seeds and private keys are never exposed in logs or API responses.
  - Vitest test suite with fake timers in [`esure-backend/test/stellar-gateway.test.ts`](esure-backend/test/stellar-gateway.test.ts).

### 5. Monorepo Consolidation & Documentation
- Consolidated separate project repositories into a unified monorepo with clean history preservation (`.repo-history-backups/`).
- Professionalized landing page [`README.md`](README.md) with architecture diagrams, quick-start guides, and license information.
- Authored backlog tickets and technical specifications in [`esure-docs/`](esure-docs/).

---

## 4. Contributor Attribution Investigation

We recently investigated why the contributors for PR #8 and PR #10 were not immediately showing up on the GitHub repository's Contributor Insights tab:
- **Root Cause**:
  - Commit `70cac53` was authored as `KnightsDev <knightsdev@example.com>`.
  - Commit `008bbe9` was authored as `Kilo <kilo@kilo.ai>`.
  - GitHub associates repository contributions strictly by the Git commit email matching an email address registered and verified on the user's GitHub account.
- **Resolution Path**:
  - Contributors can add and verify the matching email address on GitHub (`Settings -> Emails`).
  - For future commits, contributors should configure `git config user.email` with their verified GitHub email or GitHub noreply email address.

---

## 5. Next Steps & Active Backlog

Upcoming priorities from [`esure-docs/BACKLOG.md`](esure-docs/BACKLOG.md):
- **F2**: Copy controls for run and transaction identifiers with accessible clipboard feedback.
- **F4**: Application-level error boundary with branded retry UX.
- **B1**: OpenAPI document validation and publication in CI.
- **B2**: Configurable request rate limiting for run execution and read endpoints.
