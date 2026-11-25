# Esure Backend API

## Conventions

- Base path: `/api/v1`
- Content type: `application/json`
- Identifiers: UUID strings
- Timestamps: UTC ISO 8601 strings
- Amounts: decimal strings, never floating-point JSON numbers
- MVP network: `testnet`

The backend publishes its machine-readable OpenAPI 3.1 document at
`GET /openapi.json`.

## Health

### `GET /health`

```json
{
  "status": "ok",
  "network": "testnet"
}
```

## Canonical scenario schema

### `GET /api/v1/schemas/scenario-v1.json`

Returns the canonical machine-readable JSON Schema for scenario definitions at schema version 1.
Served directly from the authoritative TypeScript definition with `Content-Type: application/json`.
Note that JSON Schema alone cannot express all semantic constraints (such as exactly one native asset, valid identifier references, Stellar signed 64-bit stroop limits, secret seed prohibitions, and 16 384 byte payload limit), which are enforced by the validator.

## List scenarios

### `GET /api/v1/scenarios`

Supports conditional GET via deterministic `ETag` and `Cache-Control: no-cache` headers.
When an `If-None-Match` header matches the current catalogue fingerprint, returns `304 Not Modified` with an empty body.

```json
{
  "items": [
    {
      "id": "issued-asset-payment",
      "version": 1,
      "name": "Issued asset payment",
      "description": "Issue a test asset and send it through a trustline."
    }
  ]
}
```

## Read a scenario

### `GET /api/v1/scenarios/{scenarioId}`

Returns the public scenario definition or `404` when it is unavailable.

## Read immutable published versions

- `GET /api/v1/scenarios/{scenarioId}/versions` lists bounded version history.
- `GET /api/v1/scenarios/{scenarioId}/versions/{version}` returns one exact version.
- `GET /api/v1/scenarios/{scenarioId}/versions/{version}/export?format=json|yaml`
  exports that version.

These read-only routes require explicitly enabled PostgreSQL published mode.
Public scenario create, update, archive, and delete routes remain disabled.

## Start a run

### `POST /api/v1/runs`

Request:

```json
{
  "scenarioId": "issued-asset-payment",
  "scenarioVersion": 1,
  "inputs": {}
}
```

- `scenarioVersion` (optional integer, >= 1): Selects an exact published scenario version. Omitting `scenarioVersion` executes the latest version from the active catalogue source. When run in disabled (bundled) mode, providing a version that mismatches the bundled version returns `409 SCENARIO_VERSION_MISMATCH`.
- `Idempotency-Key` (optional header, 1–128 chars): Deduplicates run creation within a 24-hour retention window. Sending the same key and identical request returns the existing run. Reusing the key with a different request returns `409 IDEMPOTENCY_CONFLICT`. If store capacity is reached, returns `503 IDEMPOTENCY_CAPACITY`.

Accepted response (`202`):

```json
{
  "id": "6e43bd3a-2278-4eaa-901e-f89d733d92e1",
  "status": "requested",
  "scenarioId": "issued-asset-payment",
  "scenarioVersion": 1,
  "createdAt": "2026-08-06T12:00:00.000Z"
}
```

Catalogued scenarios remain supported. To execute a validated client-supplied
Scenario Schema v1 definition, POST the raw JSON or YAML document to
`/api/v1/runs/definitions` using `application/json`, `application/yaml`, or
`text/yaml`. The `Idempotency-Key` header is also supported on this route. Validate without execution at `/api/v1/scenarios/validate`.

## Read a run

### `GET /api/v1/runs/{runId}`

```json
{
  "id": "6e43bd3a-2278-4eaa-901e-f89d733d92e1",
  "scenarioId": "issued-asset-payment",
  "scenarioVersion": 1,
  "scenarioSchemaVersion": 1,
  "scenarioContentHash": "sha256:...",
  "network": "testnet",
  "status": "passed",
  "createdAt": "2026-08-06T12:00:00.000Z",
  "completedAt": "2026-08-06T12:00:08.000Z",
  "steps": [],
  "assertions": [],
  "summary": {
    "stepsPassed": 4,
    "stepsFailed": 0,
    "assertionsPassed": 1,
    "assertionsFailed": 0
  }
}
```

## Download a report

### `GET /api/v1/runs/{runId}/report`

Returns the final sanitized report as a JSON attachment. An unfinished run
returns `409`.

## Error envelope

```json
{
  "error": {
    "code": "SCENARIO_NOT_FOUND",
    "message": "The requested scenario is not available.",
    "requestId": "req_01J...",
    "details": []
  }
}
```

Errors must not expose secret keys, raw internal exceptions, or configuration.

## Initial error codes

- `INVALID_REQUEST`
- `INVALID_SCENARIO`
- `SCENARIO_NOT_FOUND`
- `RUN_NOT_FOUND`
- `RUN_NOT_COMPLETE`
- `NETWORK_UNAVAILABLE`
- `FRIENDBOT_UNAVAILABLE`
- `TRANSACTION_FAILED`
- `ASSERTION_FAILED`
- `RATE_LIMITED`
- `SCENARIO_VERSION_NOT_FOUND`
- `SCENARIO_VERSION_MISMATCH`
- `IDEMPOTENCY_CONFLICT`
- `IDEMPOTENCY_CAPACITY`
- `INTERNAL_ERROR`

## Report field reference

The final sanitized report is the authoritative record of a completed run. This section explains each field using a complete annotated example.

### Terminal vs. active reports

- **Terminal reports** (status `passed` or `failed`) are complete and may be downloaded using `GET /api/v1/runs/{runId}/report`.
- **Active reports** (status `requested`, `validating`, or `running`) are not yet complete. Downloading an active report returns `409 CONFLICT` with message "run is not complete". Polling `GET /api/v1/runs/{runId}` returns the run metadata but not the downloadable report attachment.

### Report structure

```json
{
  "id": "48f2c1a3-7d22-4b1f-8c3e-9a5e2b1c4d0f",
  "scenarioId": "issued-asset-payment",
  "scenarioVersion": 1,
  "scenarioSchemaVersion": 1,
  "scenarioContentHash": "sha256:3e8f4a7c1b2d5f6e9a0c8d3e7f2a4b6c5d8e1f3a4b7c9d2e5f8a0c3e6f9b1d4",
  "network": "testnet",
  "status": "passed",
  "createdAt": "2026-10-20T14:32:15.000Z",
  "completedAt": "2026-10-20T14:32:23.000Z",
  "steps": [
    {
      "id": "create-trustline",
      "type": "changeTrust",
      "status": "passed",
      "transactionHash": "8d1a9c2f4e7b6a3d5c8e1f9a2b4d6e8f7c9a1b3d5e7f9a0c2d4e6f8a9b1c3d",
      "ledger": 899456,
      "stellarTransactionCode": "tx_success",
      "stellarOperationCodes": [],
      "message": "Account GXYZ... established trustline to TESTUSD issued by GABC...",
      "startedAt": "2026-10-20T14:32:16.000Z",
      "completedAt": "2026-10-20T14:32:18.000Z",
      "durationMs": 2150
    },
    {
      "id": "issue-asset",
      "type": "payment",
      "status": "passed",
      "transactionHash": "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a",
      "ledger": 899457,
      "stellarTransactionCode": "tx_success",
      "stellarOperationCodes": [],
      "message": "Issuer GABC... paid 100.0000000 TESTUSD to customer GXYZ...",
      "startedAt": "2026-10-20T14:32:18.500Z",
      "completedAt": "2026-10-20T14:32:20.000Z",
      "durationMs": 1500
    }
  ],
  "assertions": [
    {
      "type": "balanceEquals",
      "status": "passed",
      "expected": "100.0000000",
      "actual": "100.0000000",
      "message": "Account GXYZ... holds exactly 100.0000000 TESTUSD"
    },
    {
      "type": "trustlineExists",
      "status": "passed",
      "expected": true,
      "actual": true,
      "message": "Account GXYZ... has an active trustline to TESTUSD issued by GABC..."
    },
    {
      "type": "stepSucceeded",
      "status": "passed",
      "expected": true,
      "actual": true,
      "message": "Step issue-asset succeeded"
    }
  ],
  "summary": {
    "stepsPassed": 2,
    "stepsFailed": 0,
    "assertionsPassed": 3,
    "assertionsFailed": 0
  }
}
```

### Field explanations

#### Provenance
- **id** (UUID): Unique identifier for this run. Use it to retrieve the run status or download this report.
- **scenarioId** (string): The scenario definition that was executed (e.g., `issued-asset-payment`).
- **scenarioVersion** (integer): The version of the scenario definition executed (e.g., `1`).
- **scenarioSchemaVersion** (integer): Always `1` in the current API.
- **scenarioContentHash** (string): SHA-256 digest of the scenario definition; used to detect changes to a scenario across runs.
- **network** (string): Always `testnet` in the current API.

#### Timeline
- **createdAt** (ISO-8601): When the run was requested.
- **completedAt** (ISO-8601, optional): When the run finished execution. Absent if the run is still active.

#### Run outcome
- **status** (string): One of `requested`, `validating`, `running`, `passed`, or `failed`.
  - `requested`: Run accepted but not yet started.
  - `validating`: Scenario definition is being validated.
  - `running`: Steps and assertions are executing.
  - `passed`: All assertions passed.
  - `failed`: One or more assertions failed, or an execution error occurred.

#### Steps (executed operations)
Each step in the `steps` array represents one submitted transaction:

- **id** (string): Step identifier from the scenario definition (e.g., `create-trustline`).
- **type** (string): Operation type (e.g., `changeTrust`, `payment`, `manageSellOffer`).
- **status** (string): `passed` if Stellar accepted the transaction, `failed` if rejected.
- **transactionHash** (string, optional): The transaction hash on Horizon. Present only if the transaction was submitted to the ledger.
- **ledger** (integer, optional): The ledger sequence number that included this transaction.
- **stellarTransactionCode** (string): The top-level response from Stellar (e.g., `tx_success`, `tx_failed`, `tx_too_late`).
- **stellarOperationCodes** (array): Per-operation result codes from Stellar. Empty if the transaction succeeded. Contains one or more codes if operations failed.
- **message** (string): Plain-English summary of the step result.
- **startedAt** (ISO-8601, optional): When this step execution began.
- **completedAt** (ISO-8601, optional): When this step execution finished.
- **durationMs** (integer, optional): Elapsed time in milliseconds, derived from a monotonic clock.

#### Assertions (test outcomes)
Each assertion in the `assertions` array represents a deterministic check evaluated after execution:

- **type** (string): Assertion type (e.g., `balanceEquals`, `stepSucceeded`, `stepFailedWith`).
- **status** (string): `passed` if the assertion matched, `failed` if it did not.
- **expected** (mixed): The expected value from the scenario definition. Type depends on the assertion (string for balances, boolean for existence checks, array of codes for `stepFailedWith`).
- **actual** (mixed): The observed value. May be `null` if the evidence could not be retrieved (e.g., a transaction lookup failed).
- **message** (string): Plain-English explanation of the assertion result.

#### Summary
- **stepsPassed** (integer): Count of steps with status `passed`.
- **stepsFailed** (integer): Count of steps with status `failed`.
- **assertionsPassed** (integer): Count of assertions with status `passed`.
- **assertionsFailed** (integer): Count of assertions with status `failed`.

#### Error (optional)
If the run status is `failed`, an `error` object may be present:

```json
{
  "code": "TRANSACTION_FAILED",
  "message": "Step 'submit-payment' failed with Stellar error tx_failed / op_underfunded",
  "category": "stellar",
  "retryable": true,
  "failedStepId": "submit-payment",
  "stellarTransactionCode": "tx_failed",
  "stellarOperationCodes": ["op_underfunded"]
}
```

- **code** (string): Machine-readable error identifier.
- **message** (string): Human-readable error explanation.
- **category** (string): Error category (`stellar`, `network`, `timeout`, `capacity`, `validation`, or `internal`).
- **retryable** (boolean): Whether retrying the run is likely to succeed.
- **failedStepId** (string, optional): The step ID that caused the error.
- **stellarTransactionCode** (string, optional): Stellar's transaction-level error code.
- **stellarOperationCodes** (array, optional): Stellar's per-operation error codes.

### Decimal strings

All numeric amounts (balances, transaction values, fees) are represented as decimal strings, never as JSON numbers. This preserves precision and avoids floating-point rounding errors:

- ✓ Correct: `"amount": "100.0000000"`, `"expected": "25.5000001"`
- ✗ Incorrect: `"amount": 100, "expected": 25.5`

Decimal strings follow Stellar's stroop representation (at most 7 fractional digits).
