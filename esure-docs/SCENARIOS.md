# Esure Scenario Schema v1

Scenario Schema v1 is a bounded, declarative JSON/YAML format for classic
Stellar payment tests. Document order is execution order. Definitions contain
no executable code or credentials and are validated before Testnet access.

```yaml
schemaVersion: 1
id: coffee-token-payment
version: 1
name: Coffee token payment
description: Issue COFFEE and transfer it through a trustline.
network: testnet
accounts:
  - { id: issuer, generate: true, fund: true }
  - { id: customer, generate: true, fund: true }
assets:
  - { id: xlm, type: native }
  - { id: coffee, type: issued, code: COFFEE, issuer: issuer }
steps:
  - id: customer-trusts-coffee
    type: changeTrust
    account: customer
    asset: coffee
  - id: issuer-pays-customer
    type: payment
    from: issuer
    to: customer
    asset: coffee
    amount: "25"
assertions:
  - { type: balanceEquals, account: customer, asset: coffee, amount: "25" }
  - { type: trustlineExists, account: customer, asset: coffee }
  - { type: stepSucceeded, step: issuer-pays-customer }
  - { type: transactionConfirmed, step: issuer-pays-customer }
  - { type: accountExists, account: customer }
```

## Accounts and assets

- Accounts must use `{ generate: true }`; secret seeds and imported accounts are
  not accepted. `fund: true` funds the generated account through official
  Testnet Friendbot.
- Every scenario declares exactly one native asset.
- Issued assets reference an account in the same definition as issuer and use a
  1–12 character uppercase alphanumeric classic asset code.

## Operations

- `changeTrust`: `id`, `account`, `asset`, and optional positive `limit`.
- `payment`: `id`, `from`, `to`, `asset`, and positive decimal `amount`.

Amounts are strings with at most seven fractional digits and must fit Stellar's
signed 64-bit stroop range.

## Assertions

- `balanceEquals(account, asset, amount)`
- `balanceChangedBy(account, asset, amount)`; signed deltas are supported
- `stepSucceeded(step)`
- `stepFailedWith(step, transactionCode, operationCodes)`; the complete
  normalized transaction and operation-code sequence must match exactly
- `trustlineExists(account, asset)`
- `trustlineMissing(account, asset)`
- `transactionConfirmed(step)`
- `accountExists(account)`

Reports include explicit `expected` and `actual` values for every assertion,
plus `scenarioVersion`, `scenarioSchemaVersion`, and a canonical SHA-256
`scenarioContentHash`.

## Validation and limits

- Only `network: testnet` and `schemaVersion: 1` are accepted.
- Unknown properties, duplicate IDs, unresolved references, native trustlines,
  invalid amounts/limits, malformed asset codes, and unsupported operations or
  assertions are rejected before execution.
- Maximums: 10 accounts, 10 assets, 20 steps, 20 assertions, 16 KiB per
  submitted/file definition, and 100 files per configured directory.
- YAML duplicate keys and aliases are rejected.
- Stellar secret seeds, URLs, script fields, transaction envelopes, and raw XDR
  are rejected. Generated secret keys exist only in runner memory during a run.

## Loading and running

- Bundled definitions live in the backend `scenarios/` directory.
- A server operator can set `SCENARIO_DIRECTORY` to load additional JSON/YAML
  files without editing application source.
- `POST /api/v1/scenarios/validate` validates raw JSON or YAML without execution.
- `POST /api/v1/runs/definitions` validates and executes raw JSON or YAML.
- `POST /api/v1/runs` continues to execute a catalogued definition by ID.

The OpenAPI 3.1 contract and embedded Scenario v1 JSON Schema are available at
`GET /openapi.json`.
