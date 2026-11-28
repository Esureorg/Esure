# Deterministic Local Test Strategy

Status: **design checklist**. There is no executable contract package yet. This
document defines how a future fixture is tested so that results are
reproducible. It adds no deployment scripts, CI jobs, or network
infrastructure.

The strategy is written for the conditional-payment fixture chosen in
[FIRST_FIXTURE_DECISION.md](./FIRST_FIXTURE_DECISION.md), but the tiers apply
to any fixture admitted through [DESIGN.md](./DESIGN.md).

## Test tiers

| Tier | Runs | Network | Required for merge |
| --- | --- | --- | --- |
| 1. Rust unit tests | Every change, default CI | None (in-process Soroban test environment) | Yes |
| 2. Local integration | Every change that touches the artifact or harness, default CI | None, or a local network container started by the test itself | Yes, once a harness exists |
| 3. Testnet smoke | Manual or scheduled, opt-in | Stellar Testnet only | No |

### 1. Rust unit tests (in `esure-contracts`)

Checks that depend only on contract logic:

- Each public function's success path and return value.
- Each documented error code: wrong signer, release after expiry, refund
  before expiry, double settlement, unknown condition ID.
- Authorization: the expected address is required for each function, and no
  other address satisfies it.
- Events: each state transition emits exactly one event with the documented
  topics and data.
- Storage: one record per condition, correct key, correct storage type, and
  TTL extension behavior.
- Boundary values: minimum and maximum amount allowed by the schema, expiry at
  exactly the current ledger and one ledger after.
- Resource ceilings: CPU and memory budget for each function measured with the
  test environment's budget tracking and compared with the ceilings published
  in the artifact metadata (see
  [SIMULATION_RESOURCES.md](./SIMULATION_RESOURCES.md)).

### 2. Local integration (harness in `esure-backend`, artifact from `esure-contracts`)

Checks that depend on the boundary between Esure and the contract:

- Artifact resolution: allowlisted `fixtureId@version` resolves, digest is
  verified, and a tampered artifact fails with `fixture_digest_mismatch`
  (gates G2 and G5 in [FIXTURE_IDENTITY.md](./FIXTURE_IDENTITY.md)).
- Schema v2 validation rejects literal contract IDs, unknown functions,
  untyped or oversized arguments, and non-Testnet networks before any network
  call.
- Simulation handling: resource evidence is recorded, ceilings are enforced,
  and `unavailable` simulation fails the step instead of submitting.
- Report shape: reports validate against the v2 report schema, stay within
  size limits, and contain no secrets, raw XDR, or WASM bytes.
- Assertion semantics: a false or absent result is distinguished from an RPC,
  simulation, or authorization failure.
- The full [user journey](./FIRST_FIXTURE_DECISION.md#user-journey) runs end
  to end against a local network or a recorded RPC double.

### 3. Opt-in Testnet smoke

Checks that only a real network can show:

- The published artifact deploys and the full user journey completes.
- Contract IDs are new for the run (no reuse across runs).
- Bounded confirmation wait and bounded retry behave as configured.

Smoke tests run only when explicitly enabled, never on pull requests from
forks, and never against Mainnet. A smoke failure is reported for
investigation; it does not block merges because Testnet availability and resets
are outside the project's control (see
[Testnet Reset Recovery](../esure-docs/TESTNET_RESET_RECOVERY.md)).

## Reproducible fixtures

- **Pinned toolchain.** The Rust toolchain, `soroban-sdk` version, and build
  target are pinned in the contract package so the same source builds the same
  WASM.
- **Pinned artifact.** Tiers 2 and 3 consume the published artifact by version
  and SHA-256 digest, not a fresh local build, so they test what users run.
- **Fixed ledger state.** Unit tests set ledger timestamp, sequence, protocol
  version, and network ID explicitly; nothing reads wall-clock time.
- **Deterministic accounts.** Unit and local integration tests derive keypairs
  from fixed test seeds. Testnet smoke tests generate fresh keypairs, matching
  classic `generate: true` behavior; seeds never leave the test process.
- **Deterministic salts.** Deployment salts are derived from the run ID in
  tests so that contract IDs are predictable locally and unique per Testnet
  run.
- **Recorded RPC responses.** Where tier 2 uses an RPC double, responses are
  stored as sanitized fixtures with their RPC and SDK versions noted, and are
  refreshed deliberately, not automatically.
- **No shared state.** Each test creates its own contract instance; no test
  depends on order or on state from another test.

## Failure injection

Each injected failure must produce the documented error, not a passing or
silently skipped step.

| Injected condition | Tier | Expected outcome |
| --- | --- | --- |
| Wrong signer for `release` or `refund` | 1, 2 | Authorization error; report explains the required signer. |
| Ledger time advanced past expiry before `release` | 1, 2 | Contract "expired" error. |
| `refund` before expiry | 1, 2 | Contract "not expired" error. |
| Second `release` after settlement | 1, 2 | Contract "already settled" error. |
| Unknown condition ID | 1, 2 | Contract "not found" error. |
| Function exceeds CPU or memory ceiling | 1, 2 | Unit test fails; harness reports `resource_limit_exceeded` and does not submit. |
| Artifact bytes changed under the same version | 2 | `fixture_digest_mismatch`; run stops before network calls. |
| Simulation returns no resource data | 2 | `simulation_unavailable`; step fails, no submission. |
| RPC timeout during confirmation | 2 | Timeout error with `retryable: true`; no duplicate submission. |
| Contract instance missing (reset or TTL expiry) | 2 | `fixture_stale`; run stops before invocation. |
| Oversized argument or event payload | 2 | Validation error before submission, or bounded truncation in the report. |

## Design checklist

A future pull request that adds the first contract package should satisfy:

- [ ] Contract package with pinned toolchain and `soroban-sdk` version.
- [ ] Rust unit tests for every function, error code, event, and auth rule.
- [ ] Unit tests set ledger time, sequence, and network ID explicitly.
- [ ] Unit tests assert per-function resource ceilings.
- [ ] Artifact metadata includes version, WASM digest, interface digest,
      source revision, and resource ceilings.
- [ ] Local integration tests cover every row in
      [Failure injection](#failure-injection) marked tier 2.
- [ ] No test reads wall-clock time, depends on test order, or reuses contract
      IDs across tests.
- [ ] Testnet smoke tests are opt-in, Testnet-only, and not required for merge.
- [ ] No deployment scripts, shared deployments, or Mainnet configuration are
      added in the same change.
- [ ] Reports produced by tests contain no secrets, raw XDR, or WASM bytes.

## Dependencies

- [FIRST_FIXTURE_DECISION.md](./FIRST_FIXTURE_DECISION.md): fixture and
  acceptance criteria.
- [FIXTURE_IDENTITY.md](./FIXTURE_IDENTITY.md): identity fields and stale
  reference gates.
- [SIMULATION_RESOURCES.md](./SIMULATION_RESOURCES.md): resource evidence and
  ceilings.
