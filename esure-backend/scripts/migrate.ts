import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { Database, runMigrations } from "../src/database.js";

// Issue #227: resolve the migrations directory relative to this package so the
// script behaves identically whether invoked from the repo root, the backend
// directory, or any other working directory.
const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../migrations");

const config = loadConfig({ ...process.env, PERSISTENCE_MODE: "published", DATABASE_URL: process.env.DATABASE_MIGRATION_URL });
const database = new Database(config);
try { await runMigrations(database, migrationsDir, "esure_migrations"); }
finally { await database.close(); }
