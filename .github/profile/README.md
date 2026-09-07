# Esure

**Test with confidence. Build on Stellar.**

Esure is an open-source scenario testing toolkit for Stellar payments and,
later, Soroban applications. It turns multi-step ledger flows into repeatable
tests with readable execution reports.

## Repositories

| Repository | Purpose |
| --- | --- |
| `esure-frontend` | Scenario dashboard and execution reports |
| `esure-backend` | Stellar Testnet scenario runner and API |
| `esure-contracts` | Soroban test fixtures and contracts |
| `esure-docs` | Product, architecture, API, and contributor documentation |
| `.github` | Shared organization standards and templates |

## Current scope

The MVP tests classic Stellar payment flows on Testnet: XLM payments, issued
assets, trustlines, expected failures, and balance assertions. Esure never uses
real funds or stores generated secret keys.

## Contributing

Start with a labelled, unassigned issue. Comment with a short implementation
plan and wait for assignment before opening a pull request. Read the shared
contribution and security guidance before working on an issue.

