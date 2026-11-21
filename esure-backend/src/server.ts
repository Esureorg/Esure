import { buildApp, closeAfterDrain } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = buildApp({ config, logger: true });

try {
  const address = await app.listen({ host: config.host, port: config.port });
  app.log.info({ address }, "Esure backend is listening");
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

// ── Graceful-shutdown lifecycle ──────────────────────────────────────────────
//
// SIGTERM and SIGINT each trigger shutdown exactly once.  The sequence is:
//   1. Mark the RunService as draining — new run POSTs get 503 immediately.
//   2. Wait for active executions, capped at DRAIN_TIMEOUT_MS.
//   3. Close Fastify (which fires onClose hooks, releasing DB pools / timers).
//   4. Exit.  If anything throws we still exit, just with code 1.

const DRAIN_TIMEOUT_MS = 30_000;

let shuttingDown = false;

export async function shutdownLogic(
  logApp: { log: { info(...args: unknown[]): void; error(...args: unknown[]): void } },
  drain: () => Promise<void>,
  signal: string,
): Promise<number> {
  logApp.log.info({ signal }, "Shutdown signal received — draining active runs");
  let cleanupFailed = false;
  try {
    await drain();
  } catch (closeError) {
    logApp.log.error(closeError, "Error while draining or closing the server");
    cleanupFailed = true;
  }
  logApp.log.info("Shutdown complete");
  return cleanupFailed ? 1 : 0;
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const code = await shutdownLogic(app, () => closeAfterDrain(app, DRAIN_TIMEOUT_MS), signal);
  process.exit(code);
}

process.once("SIGTERM", () => { shutdown("SIGTERM").catch((err) => { app.log.error(err, "Fatal during SIGTERM shutdown"); process.exit(1); }); });
process.once("SIGINT",  () => { shutdown("SIGINT").catch((err)  => { app.log.error(err, "Fatal during SIGINT shutdown");  process.exit(1); }); });
