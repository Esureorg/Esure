import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses safe Testnet defaults", () => {
    const config = loadConfig({});
    expect(config.horizonUrl).toContain("testnet");
    expect(config.friendbotUrl).toBe("https://friendbot.stellar.org");
    expect(config.metricsEnabled).toBe(false);
    expect(config.shutdownTimeoutMs).toBe(30_000);
  });

  it("enables metrics only for an explicit boolean setting", () => {
    expect(loadConfig({ METRICS_ENABLED: "true" }).metricsEnabled).toBe(true);
    expect(loadConfig({ METRICS_ENABLED: "false" }).metricsEnabled).toBe(false);
    expect(() => loadConfig({ METRICS_ENABLED: "yes" })).toThrow(/METRICS_ENABLED/);
  });

  it("rejects Mainnet configuration", () => {
    expect(() => loadConfig({ STELLAR_HORIZON_URL: "https://horizon.stellar.org" })).toThrow(/Testnet/);
  });

  it("rejects unsafe resource-limit configuration", () => {
    expect(() => loadConfig({ MAX_CONCURRENT_RUNS: "0" })).toThrow(/MAX_CONCURRENT_RUNS/);
    expect(loadConfig({ MAX_CONCURRENT_FRIENDBOT_REQUESTS: "1" }).maxConcurrentFriendbotRequests).toBe(1);
    expect(loadConfig({ MAX_CONCURRENT_FRIENDBOT_REQUESTS: "50" }).maxConcurrentFriendbotRequests).toBe(50);
    expect(() => loadConfig({ MAX_CONCURRENT_FRIENDBOT_REQUESTS: "0" })).toThrow(/MAX_CONCURRENT_FRIENDBOT_REQUESTS/);
    expect(() => loadConfig({ MAX_CONCURRENT_FRIENDBOT_REQUESTS: "51" })).toThrow(/MAX_CONCURRENT_FRIENDBOT_REQUESTS/);
    expect(() => loadConfig({ MAX_CONCURRENT_FRIENDBOT_REQUESTS: "1.5" })).toThrow(/MAX_CONCURRENT_FRIENDBOT_REQUESTS/);
    expect(() => loadConfig({ BODY_LIMIT_BYTES: "99999999" })).toThrow(/BODY_LIMIT_BYTES/);
    expect(() => loadConfig({ SHUTDOWN_TIMEOUT_MS: "999" })).toThrow(/SHUTDOWN_TIMEOUT_MS/);
    expect(() => loadConfig({ SHUTDOWN_TIMEOUT_MS: "120001" })).toThrow(/SHUTDOWN_TIMEOUT_MS/);
    expect(() => loadConfig({ SHUTDOWN_TIMEOUT_MS: "30s" })).toThrow(/SHUTDOWN_TIMEOUT_MS/);
  });

  it("keeps persistence explicitly disabled unless configured", () => {
    expect(loadConfig({}).persistenceMode).toBe("disabled");
    expect(loadConfig({}).runPersistenceEnabled).toBe(false);
    expect(() => loadConfig({ PERSISTENCE_MODE: "published" })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ PERSISTENCE_MODE: "automatic" })).toThrow(/PERSISTENCE_MODE/);
  });

  it("requires published PostgreSQL persistence to enable run history", () => {
    expect(loadConfig({
      PERSISTENCE_MODE: "published",
      DATABASE_URL: "postgres://localhost/esure",
      RUN_PERSISTENCE_ENABLED: "true",
    }).runPersistenceEnabled).toBe(true);
    expect(() => loadConfig({ RUN_PERSISTENCE_ENABLED: "true" })).toThrow(/PERSISTENCE_MODE=published/);
    expect(() => loadConfig({
      PERSISTENCE_MODE: "published",
      DATABASE_URL: "postgres://localhost/esure",
      RUN_PERSISTENCE_ENABLED: "yes",
    })).toThrow(/RUN_PERSISTENCE_ENABLED/);
  });

  it("exposes idempotency capacity and retention as bounded settings with correct defaults", () => {
    const config = loadConfig({});
    expect(config.idempotencyMaxEntries).toBe(1_000);
    expect(config.idempotencyRetentionMs).toBe(86_400_000);
  });

  it("accepts explicit idempotency overrides within their bounds", () => {
    expect(loadConfig({ IDEMPOTENCY_MAX_ENTRIES: "500" }).idempotencyMaxEntries).toBe(500);
    expect(loadConfig({ IDEMPOTENCY_RETENTION_MS: "3600000" }).idempotencyRetentionMs).toBe(3_600_000);
  });

  it("rejects out-of-range idempotency configuration", () => {
    expect(() => loadConfig({ IDEMPOTENCY_MAX_ENTRIES: "0" })).toThrow(/IDEMPOTENCY_MAX_ENTRIES/);
    expect(() => loadConfig({ IDEMPOTENCY_MAX_ENTRIES: "100001" })).toThrow(/IDEMPOTENCY_MAX_ENTRIES/);
    expect(() => loadConfig({ IDEMPOTENCY_RETENTION_MS: "1000" })).toThrow(/IDEMPOTENCY_RETENTION_MS/);
    expect(() => loadConfig({ IDEMPOTENCY_RETENTION_MS: "999999999" })).toThrow(/IDEMPOTENCY_RETENTION_MS/);
  });
});
