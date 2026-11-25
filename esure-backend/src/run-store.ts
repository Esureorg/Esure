import { randomUUID } from "node:crypto";
import type { RunReport } from "./domain.js";
import { OptimisticConcurrencyError, RunCapacityError } from "./errors.js";
import type { PoolClient, QueryResultRow } from "pg";
import type { Database } from "./database.js";

export interface RunStore {
  create(run: RunReport): void | Promise<void>;
  get(id: string): RunReport | undefined | Promise<RunReport | undefined>;
  update(id: string, update: Partial<RunReport>): RunReport | Promise<RunReport>;
}

export class InMemoryRunStore implements RunStore {
  readonly #runs = new Map<string, RunReport>();

  constructor(
    private readonly maxEntries = 500,
    private readonly retentionMs = 3_600_000,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    this.removeExpired();
    return this.#runs.size;
  }

  create(run: RunReport): void {
    this.removeExpired();
    while (this.#runs.size >= this.maxEntries) {
      const terminal = [...this.#runs.entries()].find(([, candidate]) => isTerminal(candidate));
      if (!terminal) throw new RunCapacityError("The run store is full with active runs. Try again later.");
      this.#runs.delete(terminal[0]);
    }
    this.#runs.set(run.id, structuredClone(run));
  }

  get(id: string): RunReport | undefined {
    this.removeExpired();
    const run = this.#runs.get(id);
    return run ? structuredClone(run) : undefined;
  }

  update(id: string, update: Partial<RunReport>): RunReport {
    this.removeExpired();
    const current = this.#runs.get(id);
    if (!current) throw new Error(`Run ${id} does not exist`);
    const updated = { ...current, ...structuredClone(update) };
    this.#runs.set(id, updated);
    return structuredClone(updated);
  }

  private removeExpired(): void {
    const cutoff = this.now() - this.retentionMs;
    for (const [id, run] of this.#runs) {
      const terminalAt = run.completedAt ? Date.parse(run.completedAt) : Number.NaN;
      if (isTerminal(run) && Number.isFinite(terminalAt) && terminalAt <= cutoff) this.#runs.delete(id);
    }
  }
}

interface PersistedRunRow extends QueryResultRow {
  run_id: string;
  scenario_id: string;
  scenario_version: number;
  scenario_schema_version: 1;
  scenario_content_hash: string;
  network: "testnet";
  status: RunReport["status"];
  version: number;
  created_at: Date | string;
  completed_at: Date | string | null;
  steps: RunReport["steps"];
  assertions: RunReport["assertions"];
  summary: RunReport["summary"];
  error: RunReport["error"] | null;
}

export class PostgresRunStore implements RunStore {
  readonly #versions = new Map<string, number>();

  constructor(
    private readonly database: Database,
    private readonly retentionMs = 3_600_000,
  ) {}

  async create(run: RunReport): Promise<void> {
    const safeRun = sanitizeRunReport(run);
    await this.database.query(
      `INSERT INTO runs (
        id, run_id, scenario_id, scenario_version, scenario_schema_version,
        scenario_content_hash, scenario_version_id, network, status, created_at,
        completed_at, duration_ms, steps, assertions, summary, error
      ) VALUES ($1, $1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb)`,
      runValues(safeRun),
    );
  }

  async get(id: string): Promise<RunReport | undefined> {
    const result = await this.database.query<PersistedRunRow>(
      `SELECT run_id, scenario_id, scenario_version, scenario_schema_version,
        scenario_content_hash, network, status, version, created_at, completed_at,
        steps, assertions, summary, error
      FROM runs
      WHERE run_id = $1
        AND scenario_id IS NOT NULL
        AND (completed_at IS NULL OR completed_at > clock_timestamp() - ($2 * interval '1 millisecond'))`,
      [id, this.retentionMs],
    );
    const row = result.rows[0];
    if (row) this.#versions.set(id, row.version);
    return row ? reportFromRow(row) : undefined;
  }

  async update(id: string, update: Partial<RunReport>): Promise<RunReport> {
    // Capture the version observed by the caller's preceding `get()` before this
    // update's own `get()` refreshes the cache. The conditional UPDATE below
    // rejects the write if another writer changed the version in between.
    const expectedVersion = this.#versions.get(id) ?? 0;
    const current = await this.get(id);
    if (!current) throw new Error(`Run ${id} does not exist`);
    const updated = sanitizeRunReport({ ...current, ...structuredClone(update) });
    const result = await this.database.query(
      `UPDATE runs SET
        scenario_id = $3,
        scenario_version = $4,
        scenario_schema_version = $5,
        scenario_content_hash = $6,
        network = $7,
        status = $8,
        created_at = $9,
        completed_at = $10,
        duration_ms = $11,
        steps = $12::jsonb,
        assertions = $13::jsonb,
        summary = $14::jsonb,
        error = $15::jsonb,
        version = version + 1
      WHERE run_id = $1
        AND version = $2
        AND (completed_at IS NULL OR completed_at > clock_timestamp() - ($16 * interval '1 millisecond'))`,
      [id, expectedVersion, ...runValues(updated).slice(1), this.retentionMs],
    );
    if (result.rowCount !== 1) throw new OptimisticConcurrencyError(id);
    this.#versions.set(id, expectedVersion + 1);
    return structuredClone(updated);
  }

  /**
   * Physically deletes expired terminal runs in bounded batches (issue #160).
   *
   * Reads already hide reports past `retentionMs`; this operator-invoked method
   * removes the rows for real. Deletion goes through the database's audited
   * cleanup guard (`guard_run_cleanup`, migration 001): every batch runs in its
   * own transaction as the `esure_maintenance` role with transaction-local
   * `esure.cleanup_mode=on` and a fresh `esure.cleanup_id`, and writes a
   * `cleanup_audit` row per deleted run before the DELETE executes. The guard
   * additionally enforces a hard 30-day floor, so a run is deleted only when it
   * is terminal (`passed`/`failed`), beyond the configured retention cutoff,
   * AND older than that database-enforced floor; younger rows stay hidden by
   * reads until they age past it.
   *
   * Each batch commits atomically and the loop stops at the first failing
   * batch, so previously committed batches stay deleted and a partial failure
   * never loses auditability — rerunning the prune is idempotent and simply
   * finds fewer (or no) eligible rows. `dryRun` reports the eligible count
   * without deleting anything.
   */
  async pruneExpired(batchSize = 100, options: { dryRun?: boolean } = {}): Promise<number> {
    const limit = Math.max(1, Math.trunc(batchSize));
    if (options.dryRun) {
      const result = await this.database.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM runs WHERE ${expiredRunPredicate}`,
        [this.retentionMs],
      );
      return Number(result.rows[0]?.count ?? 0);
    }

    let totalDeleted = 0;
    for (;;) {
      const deleted = await this.database.transaction(async (client) => {
        await client.query("SET LOCAL ROLE esure_maintenance");
        await client.query("SET LOCAL esure.cleanup_mode = 'on'");
        const cleanupId = randomUUID();
        await client.query("SELECT set_config('esure.cleanup_id', $1, true)", [cleanupId]);
        const runIds = await selectExpiredRunIds(client, expiredRunPredicate, this.retentionMs, limit);
        if (runIds.length === 0) return 0;
        await client.query(
          `INSERT INTO cleanup_audit(cleanup_id, action, target_table, target_id, reason)
           SELECT $1, 'delete_run', 'runs', run_id, 'expired run retention prune'
           FROM unnest($2::uuid[]) AS targets(run_id)`,
          [cleanupId, runIds],
        );
        const result = await client.query("DELETE FROM runs WHERE run_id = ANY($1::uuid[])", [runIds]);
        return result.rowCount ?? 0;
      });
      totalDeleted += deleted;
      if (deleted < limit) break;
    }
    return totalDeleted;
  }
}

/**
 * Eligibility predicate shared by the dry-run count and the batch selection:
 * terminal status, a known completion time, beyond the configured retention
 * cutoff, and past the `guard_run_cleanup` 30-day floor (migration 001), which
 * would otherwise reject the DELETE mid-transaction.
 */
const expiredRunPredicate = `status IN ('passed', 'failed')
      AND completed_at IS NOT NULL
      AND completed_at <= clock_timestamp() - ($1 * interval '1 millisecond')
      AND completed_at < clock_timestamp() - interval '30 days'`;

async function selectExpiredRunIds(client: PoolClient, predicate: string, retentionMs: number, limit: number): Promise<string[]> {
  const result = await client.query<{ run_id: string }>(
    `SELECT run_id FROM runs WHERE ${predicate} ORDER BY completed_at LIMIT $2`,
    [retentionMs, limit],
  );
  return result.rows.map((row) => row.run_id);
}

function runValues(run: RunReport): unknown[] {
  return [
    run.id,
    run.scenarioId,
    run.scenarioVersion,
    run.scenarioSchemaVersion,
    run.scenarioContentHash,
    run.network,
    run.status,
    run.createdAt,
    run.completedAt ?? null,
    run.completedAt ? Math.max(0, Date.parse(run.completedAt) - Date.parse(run.createdAt)) : null,
    JSON.stringify(run.steps),
    JSON.stringify(run.assertions),
    JSON.stringify(run.summary),
    JSON.stringify(run.error ?? null),
  ];
}

function reportFromRow(row: PersistedRunRow): RunReport {
  return sanitizeRunReport({
    id: row.run_id,
    scenarioId: row.scenario_id,
    scenarioVersion: row.scenario_version,
    scenarioSchemaVersion: row.scenario_schema_version,
    scenarioContentHash: row.scenario_content_hash,
    network: row.network,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    ...(row.completed_at && { completedAt: new Date(row.completed_at).toISOString() }),
    steps: row.steps,
    assertions: row.assertions,
    summary: row.summary,
    ...(row.error && { error: row.error }),
  });
}

function sanitizeRunReport(run: RunReport): RunReport {
  return {
    ...run,
    id: redactAccountMaterial(run.id),
    scenarioId: redactAccountMaterial(run.scenarioId),
    scenarioContentHash: redactAccountMaterial(run.scenarioContentHash),
    steps: run.steps.map((step) => ({
      id: redactAccountMaterial(step.id),
      type: redactAccountMaterial(step.type),
      status: step.status,
      ...(step.transactionHash && { transactionHash: redactAccountMaterial(step.transactionHash) }),
      ...(step.ledger !== undefined && { ledger: step.ledger }),
      ...(step.stellarTransactionCode && { stellarTransactionCode: redactAccountMaterial(step.stellarTransactionCode) }),
      ...(step.stellarOperationCodes && { stellarOperationCodes: step.stellarOperationCodes.map(redactAccountMaterial) }),
      message: redactAccountMaterial(step.message),
    })),
    assertions: run.assertions.map((assertion) => ({
      type: assertion.type,
      status: assertion.status,
      expected: sanitizeAssertionValue(assertion.expected),
      actual: sanitizeAssertionValue(assertion.actual),
      message: redactAccountMaterial(assertion.message),
    })),
    ...(run.error && {
      error: {
        code: redactAccountMaterial(run.error.code),
        message: redactAccountMaterial(run.error.message),
        category: run.error.category,
        retryable: run.error.retryable,
        ...(run.error.failedStepId && { failedStepId: redactAccountMaterial(run.error.failedStepId) }),
        ...(run.error.stellarTransactionCode && { stellarTransactionCode: redactAccountMaterial(run.error.stellarTransactionCode) }),
        ...(run.error.stellarOperationCodes && { stellarOperationCodes: run.error.stellarOperationCodes.map(redactAccountMaterial) }),
      },
    }),
  };
}

function sanitizeAssertionValue(value: RunReport["assertions"][number]["expected"]): typeof value {
  if (typeof value === "string") return redactAccountMaterial(value);
  if (Array.isArray(value)) return value.map(sanitizeUnknownAssertionValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !isSensitiveReportKey(key))
      .map(([key, item]) => [redactAccountMaterial(key), sanitizeUnknownAssertionValue(item)]));
  }
  return value;
}

function sanitizeUnknownAssertionValue(value: unknown): unknown {
  if (typeof value === "string") return redactAccountMaterial(value);
  if (Array.isArray(value)) return value.map(sanitizeUnknownAssertionValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !isSensitiveReportKey(key))
      .map(([key, item]) => [redactAccountMaterial(key), sanitizeUnknownAssertionValue(item)]));
  }
  return value;
}

function isSensitiveReportKey(key: string): boolean {
  return /^(?:secret|secretseed|seed|secretkey|accountkey|publickey|privatekey|signedxdr|xdr)$/.test(key.replace(/[_-]/g, "").toLowerCase());
}

function redactAccountMaterial(value: string): string {
  return value.replace(/[SG][A-Z2-7]{55}/g, "[REDACTED]");
}

function isTerminal(run: RunReport): boolean {
  return run.status === "passed" || run.status === "failed";
}
