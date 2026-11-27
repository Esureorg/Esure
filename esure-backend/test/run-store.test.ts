import { describe, expect, it } from "vitest";
import type { RunReport } from "../src/domain.js";
import { InMemoryRunStore } from "../src/run-store.js";
import { OptimisticConcurrencyError } from "../src/errors.js";

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

// issue #219 — markOrphaned tests are in postgres-run-store.integration.test.ts
// (they require an actual database to verify WHERE clause + RETURNING semantics).
// The tests below cover the InMemoryRunStore version boundary behaviour that
// backs the same interface contract.

// issue #218 — explicit revision tokens
describe("InMemoryRunStore — explicit revision tokens (issue #218)", () => {
  it("update accepts and ignores an explicit expectedVersion (InMemory has no version column)", () => {
    const store = new InMemoryRunStore();
    store.create(run("r1", "running"));
    const updated = store.update("r1", { status: "passed", completedAt: new Date().toISOString() }, 999);
    // InMemory store ignores the version; it always succeeds for existing runs
    expect(updated.status).toBe("passed");
  });

  it("two interleaved updates on the same store instance both apply", () => {
    const store = new InMemoryRunStore();
    store.create(run("r2", "running"));

    // Reader A observes the initial run and plans an update with its version.
    // Reader B also reads and plans an update. InMemory store applies both
    // last-write-wins (no version guard), so this tests no cross-contamination.
    const updatedA = store.update("r2", { status: "passed", completedAt: new Date().toISOString() }, 0);
    expect(updatedA.status).toBe("passed");

    // A second update on the same run (simulating B arriving after A).
    // In the InMemory implementation this is a last-write-wins update.
    const updatedB = store.update("r2", { status: "failed" }, 1);
    expect(updatedB.status).toBe("failed");

    // Final state reflects B's write.
    expect(store.get("r2")?.status).toBe("failed");
  });

  it("throws when updating a run that does not exist", () => {
    const store = new InMemoryRunStore();
    expect(() => store.update("missing", { status: "passed" })).toThrow("does not exist");
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
