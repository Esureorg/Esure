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

## List scenarios

### `GET /api/v1/scenarios`

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
  "inputs": {}
}
```

Accepted response (`202`):

```json
{
  "id": "6e43bd3a-2278-4eaa-901e-f89d733d92e1",
  "status": "requested",
  "scenarioId": "issued-asset-payment",
  "createdAt": "2026-08-06T12:00:00.000Z"
}
```

Catalogued scenarios remain supported. To execute a validated client-supplied
Scenario Schema v1 definition, POST the raw JSON or YAML document to
`/api/v1/runs/definitions` using `application/json`, `application/yaml`, or
`text/yaml`. Validate without execution at `/api/v1/scenarios/validate`.

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
- `INTERNAL_ERROR`
