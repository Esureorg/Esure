# Esure Contracts

Soroban contracts, tests, and deployment tooling used by Esure scenarios.

## Status: Proposal-Only (Design Gate)

**This directory is currently code-free.** It contains no on-chain contract
implementation and accepts none at this time. Contracts are still in a design
gate: the material here describes *eventual* scope and the process for
proposing work, not work that has been approved or started.

Before proposing contract code, read:

- [DESIGN.md](./DESIGN.md) — the Soroban fixture design gate (admission
  checklist and review criteria).
- [PROPOSAL.md](./PROPOSAL.md) — the proposal format and process.

Contract code pull requests are **out of scope** until the design gate is
passed. See [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md) for
contributor guidance.

## Responsibilities (Eventual Scope)

The list below describes the scope this directory is intended to cover **once
the design gate is passed**. It is not a description of current work.

- Maintain reusable Soroban testing contracts
- Provide deterministic fixtures for common payment flows
- Define and document contract events
- Include Rust unit and integration tests
- Provide testnet and local-network deployment scripts
- Publish contract IDs and interface metadata for `esure-backend`

## Boundary

Only logic that must execute on-chain belongs here. Scenario orchestration,
user accounts, and report storage belong in `esure-backend`.

## Evidence Required Before On-Chain Code

No on-chain contract code is accepted until all of the following are in place:

1. **A written proposal** demonstrating a repeatable testing need that classic
   Stellar operations cannot cover. The proposal must follow
   [PROPOSAL.md](./PROPOSAL.md).
2. **The DESIGN.md admission checklist**, covering:
   - the problem being solved
   - why on-chain execution is necessary
   - the minimal interface
   - events
   - authorization
   - storage and resource bounds
   - failure cases
   - deployment behavior
   - deterministic tests
   - versioning and artifact publication
3. **Maintainer approval** of the proposal and design.
4. **Testnet-only constraints** remain in effect: no mainnet deployment, and
   bounded-input constraints apply to all fixtures and tests.

## Status

Architecture and product-definition phase. Contracts will be introduced only
when an MVP scenario demonstrates a genuine on-chain requirement.

Read the [Soroban fixture design gate](./DESIGN.md) before proposing contract
code.