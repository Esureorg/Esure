import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { Database } from "../src/database.js";

export const embeddedPostgresAvailable =
  process.platform !== "win32" ||
  existsSync("C:/Windows/System32/VCRUNTIME140.dll") ||
  existsSync("node_modules/@embedded-postgres/windows-x64/native/bin/VCRUNTIME140.dll");

export interface EmbeddedPostgresContext {
  database: Database;
  databaseUrl: string;
  directory: string;
  port: number;
  postgres: EmbeddedPostgres;
  stop(): Promise<void>;
}

export async function startEmbeddedPostgres(options: {
  prefix: string;
  setup?: (context: EmbeddedPostgresContext) => Promise<void>;
}): Promise<EmbeddedPostgresContext> {
  const port = await allocatePort();
  const directory = await mkdtemp(join(tmpdir(), options.prefix));
  let postgres: EmbeddedPostgres | undefined;
  let database: Database | undefined;
  let stopped = false;

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await database?.close().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };

  try {
    postgres = new EmbeddedPostgres({
      databaseDir: directory,
      user: "postgres",
      password: "test-password",
      port,
      persistent: true,
      onLog: () => undefined,
      onError: () => undefined,
    });
    await postgres.initialise();
    await postgres.start();

    const databaseUrl = `postgres://postgres:test-password@127.0.0.1:${port}/postgres`;
    database = new Database({
      host: "127.0.0.1",
      port: 3001,
      logLevel: "silent",
      horizonUrl: "https://horizon-testnet.stellar.org",
      friendbotUrl: "https://friendbot.stellar.org",
      runTimeoutMs: 5_000,
      stepTimeoutMs: 1_000,
      maxConcurrentRuns: 2,
      maxStoredRuns: 100,
      runRetentionMs: 60_000,
      rateLimitMax: 100,
      runRateLimitMax: 50,
      rateLimitWindowMs: 60_000,
      bodyLimitBytes: 16_384,
      persistenceMode: "published",
      runPersistenceEnabled: true,
      databaseUrl,
      databasePoolMax: 5,
      databaseConnectionTimeoutMs: 5_000,
      databaseQueryTimeoutMs: 5_000,
      databaseIdleTimeoutMs: 10_000,
    });

    const context: EmbeddedPostgresContext = { database, databaseUrl, directory, port, postgres, stop };
    await options.setup?.(context);
    return context;
  } catch (error) {
    await stop();
    throw error;
  }
}

async function allocatePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate an ephemeral port.")));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}
