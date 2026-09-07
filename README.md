# Esure

[![Monorepo CI](https://github.com/Esureorg/Esure/actions/workflows/ci.yml/badge.svg)](https://github.com/Esureorg/Esure/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Stellar: Testnet](https://img.shields.io/badge/Stellar-Testnet-7C3AED)](https://developers.stellar.org/docs/networks/testnet)

**Test with confidence. Build on Stellar.**

Esure is an open-source testing and simulation toolkit that helps developers
validate Stellar payment flows before integrating them into production
applications. It turns multi-step Testnet operations into repeatable scenarios
with structured reports, transaction links, balance changes, and readable
failure explanations.

> [!IMPORTANT]
> Esure is an MVP built exclusively for Stellar Testnet. It must not be used for
> Mainnet transactions or real-value assets.

## Live services

| Service | URL |
| --- | --- |
| Web dashboard | [esure-testnet.vercel.app](https://esure-testnet.vercel.app) |
| Backend health | [esure.onrender.com/health](https://esure.onrender.com/health) |
| OpenAPI document | [esure.onrender.com/openapi.json](https://esure.onrender.com/openapi.json) |

The Render free service may sleep after inactivity, so its first response can
take longer than subsequent requests.

## MVP capabilities

- Run predefined XLM payment, issued-asset payment, and expected-failure flows.
- Create and fund isolated accounts on Stellar Testnet.
- Establish trustlines and submit classic asset payments.
- Track execution steps and verify transaction outcomes and balances.
- Produce sanitized reports without exposing account secrets.
- Validate bounded declarative JSON and YAML scenario definitions.
- Optionally persist the published scenario catalogue in PostgreSQL.

See the [MVP specification](esure-docs/MVP.md) for the complete product scope.

## Architecture

```text
Browser
   |
   v
Next.js dashboard and same-origin proxy
   |
   v
Fastify API and scenario runner
   |----------------------|
   v                      v
Stellar Testnet      PostgreSQL (optional)
```

| Directory | Responsibility |
| --- | --- |
| [`esure-frontend`](esure-frontend) | Next.js dashboard and browser-facing API proxy |
| [`esure-backend`](esure-backend) | Fastify API, validation, reporting, and Testnet execution |
| [`esure-docs`](esure-docs) | Product, API, architecture, scenario, and persistence documentation |
| [`esure-contracts`](esure-contracts) | Design space for post-MVP Soroban fixtures |
| [`.github`](.github) | CI, issue templates, contribution guidance, and security policy |

For deeper technical context, read the
[architecture documentation](esure-docs/ARCHITECTURE.md).

## Quick start

### Prerequisites

- Git
- Node.js 20 or newer
- npm
- Network access to Stellar Testnet for live runs

### 1. Clone and install

```bash
git clone https://github.com/Esureorg/Esure.git
cd Esure

cd esure-backend
npm ci
cd ../esure-frontend
npm ci
cd ..
```

### 2. Configure the applications

macOS and Linux:

```bash
cp esure-backend/.env.example esure-backend/.env
cp esure-frontend/.env.example esure-frontend/.env.local
```

Windows PowerShell:

```powershell
Copy-Item esure-backend/.env.example esure-backend/.env
Copy-Item esure-frontend/.env.example esure-frontend/.env.local
```

The frontend defaults to a backend at `http://127.0.0.1:3001`. To use another
backend, set `ESURE_BACKEND_URL` in `esure-frontend/.env.local`.

### 3. Start the backend

In the first terminal:

```bash
cd esure-backend
npm run dev
```

Verify the API:

```bash
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/api/v1/scenarios
```

### 4. Start the frontend

In a second terminal:

```bash
cd esure-frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## API overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Confirm the API process is available |
| `GET` | `/ready` | Confirm dependencies are ready |
| `GET` | `/api/v1/scenarios` | List available scenarios |
| `POST` | `/api/v1/scenarios/validate` | Validate a scenario definition |
| `POST` | `/api/v1/runs` | Start a bundled scenario |
| `GET` | `/api/v1/runs/:runId` | Read current run state |
| `GET` | `/api/v1/runs/:runId/report` | Download a structured report |

The complete contract is available from the deployed
[OpenAPI document](https://esure.onrender.com/openapi.json) and the
[API documentation](esure-docs/API.md).

## Development and testing

Run the same deterministic checks used by CI:

```bash
cd esure-backend
npm run check
npm run build

cd ../esure-frontend
npm run check
```

Normal automated tests do not submit real transactions. The opt-in Testnet
smoke test is documented in the [backend README](esure-backend/README.md).

## Persistence

The default `PERSISTENCE_MODE=disabled` configuration keeps runtime state in
memory. Published scenario catalogue persistence can be enabled with PostgreSQL
after applying the checked migrations and configuring the required database
roles. See the [persistence guide](esure-docs/PERSISTENCE.md) before enabling it.

## Deployment

| Component | Platform | Root directory |
| --- | --- | --- |
| Frontend | Vercel | `esure-frontend` |
| Backend | Render | `esure-backend` |
| Database | PostgreSQL provider | Not applicable |

Set `ESURE_BACKEND_URL` in Vercel to the public Render backend origin. Keep
secrets and migration credentials in the hosting provider environment settings;
never commit them to the repository.

## Security

Esure rejects secret seeds, raw XDR, scripts, arbitrary URLs, unresolved
references, unknown scenario properties, and Mainnet configuration. Generated
Testnet secrets remain only in process memory during execution and are excluded
from API responses, logs, and reports.

Please report vulnerabilities according to the
[security policy](.github/SECURITY.md). Do not disclose sensitive findings in a
public issue.

## Contributing

Contributions are welcome. Before opening a pull request:

1. Read the [contribution guide](.github/CONTRIBUTING.md).
2. Choose or open a focused GitHub issue.
3. Keep changes within the documented Testnet-only safety boundary.
4. Run the relevant checks locally.
5. Link the pull request to its issue.

## License

Esure is released under the [MIT License](LICENSE).
