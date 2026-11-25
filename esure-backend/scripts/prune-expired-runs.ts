/**
 * Operator-invoked pruning of expired run reports (issue #160).
 *
 * Physically deletes terminal (`passed`/`failed`) run reports that are past
 * the configured RUN_RETENTION_MS cutoff, in bounded batches, through the
 * audited cleanup path required by the `guard_run_cleanup` trigger: each batch
 * runs as the `esure_maintenance` role with transaction-local
 * `esure.cleanup_mode=on` and writes a `cleanup_audit` row per deleted run.
 * The database additionally enforces a hard 30-day floor, so runs younger
 * than 30 days are never deleted regardless of retention settings.
 *
 * Usage:
 *   npm run prune:runs [-- --dry-run] [--batch-size=N]
 *
 *   --dry-run       Report the eligible count without deleting anything.
 *   --batch-size=N  Rows deleted per transaction (default 100, minimum 1).
 *
 * Repeatability and partial failure: every batch commits atomically and the
 * loop stops at the first failing batch, so a rerun is idempotent and only
 * reprocesses whatever remains eligible.
 *
 * Exit codes:
 *   0 - prune (or dry-run) completed; the deleted (or eligible) count is
 *       printed.
 *   2 - the prune failed (e.g. cannot reach the database or the login lacks
 *       esure_maintenance membership). Connection details/credentials are
 *       redacted from any logged error.
 */
import { loadConfig } from "../src/config.js";
import { Database } from "../src/database.js";
import { PostgresRunStore } from "../src/run-store.js";

const dryRun = process.argv.includes("--dry-run");
const batchSizeArg = process.argv.find((arg) => arg.startsWith("--batch-size="));
const batchSize = batchSizeArg ? Number.parseInt(batchSizeArg.slice("--batch-size=".length), 10) : 100;
if (!Number.isInteger(batchSize) || batchSize < 1) {
  console.error("--batch-size must be a positive integer.");
  process.exit(2);
}

const config = loadConfig({ ...process.env, PERSISTENCE_MODE: "published" });
const database = new Database(config);

try {
  const store = new PostgresRunStore(database, config.runRetentionMs);
  const count = await store.pruneExpired(batchSize, { dryRun });
  const verb = dryRun ? "eligible for pruning" : "pruned";
  console.log(`${count} run report(s) ${verb}.`);
  process.exitCode = 0;
} catch (error) {
  console.error(`prune-expired-runs failed: ${redactConnectionDetails(error instanceof Error ? error.message : String(error))}`);
  process.exitCode = 2;
} finally {
  await database.close();
}

/** Strips any connection string / credential-bearing substrings from a log message. */
function redactConnectionDetails(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[REDACTED_CONNECTION_STRING]");
}