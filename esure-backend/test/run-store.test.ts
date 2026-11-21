import { describe, expect, it } from "vitest";
import type { RunReport } from "../src/domain.js";
import { InMemoryRunStore } from "../src/run-store.js";

describe("InMemoryRunStore resource bounds", () => {
  it("expires terminal runs after the retention window", () => {
    let now = Date.parse("2026-08-09T00:00:00.000Z");
    const store = new InMemoryRunStore(10, 1_000, () => now);
    store.create(run("old", "passed", new Date(now).toISOString()));
    now += 1_001;
    expect(store.get("old")).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it("evicts terminal runs but never active runs when bounded", () => {
    const store = new InMemoryRunStore(2, 60_000);
    store.create(run("active", "running"));
    store.create(run("finished", "passed", new Date().toISOString()));
    store.create(run("new", "requested"));
    expect(store.get("active")).toBeDefined();
    expect(store.get("finished")).toBeUndefined();
    expect(store.get("new")).toBeDefined();
  });
});

describe("InMemoryRunStore get() snapshot isolation (#218)", () => {
  it("two concurrent callers each receive independent snapshots", () => {
    const store = new InMemoryRunStore();
    store.create(run("r1", "running"));
    const snap1 = store.get("r1")!;
    const snap2 = store.get("r1")!;
    // Mutating a snapshot must not affect the store or other snapshots
    (snap1 as RunReport).status = "failed";
    expect(store.get("r1")!.status).toBe("running");
    expect(snap2.status).toBe("running");
  });
});

describe("InMemoryRunStore markOrphaned (#219)", () => {
  it("marks non-terminal runs older than the age threshold as failed", () => {
    let now = Date.parse("2026-08-09T01:00:00.000Z");
    const store = new InMemoryRunStore(500, 3_600_000, () => now);
    store.create(run("old-run", "running"));
    now += 60_001;
    const count = store.markOrphaned({ ageThresholdMs: 60_000 });
    expect(count).toBe(1);
    expect(store.get("old-run")!.status).toBe("failed");
    expect(store.get("old-run")!.error?.code).toBe("SERVER_SHUTDOWN");
  });

  it("does not mark runs in the activeRunIds set", () => {
    let now = Date.parse("2026-08-09T01:00:00.000Z");
    const store = new InMemoryRunStore(500, 3_600_000, () => now);
    store.create(run("active", "running"));
    now += 60_001;
    const count = store.markOrphaned({ ageThresholdMs: 60_000, activeRunIds: new Set(["active"]) });
    expect(count).toBe(0);
    expect(store.get("active")!.status).toBe("running");
  });

  it("is idempotent: second pass marks zero additional runs", () => {
    let now = Date.parse("2026-08-09T01:00:00.000Z");
    const store = new InMemoryRunStore(500, 3_600_000, () => now);
    store.create(run("orphan", "running"));
    now += 60_001;
    expect(store.markOrphaned({ ageThresholdMs: 60_000 })).toBe(1);
    expect(store.markOrphaned({ ageThresholdMs: 60_000 })).toBe(0);
  });

  it("dry-run reports eligible count without mutating", () => {
    let now = Date.parse("2026-08-09T01:00:00.000Z");
    const store = new InMemoryRunStore(500, 3_600_000, () => now);
    store.create(run("r", "running"));
    now += 60_001;
    expect(store.markOrphaned({ ageThresholdMs: 60_000, dryRun: true })).toBe(1);
    expect(store.get("r")!.status).toBe("running");
  });
});

function run(id: string, status: RunReport["status"], completedAt?: string): RunReport {
  return {
    id,
    scenarioId: "xlm-payment",
    scenarioVersion: 1,
    scenarioSchemaVersion: 1,
    scenarioContentHash: `sha256:${"a".repeat(64)}`,
    network: "testnet",
    status,
    createdAt: "2026-08-09T00:00:00.000Z",
    ...(completedAt && { completedAt }),
    steps: [],
    assertions: [],
    summary: { stepsPassed: 0, stepsFailed: 0, assertionsPassed: 0, assertionsFailed: 0 },
  };
}
