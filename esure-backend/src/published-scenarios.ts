import { stringify as stringifyYaml } from "yaml";
import type { ScenarioSummary, ValidatedScenario } from "./domain.js";
import type { Database, Queryable } from "./database.js";
import { canonicalJson, prepareScenario, type ScenarioRegistry } from "./scenario-loader.js";

export interface ScenarioVersionSummary {
  version: number;
  schemaVersion: 1;
  contentHash: string;
  createdAt: string;
}

interface VersionRow {
  version_number: number;
  schema_version: 1;
  content_hash: string;
  definition: ValidatedScenario;
  created_at: Date | string;
}

export class PublishedScenarioRepository {
  constructor(private readonly database: Database) {}

  async reconcile(registry: ScenarioRegistry): Promise<void> {
    for (const summary of registry.list()) {
      const fixture = registry.find(summary.id);
      if (fixture) await this.database.transaction((client) => reconcileFixture(client, fixture));
    }
  }

  async list(): Promise<ScenarioSummary[]> {
    const result = await this.database.query<VersionRow & { public_slug: string }>(`SELECT
      s.public_slug, sv.version_number, sv.content_hash, sv.definition, sv.schema_version, sv.created_at
      FROM scenarios s JOIN LATERAL (
        SELECT version_number, content_hash, definition, schema_version, created_at
        FROM scenario_versions WHERE scenario_id = s.id ORDER BY version_number DESC LIMIT 1
      ) sv ON true
      WHERE s.visibility = 'published' AND s.status = 'active'
      ORDER BY s.public_slug`);
    return result.rows.map((row) => ({ id: row.public_slug, version: row.version_number, name: row.definition.name, description: row.definition.description, contentHash: row.content_hash }));
  }

  async latest(slug: string): Promise<ValidatedScenario | undefined> {
    const result = await this.database.query<VersionRow>(`${versionSelect} WHERE s.public_slug = $1 AND s.visibility = 'published' AND s.status = 'active' ORDER BY sv.version_number DESC LIMIT 1`, [slug]);
    return hydrate(result.rows[0]);
  }

  async version(slug: string, version: number): Promise<ValidatedScenario | undefined> {
    const result = await this.database.query<VersionRow>(`${versionSelect} WHERE s.public_slug = $1 AND s.visibility = 'published' AND sv.version_number = $2`, [slug, version]);
    return hydrate(result.rows[0]);
  }

  async history(slug: string, limit: number, cursor?: number): Promise<{ items: ScenarioVersionSummary[]; nextCursor?: number }> {
    const values: unknown[] = [slug, limit + 1];
    const cursorClause = cursor === undefined ? "" : "AND sv.version_number < $3";
    if (cursor !== undefined) values.push(cursor);
    const result = await this.database.query<VersionRow>(`${versionSelect} WHERE s.public_slug = $1 AND s.visibility = 'published' ${cursorClause} ORDER BY sv.version_number DESC LIMIT $2`, values);
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const items = rows.map((row) => ({ version: row.version_number, schemaVersion: row.schema_version, contentHash: row.content_hash, createdAt: new Date(row.created_at).toISOString() }));
    return { items, ...(hasMore && items.length ? { nextCursor: items[items.length - 1]!.version } : {}) };
  }

  async export(slug: string, version: number, format: "json" | "yaml"): Promise<string | undefined> {
    const scenario = await this.version(slug, version);
    if (!scenario) return undefined;
    const { contentHash: _contentHash, ...definition } = scenario;
    return format === "json" ? `${JSON.stringify(definition, null, 2)}\n` : stringifyYaml(definition, { sortMapEntries: true });
  }
}

const versionSelect = `SELECT sv.version_number, sv.schema_version, sv.content_hash, sv.definition, sv.created_at
  FROM scenarios s JOIN scenario_versions sv ON sv.scenario_id = s.id`;

export async function reconcileFixture(client: Queryable, fixture: ValidatedScenario): Promise<void> {
  const scenario = await client.query<{ id: string }>(`INSERT INTO scenarios(public_slug, origin, visibility, status)
    VALUES ($1, 'bundled', 'published', 'active')
    ON CONFLICT (public_slug) DO UPDATE SET public_slug = EXCLUDED.public_slug
    WHERE scenarios.origin = 'bundled'
    RETURNING id`, [fixture.id]);
  if (!scenario.rowCount) throw new Error("Published scenario identity belongs to a different origin");
  const scenarioId = scenario.rows[0]!.id;
  await client.query("SELECT id FROM scenarios WHERE id = $1 FOR UPDATE", [scenarioId]);
  const latest = await client.query<VersionRow>("SELECT version_number, schema_version, content_hash, definition, created_at FROM scenario_versions WHERE scenario_id = $1 ORDER BY version_number DESC LIMIT 1", [scenarioId]);
  const existing = latest.rows[0];
  if (existing && comparable(existing.definition) === comparable(fixture)) return;
  const version = (existing?.version_number ?? 0) + 1;
  const candidate = prepareScenario({ ...stripHash(fixture), version });
  await client.query(`INSERT INTO scenario_versions(scenario_id, version_number, schema_version, content_hash, definition, source_format)
    VALUES ($1, $2, $3, $4, $5::jsonb, 'json') ON CONFLICT (scenario_id, content_hash) DO NOTHING`,
  [scenarioId, version, candidate.schemaVersion, candidate.contentHash, JSON.stringify(stripHash(candidate))]);
}

function comparable(value: ValidatedScenario): string {
  const definition = stripHash(value) as Record<string, unknown>;
  delete definition.version;
  return canonicalJson(definition);
}

function stripHash(value: ValidatedScenario): Omit<ValidatedScenario, "contentHash"> {
  const { contentHash: _contentHash, ...definition } = value;
  return structuredClone(definition);
}

function hydrate(row: VersionRow | undefined): ValidatedScenario | undefined {
  return row ? { ...row.definition, version: row.version_number, contentHash: row.content_hash } : undefined;
}
