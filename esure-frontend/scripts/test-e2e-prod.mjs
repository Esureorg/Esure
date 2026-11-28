#!/usr/bin/env node
// Runs the Playwright suite against the production server on every OS.
// Setting TEST_MODE inline (TEST_MODE=production playwright test) only works
// in POSIX shells, so the variable is set here before Playwright starts.
// Extra arguments are forwarded, and the exit code (or signal) is preserved.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");

const child = spawn(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, TEST_MODE: "production" },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
