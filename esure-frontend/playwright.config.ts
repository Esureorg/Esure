import { defineConfig, devices } from "@playwright/test";

const port = process.env.PORT || 3000;
const baseURL = `http://localhost:${port}`;
const isProduction = process.env.TEST_MODE === "production";

// Deterministic fake backend used by the real Next.js proxy during e2e runs.
// The proxy reads ESURE_BACKEND_URL (see src/app/api/backend/[...path]/route.ts).
const backendPort = process.env.ESURE_FAKE_BACKEND_PORT || 4010;
const backendURL = `http://127.0.0.1:${backendPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    "list",
    ["html", { outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: [
    {
      // Fake local HTTP backend: serves scenarios, run creation, polling,
      // and report download. No Stellar/Testnet calls are made.
      command: `node e2e/fake-backend/server.mjs --port ${backendPort}`,
      url: `${backendURL}/__health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        ESURE_FAKE_BACKEND_PORT: String(backendPort),
      },
    },
    isProduction
      ? {
          command: `npm run start -- --port ${port}`,
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            ESURE_BACKEND_URL: backendURL,
          },
        }
      : {
          command: `npm run dev -- --port ${port}`,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            ESURE_BACKEND_URL: backendURL,
          },
        },
  ],
});