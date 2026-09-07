# Esure System Architecture

## Context

```text
Browser
   |
   | HTTPS / JSON
   v
Esure Frontend
   |
   | REST API
   v
Esure Backend --------> PostgreSQL
   |
   +-------------------> Stellar Horizon / RPC
   |
   +-------------------> Friendbot (Testnet only)

Future: Backend --------> Esure Soroban contracts
```

## Components

### Frontend

The frontend presents scenarios and execution reports. It never receives or
handles generated account secrets. It treats backend reports as untrusted input
and renders them without executing embedded content.

### Backend

The backend validates scenarios, creates ephemeral Testnet identities, submits
operations in sequence, records sanitized results, evaluates assertions, and
explains known errors.

### Database

PostgreSQL stores scenario metadata and sanitized reports. It must not store
generated secret keys. Phase 1 uses an in-memory store so the execution model
can stabilize before the schema is committed.

### Contracts

The contracts repository is outside the MVP execution path. When Soroban
scenarios are added, it will publish WASM artifacts and interface metadata for
the backend through versioned releases.

## Runtime flow

```text
Requested -> Validating -> Running -> Passed
                                 \-> Failed
```

1. The frontend requests an enabled scenario.
2. The backend validates the request and creates a run identifier.
3. A runner executes steps sequentially with a per-step timeout.
4. Each completed step appends a sanitized result.
5. Assertions inspect public ledger state and step results.
6. The final immutable report is stored and returned.

## Core domain types

- **Scenario:** versioned instructions and assertions.
- **Run:** one isolated execution of a scenario.
- **Step:** one supported Stellar operation.
- **Step result:** sanitized evidence produced by a step.
- **Assertion:** a deterministic check evaluated after execution.
- **Report:** the complete public result of a run.

## Security boundaries

- Scenario input is untrusted and must pass strict schema validation.
- Only allowlisted step types may execute; arbitrary commands are forbidden.
- Generated keys live only for a run and are redacted from errors and logs.
- The MVP is hard-coded to Testnet and rejects Mainnet configuration.
- External calls require timeouts and bounded retries.
- Asset codes, amounts, memo values, and references have explicit limits.
- Public endpoints require rate limiting before hosted deployment.

## Initial technology decisions

| Area | Choice |
| --- | --- |
| Frontend | Next.js, TypeScript, Tailwind CSS |
| Backend | Node.js, TypeScript, Fastify |
| Validation | JSON Schema through Fastify |
| Stellar | `@stellar/stellar-sdk` |
| Persistence | PostgreSQL with Prisma in Phase 3 |
| Unit tests | Vitest |
| Browser tests | Playwright |
| Contracts | Rust and Soroban SDK after MVP |
| Documentation | Markdown first; framework deferred |

## Cross-repository contract

The backend owns the canonical OpenAPI document and scenario JSON Schema. The
frontend consumes types from tagged backend releases. Equivalent types must not
be copied and edited independently across repositories.

