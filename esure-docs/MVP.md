# Esure MVP Specification

## Product statement

Esure is an open-source testing and simulation toolkit that helps developers
verify Stellar payment flows before integrating them into production apps.

## Problem

Testing a complete Stellar payment flow requires developers to join together
account funding, asset issuance, trustlines, transactions, network responses,
and manual verification. Protocol-level errors can also be difficult for new
Stellar developers to understand.

Esure turns those steps into repeatable scenarios and readable reports.

## Primary user

A developer building a payment, wallet, remittance, or asset application on
Stellar who needs to reproduce and inspect testnet flows.

## MVP promise

A developer can select a predefined scenario, run it on Stellar Testnet, follow
every step, and receive a report containing transaction links, balance changes,
and understandable failures.

## First end-to-end journey

1. The user opens the Esure dashboard.
2. The user selects the `issued-asset-payment` scenario.
3. The backend validates the scenario and starts a run.
4. Esure creates and funds an issuer and recipient on Testnet.
5. The recipient establishes a trustline to the issued asset.
6. The issuer sends the asset to the recipient.
7. Esure verifies the final balance.
8. The dashboard shows each step and a downloadable JSON report.

## Included

- Stellar Testnet only
- XLM payment scenario
- Issued-asset payment scenario
- Expected-failure scenario
- Test account creation and Friendbot funding
- Trustline creation
- Classic asset issuance and payments
- Transaction submission and status tracking
- Assertions on transaction outcome and balances
- Sanitized structured execution reports
- Human-readable error summaries
- Browser dashboard and backend API

## Explicitly excluded

- Mainnet transactions
- Real-money assets or custodial services
- Persistent storage of secret keys
- User-created arbitrary code execution
- Wallet-based transaction signing
- Production authentication and teams
- A visual drag-and-drop scenario editor
- Soroban contract deployment and invocation
- Python SDK, CLI, VS Code extension, or hosted billing

## Success criteria

The MVP is complete when:

- All three scenarios run from the frontend without manual blockchain steps.
- Successful runs show transaction hashes and verified final balances.
- Failed runs identify the failed step and provide a useful explanation.
- No account secret appears in API responses, logs, or reports.
- Re-running a scenario creates an isolated run with new test accounts.
- Backend unit and integration tests pass in CI.
- The primary journey passes as an automated browser test.
- A new contributor can run the system by following the documentation.

## Delivery phases

### Phase 1: executable backend slice

- Establish shared scenario and API types.
- Add health and scenario-list endpoints.
- Execute the issued-asset payment scenario on Testnet.
- Return an in-memory execution report.
- Add unit and integration tests.

### Phase 2: usable dashboard

- List available scenarios.
- Start a scenario run.
- Poll and display run status.
- Render steps, transactions, assertions, and errors.
- Add the primary browser test.

### Phase 3: complete MVP

- Add XLM payment and expected-failure scenarios.
- Add PostgreSQL persistence.
- Add report download and retention controls.
- Add deployment and contributor documentation.

### Phase 4: Soroban extension

This phase starts only after every MVP success criterion is met. The first
contract must support a documented testing need that cannot be met with classic
Stellar operations.

## Repository ownership

| Repository | MVP responsibility |
| --- | --- |
| `esure-frontend` | Dashboard and browser tests |
| `esure-backend` | Scenario validation, execution, reporting, and persistence |
| `esure-contracts` | Post-MVP Soroban fixtures and their tests |
| `esure-docs` | Product, architecture, API, and contributor documentation |
| `.github` | Organization-wide community and workflow defaults |

## Working tagline

**Test with confidence. Build on Stellar.**

