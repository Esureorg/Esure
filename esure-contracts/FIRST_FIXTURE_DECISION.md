# First Fixture Decision

Status: **proposal-only**. This record chooses which fixture a future
prototype should start with. It does not approve contract code, add a contract
package, or deploy anything to Testnet or Mainnet.

## Background

[DESIGN.md](./DESIGN.md) names a minimal conditional-payment contract as the
candidate first fixture. [PROPOSAL.md](./PROPOSAL.md) illustrates scenario
shapes with a token fixture (deploy, initialize, transfer) but does not choose a
first prototype. This record resolves that gap.

## Candidates compared against the admission gate

The [admission rule](./DESIGN.md#admission-rule) requires a repeatable testing
need that classic account, trustline, asset, and payment operations cannot
represent. The table compares both candidates against each required proposal
element.

| Gate element | Token fixture (deploy + transfer) | Conditional-payment fixture |
| --- | --- | --- |
| Developer testing problem | Verify that a token contract initializes and moves balances. | Verify that a contract enforces authorization, expiry, and release/refund rules and reports why a release was rejected. |
| Why a contract is necessary | Weak. Balance transfers between generated accounts are already covered by classic issued-asset scenarios (`issued-asset-payment.json`, `issued-asset-holder-transfer.yaml`). The Stellar Asset Contract also already exposes classic assets to Soroban. | Strong. Time-bound conditional release with contract-enforced authorization cannot be expressed with classic payment operations. |
| Minimal public interface | `initialize`, `transfer`, `balance` plus mint/admin paths to be useful. | `create`, `release`, `refund`, `get` (four functions). |
| Events and diagnostic value | `transfer` duplicates information already visible from classic balances. | `created`, `released`, `refunded` each map to a distinct state transition that a report can explain. |
| Authorization requirements | Admin and holder auth; mint authority adds administrative complexity. | Depositor auth on `create` and `refund`, recipient auth on `release`. Exercises `require_auth` with two distinct signers. |
| Storage lifetime and resource bounds | Unbounded balance map keyed by holder. | One bounded record per condition, keyed by a run-scoped ID; temporary/persistent storage choice is explicit. |
| Failure cases Esure must explain | Insufficient balance, unauthorized transfer: mostly overlap with classic payment failures. | Wrong signer, release after expiry, refund before expiry, double release, unknown condition ID. |
| Local and Testnet behavior | Run-scoped deploy; would invite reuse as a shared token. | Run-scoped deploy; no shared state needed. |
| Deterministic tests | Straightforward, but tests duplicate classic coverage. | Ledger time can be fixed in unit tests, so expiry is deterministic. |
| Versioning and artifact publication | One artifact. | One artifact. |
| [Non-goals](./DESIGN.md#non-goals) | Conflicts with "General-purpose token implementation" and "Duplicating features already covered by classic Stellar operations". | Must stay clear of "Production escrow" and "Custody of real value"; achievable because the fixture holds only Testnet value and has no admin or upgrade path. |

## Decision

The **conditional-payment fixture** is the first prototype candidate. The token
examples in [PROPOSAL.md](./PROPOSAL.md#proposed-scenarios) remain illustrations
of scenario shape only; they are not a planned first fixture.

The token candidate fails the admission gate's "why a contract is necessary"
test and conflicts with two listed non-goals. The conditional-payment candidate
passes the gate and exercises the Soroban-specific assertions the proposal
introduces (`contractDeployed`, `invocationResultEquals`, `eventEmitted`,
`contractStateEquals`) without needing a token standard.

## User journey

A developer building an application that releases Testnet funds only after a
recipient signs, and refunds the depositor after expiry, wants to confirm that
their integration handles both outcomes.

1. The developer selects the published `conditional-payment-release` scenario.
   It declares two generated, funded accounts (`depositor`, `recipient`) and
   references the pinned fixture artifact by version and digest.
2. Esure validates the scenario, resolves the artifact, verifies its digest,
   and deploys a fresh run-scoped contract instance.
3. `depositor` invokes `create` with a bounded native-asset amount, the
   `recipient` address, and an expiry a bounded number of ledgers ahead.
4. `depositor` attempts `release`. The invocation fails authorization, and the
   report explains that only the recipient may release.
5. `recipient` invokes `release`. The invocation succeeds and emits `released`.
6. `recipient` invokes `release` again. The invocation fails with the
   contract's "already settled" error.
7. The report lists each step with its contract ID, invocation result, events,
   bounded resource evidence (see
   [SIMULATION_RESOURCES.md](./SIMULATION_RESOURCES.md)), and the final
   `contractStateEquals` check showing status `released`.

## Measurable acceptance criteria for a future prototype

A prototype is accepted only when all of the following hold:

- [ ] The public interface has at most four functions (`create`, `release`,
      `refund`, `get`) and no admin, mint, or upgrade entry point.
- [ ] Every state transition emits exactly one event (`created`, `released`,
      `refunded`), and the event appears in the run report.
- [ ] The five failure cases (wrong signer, release after expiry, refund before
      expiry, double settlement, unknown condition ID) each return a distinct,
      documented contract error code.
- [ ] Rust unit tests cover every function and every failure case with a fixed
      ledger timestamp and sequence, and pass identically on repeated runs (see
      [TEST_STRATEGY.md](./TEST_STRATEGY.md)).
- [ ] The amount held by one condition is bounded by the scenario schema's
      existing `amount` pattern and is denominated only in Testnet native asset.
- [ ] Simulated CPU instructions, memory, and ledger I/O for each function stay
      under the resource ceilings recorded with the artifact.
- [ ] The artifact is published with an explicit version and SHA-256 digest,
      and the reference in the scenario fails validation if the digest differs.
- [ ] The end-to-end journey above completes on Testnet in an opt-in smoke run
      with no reused contract IDs from earlier runs.

## Constraints that remain in force

- No contract is deployed by this record or by the repository's default CI.
- Testnet-only, allowlisted artifacts, bounded inputs, and the classic v1
  schema remain unchanged as described in [PROPOSAL.md](./PROPOSAL.md).
- Dependent work: [FIXTURE_IDENTITY.md](./FIXTURE_IDENTITY.md),
  [SIMULATION_RESOURCES.md](./SIMULATION_RESOURCES.md), and
  [TEST_STRATEGY.md](./TEST_STRATEGY.md) assume this decision.
