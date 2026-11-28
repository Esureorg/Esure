# Esure Frontend

![Esure logo](./public/esure-mark.svg)

The web dashboard for running and inspecting Esure Stellar Testnet scenarios.

## Requirements

- Node.js 20.9 or newer
- A running `esure-backend` instance

## Setup

```bash
npm install
copy .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The server-side proxy connects to the backend at
`ESURE_BACKEND_URL`, which defaults to `http://127.0.0.1:3001`.

## Scenario favorites

Use the star on a scenario card to add or remove it from Favorites, then select
the Favorites filter to show only saved scenarios. Favorites are stored in this
browser's `localStorage`, scoped to the dashboard's exact origin (protocol,
hostname, and port). They are not associated with an Esure account, do not sync
between browsers or devices, and are not saved to the backend. Clearing this
site's browser data or local storage removes them.

If browser storage is blocked, unavailable, or full, favorites still work in
the current page session, but changes cannot be saved and will not be available
after a reload. Storage errors do not prevent loading or running scenarios.

## Commands

```bash
npm run dev
npm run typecheck
npm run build
npm test
npm run start
```

## Security boundary

The browser communicates with a same-origin Next.js proxy. The backend origin is
server-only configuration and is not embedded in the client bundle. This app
never requests, receives, or stores Stellar secret keys.
