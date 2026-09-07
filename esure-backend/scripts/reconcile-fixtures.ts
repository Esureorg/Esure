import { loadConfig } from "../src/config.js";
import { assertMigrationsCurrent, Database } from "../src/database.js";
import { PublishedScenarioRepository } from "../src/published-scenarios.js";
import { createScenarioRegistry } from "../src/scenarios.js";

const config = loadConfig({ ...process.env, PERSISTENCE_MODE: "published", DATABASE_URL: process.env.DATABASE_MIGRATION_URL });
const database = new Database(config);
try {
  await assertMigrationsCurrent(database);
  await new PublishedScenarioRepository(database).reconcile(createScenarioRegistry(config.scenarioDirectory));
} finally { await database.close(); }

