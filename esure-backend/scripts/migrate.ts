import { loadConfig } from "../src/config.js";
import { Database, runMigrations } from "../src/database.js";

const config = loadConfig({ ...process.env, PERSISTENCE_MODE: "published", DATABASE_URL: process.env.DATABASE_MIGRATION_URL });
const database = new Database(config);
try { await runMigrations(database, undefined, "esure_migrations"); }
finally { await database.close(); }
