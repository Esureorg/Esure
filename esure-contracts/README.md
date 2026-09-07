# Esure Contracts

Soroban contracts, tests, and deployment tooling used by Esure scenarios.

## Responsibilities

- Maintain reusable Soroban testing contracts
- Provide deterministic fixtures for common payment flows
- Define and document contract events
- Include Rust unit and integration tests
- Provide testnet and local-network deployment scripts
- Publish contract IDs and interface metadata for `esure-backend`

## Boundary

Only logic that must execute on-chain belongs here. Scenario orchestration,
user accounts, and report storage belong in `esure-backend`.

## Status

Architecture and product-definition phase. Contracts will be introduced only
when an MVP scenario demonstrates a genuine on-chain requirement.

Read the [Soroban fixture design gate](./DESIGN.md) before proposing contract
code.
