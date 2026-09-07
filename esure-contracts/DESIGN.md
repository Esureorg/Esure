# Soroban Fixture Design Gate

The contracts repository is intentionally code-free during Esure's classic
payment MVP.

## Admission rule

A contract may be added only when a written proposal demonstrates a repeatable
Stellar application testing need that cannot be represented by classic account,
trustline, asset, and payment operations.

Every proposal must define:

- The developer testing problem
- Why a contract is necessary
- The minimal public interface
- Events and their diagnostic value
- Authorization requirements
- Storage lifetime and resource bounds
- Failure cases Esure must explain
- Local and Testnet deployment behavior
- Deterministic unit and integration tests
- Versioning and artifact publication

## Candidate first fixture

A minimal conditional-payment contract may eventually test authorization,
contract events, expiration, and successful or rejected release. This is a
candidate, not an approved implementation.

## Non-goals

- Production escrow
- Custody of real value
- Mainnet deployment
- General-purpose token implementation
- Upgradeable or administratively complex contracts
- Duplicating features already covered by classic Stellar operations

