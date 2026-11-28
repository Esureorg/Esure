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

In `published` mode, PostgreSQL durably stores the published scenario catalogue
and its versions. Run reports use an in-memory store by default; PostgreSQL report
storage is a separate opt-in. Persisted reports are sanitized, and generated
secret keys must never be stored. See the [persistence guide](PERSISTENCE.md).

### Contracts

Soroban execution is not part of the MVP runtime. The future contract-fixture
design is a proposal in the [contracts repository](../esure-contracts/PROPOSAL.md);
it describes versioned WASM artifacts and interface metadata for a possible
backend integration.

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
6. The final sanitized report is returned and held by the configured run store:
   in memory by default or in PostgreSQL when run-report persistence is enabled.

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
- The public API applies per-IP rate limits, with a stricter limit for run creation.

## Initial technology decisions

| Area | Choice |
| --- | --- |
| Frontend | Next.js, TypeScript, Tailwind CSS |
| Backend | Node.js, TypeScript, Fastify |
| Validation | JSON Schema through Fastify |
| Stellar | `@stellar/stellar-sdk` |
| Persistence | Optional PostgreSQL catalogue and report stores through `pg` and SQL migrations |
| Unit tests | Vitest |
| Browser tests | Playwright |
| Contracts | Not in the runtime; future integration is proposal-only |
| Documentation | Markdown first; framework deferred |

## Shutdown and deployment drain

The backend drains in-flight work on process shutdown. The sequence below is
implemented in `esure-backend/src/server.ts` and `esure-backend/src/app.ts`
(`closeAfterDrain`); verify against those files before relying on it.

### Signals and shutdown sequence

- `SIGTERM` and `SIGINT` each trigger shutdown exactly once; a second signal
  during an in-progress drain is ignored.
- The sequence is:
  1. Mark `RunService` as draining. New run-creation `POST` requests are
     rejected immediately with `503` and reason `"draining"`, and are counted in
     `esure_rejected_run_starts_total{reason="draining"}`.
  2. Wait for active executions to finish, capped at a fixed
     `DRAIN_TIMEOUT_MS` of 30 000 ms.
  3. Close Fastify, firing `onClose` hooks that release database pools and
     timers.
  4. Exit with code `0`, or `1` if an error occurred during shutdown.

### Persistence implications

- If the drain deadline elapses, in-flight runs may be abandoned; their final
  reports are not guaranteed to be recorded.
- In-memory run state is lost on restart.
- Reports persisted to PostgreSQL (when run-report persistence is enabled)
  survive restarts. See the [persistence guide](PERSISTENCE.md).

### Health and readiness checks

- `GET /health` is a cheap liveness probe and is exempt from rate limiting.
- `GET /ready` returns `200` with database status when persistence is
  available, or `503` when it is unavailable.

### Deployment drain sequence

1. Stop routing new traffic to the instance (remove it from the load balancer).
2. Send `SIGTERM` to the process.
3. Poll `GET /ready` until it returns `503` or the process exits.
4. Wait up to 30 s for the drain to complete.
5. Force-kill the process if it has not exited.

### Planned work

Deadline cancellation of in-flight runs (actively aborting executions when
`DRAIN_TIMEOUT_MS` elapses) is **planned and not yet implemented**. Today the
drain simply stops waiting at the deadline; it does not cancel running work.

## Cross-repository contract

The backend owns the canonical OpenAPI document and scenario JSON Schema. The
frontend consumes types from tagged backend releases. Equivalent types must not
be copied and edited independently across repositories.

