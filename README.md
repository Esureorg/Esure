# Esure

**Test with confidence. Build on Stellar.**

Esure is an open-source testing and simulation toolkit for verifying Stellar
payment flows on Testnet before integrating them into production applications.

- Frontend: <https://esure-testnet.vercel.app>
- Backend health: <https://esure.onrender.com/health>
- API description: <https://esure.onrender.com/openapi.json>

## Repository layout

| Directory | Purpose |
| --- | --- |
| `esure-frontend` | Next.js dashboard and browser-facing API proxy |
| `esure-backend` | Fastify API, scenario validation, and Testnet runner |
| `esure-docs` | Product, architecture, API, and persistence documentation |
| `esure-contracts` | Design space for post-MVP Soroban fixtures |

## Five-minute local quick start

Requirements:

- Node.js 20 or newer
- npm
- Network access to Stellar Testnet for live scenario runs

Clone the monorepo and install both applications:

```bash
git clone https://github.com/Esureorg/Esure.git
cd Esure
cd esure-backend && npm ci && cd ..
cd esure-frontend && npm ci && cd ..
```

Create local environment files on macOS or Linux:

```bash
cp esure-backend/.env.example esure-backend/.env
cp esure-frontend/.env.example esure-frontend/.env.local
```

On Windows PowerShell:

```powershell
Copy-Item esure-backend/.env.example esure-backend/.env
Copy-Item esure-frontend/.env.example esure-frontend/.env.local
```

Start the backend in the first terminal:

```bash
cd esure-backend
npm run dev
```

Start the frontend in a second terminal:

```bash
cd esure-frontend
npm run dev
```

Open <http://localhost:3000>. The backend listens on
<http://127.0.0.1:3001> by default.

Verify the backend:

```bash
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/api/v1/scenarios
```

The health response should include `"status":"ok"`, and the scenario response
should list the bundled XLM payment, issued-asset payment, and expected-failure
flows.

## Quality checks

Run the same deterministic checks used by CI:

```bash
cd esure-backend
npm run check
npm run build

cd ../esure-frontend
npm run check
```

Normal tests do not submit real transactions. The opt-in Testnet smoke test is
documented in [`esure-backend/README.md`](esure-backend/README.md).

## Deployment layout

- Vercel deploys the `esure-frontend` root directory.
- Render deploys the `esure-backend` root directory.
- The frontend server uses `ESURE_BACKEND_URL` to reach the Render service.
- PostgreSQL is optional while `PERSISTENCE_MODE=disabled`; published catalogue
  persistence requires migrations and the configuration described in
  [`esure-docs/PERSISTENCE.md`](esure-docs/PERSISTENCE.md).

## Safety boundary

Esure is restricted to Stellar Testnet. It does not accept secret seeds, raw
XDR, scripts, arbitrary URLs, or Mainnet operations in scenario definitions.
Generated Testnet secrets remain in process memory during execution and are not
returned in API responses or reports.

See [`esure-docs/MVP.md`](esure-docs/MVP.md) for product scope and
[`esure-docs/ARCHITECTURE.md`](esure-docs/ARCHITECTURE.md) for the system design.
