# Simulation Resource Evidence

Status: **design only; runtime support is gated**. This document defines which
Soroban simulation resource values a future harness may put in a run report,
in what units, with what size limits, and how missing data is reported. It does
not change the current report schema.

## Gate

Nothing in this document is implemented until:

1. The first prototype in
   [FIRST_FIXTURE_DECISION.md](./FIRST_FIXTURE_DECISION.md) is approved and
   merged with its artifact metadata.
2. A Scenario v2 / report v2 design is accepted, as required by
   [PROPOSAL.md](./PROPOSAL.md#schema-considerations).

The current report schema
([`runReportSchemaV1`](../esure-backend/src/report-schema.ts)) is strict:
steps use `additionalProperties: false` and `scenarioSchemaVersion` is the
constant `1`. Resource evidence therefore must not be added to v1 reports; it
belongs in a v2 report schema introduced with the v2 runner.

## Allowed metrics

Only the metrics below may appear. Each is a non-negative integer encoded as a
decimal string, matching how v1 already encodes `feeCharged`
(`^(0|[1-9][0-9]*)$`), so that 64-bit values survive JSON round trips.

| Field | Unit | Source | Bound (string length) |
| --- | --- | --- | --- |
| `cpuInstructions` | instructions | Simulation cost / transaction resources | 20 |
| `memoryBytes` | bytes | Simulation cost, when the RPC provides it | 20 |
| `diskReadBytes` | bytes | Transaction resources (ledger read bytes) | 20 |
| `writeBytes` | bytes | Transaction resources | 20 |
| `readOnlyEntries` | ledger entries | Footprint read-only key count | 5 |
| `readWriteEntries` | ledger entries | Footprint read-write key count | 5 |
| `transactionSizeBytes` | bytes | Encoded transaction envelope size | 10 |
| `minResourceFee` | stroops | Simulation minimum resource fee | 20 |
| `eventCount` | events | Contract events in the simulation result | 5 |
| `eventBytes` | bytes | Encoded size of those events | 10 |

Field-to-RPC mapping must be confirmed against the pinned Stellar SDK and RPC
version when the harness is implemented; names above are Esure report names,
not RPC field names.

Each metric may carry the configured ceiling it was checked against, as
`{ "value": "<n>", "limit": "<n>" }`. Ceilings come from harness configuration
and artifact metadata, never from scenario input.

### Excluded data

The following must not appear in reports, even in sanitized form:

- Raw XDR (transaction envelope, `SorobanTransactionData`, auth entries,
  result meta, diagnostic events).
- Footprint ledger keys or contract storage values (counts only).
- RPC endpoint URLs, request IDs, or response headers.
- Secret keys, signatures, or authorization preimages.
- WASM bytes or the WASM hash of anything other than the allowlisted artifact.

## Size limits

| Limit | Value | Rationale |
| --- | --- | --- |
| Resource evidence objects per step | 1 (simulation) + 1 (submitted transaction, optional) | Comparing simulated with actual usage is useful; history of retries is not. |
| Metrics per object | 10 (the allowed list) | `additionalProperties: false` in the future schema. |
| Serialized resource evidence per step | 2 KiB | Keeps resource evidence a small, bounded share of each report. |
| `message` length on a resource failure | 512 characters | Enough for a human explanation; no raw provider text. |
| Total resource evidence per report | 20 steps × 2 KiB = 40 KiB | Matches `SCENARIO_LIMITS.steps` (20) in [`scenario-schema.ts`](../esure-backend/src/scenario-schema.ts). |

If serialized evidence for a step exceeds its limit, the harness drops the
optional submitted-transaction object first, then reports
`resources.status: "truncated"`. It never truncates an individual number.

## Missing-data behavior

Each resource evidence object has a `status`:

| `status` | Meaning | Effect on the step |
| --- | --- | --- |
| `complete` | All metrics the RPC provides were recorded. | None. |
| `partial` | Some metrics were not provided by the RPC (for example `memoryBytes` on providers that no longer return it). | None. Missing metrics are listed in `missing`. |
| `truncated` | Evidence exceeded the size limit and was reduced. | None. |
| `unavailable` | Simulation did not return resource data (RPC error, timeout, malformed response). | The step **fails** with an operational error. Esure never submits a transaction whose resources it could not check. |

Missing metrics are omitted, not set to `"0"`, `null`, or an empty string. A
zero value means the network reported zero.

An `unavailable` status must be reported with the `network` or `timeout` error
category, never as a passing or failing assertion, consistent with the rule in
[PROPOSAL.md](./PROPOSAL.md#soroban-specific-assertions) that operational errors
are not negative results.

A metric over its ceiling fails the step with code `resource_limit_exceeded`
before submission. The report keeps the evidence so the developer can see by
how much the limit was exceeded.

## Sanitized examples

All values are illustrative. They are not measurements of a real artifact.

### Success

```json
{
  "id": "release",
  "type": "invokeContract",
  "status": "passed",
  "message": "release succeeded",
  "resources": {
    "simulation": {
      "status": "complete",
      "cpuInstructions": { "value": "1843210", "limit": "10000000" },
      "memoryBytes": { "value": "412880", "limit": "4000000" },
      "diskReadBytes": { "value": "3120", "limit": "20000" },
      "writeBytes": { "value": "248", "limit": "10000" },
      "readOnlyEntries": { "value": "2", "limit": "10" },
      "readWriteEntries": { "value": "2", "limit": "5" },
      "transactionSizeBytes": { "value": "812", "limit": "20000" },
      "minResourceFee": { "value": "61234", "limit": "1000000" },
      "eventCount": { "value": "1", "limit": "5" },
      "eventBytes": { "value": "96", "limit": "2048" }
    }
  }
}
```

### Partial data

```json
{
  "simulation": {
    "status": "partial",
    "missing": ["memoryBytes"],
    "cpuInstructions": { "value": "1843210", "limit": "10000000" },
    "minResourceFee": { "value": "61234", "limit": "1000000" }
  }
}
```

### Failure: over budget

```json
{
  "id": "create",
  "type": "invokeContract",
  "status": "failed",
  "message": "Simulated CPU instructions exceeded the configured limit; transaction was not submitted.",
  "resources": {
    "simulation": {
      "status": "complete",
      "cpuInstructions": { "value": "12500000", "limit": "10000000" },
      "minResourceFee": { "value": "402118", "limit": "1000000" }
    }
  },
  "error": {
    "code": "resource_limit_exceeded",
    "category": "validation",
    "retryable": false
  }
}
```

### Failure: resource data unavailable

```json
{
  "id": "create",
  "type": "invokeContract",
  "status": "failed",
  "message": "Simulation did not return resource data; transaction was not submitted.",
  "resources": {
    "simulation": { "status": "unavailable" }
  },
  "error": {
    "code": "simulation_unavailable",
    "category": "network",
    "retryable": true
  }
}
```

The shapes above show where evidence fits next to existing step fields. Exact
nesting and error placement are decided by the v2 report schema.

## Dependencies

- Requires the prototype decision in
  [FIRST_FIXTURE_DECISION.md](./FIRST_FIXTURE_DECISION.md).
- Ceilings recorded with the artifact are checked by the local integration
  tier in [TEST_STRATEGY.md](./TEST_STRATEGY.md).
