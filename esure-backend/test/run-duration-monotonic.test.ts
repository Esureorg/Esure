import { describe, it, expect, vi } from "vitest";
import { RunService } from "../src/run-service.js";
import { InMemoryRunStore } from "../src/run-store.js";
import type { LedgerGateway } from "../src/stellar-gateway.js";
import type { ValidatedScenario } from "../src/domain.js";

/**
 * Issue #213 — Run duration must use a monotonic clock to be immune to
 * wall-clock jumps.
 *
 * The `now` parameter keeps its role for wall-clock timestamps
 * (`createdAt`, `completedAt`).  The new `monotonicNow` parameter measures
 * elapsed time only, so an NTP correction mid-run does not produce a
 * negative or artificially short duration.
 */

function makeGateway(): LedgerGateway {
  return {
    submitPayment: vi.fn().mockResolvedValue({ transactionHash: "TX", ledger: 1 }),
    getBalance: vi.fn().mockResolvedValue("100.0000000"),
    getAssetBalance: vi.fn().mockResolvedValue("50.0000000"),
    getAccount: vi.fn().mockResolvedValue({ sequence: "1" }),
    getTransaction: vi.fn().mockResolvedValue(null),
  } as unknown as LedgerGateway;
}

function makeScenario(): ValidatedScenario {
  return {
    id: "xlm-payment",
    version: 1,
    schemaVersion: 1,
    contentHash: "sha256:" + "a".repeat(64),
    network: "testnet",
    steps: [],
  } as unknown as ValidatedScenario;
}

describe("RunService monotonic duration (issue #213)", () => {
  it("duration is measured with monotonicNow, not wall-clock now", async () => {
    let wallClock = Date.now();
    let monotonic = 0;

    const wallNow = () => wallClock;
    const monotonicNow = () => monotonic;

    const store = new InMemoryRunStore();
    const gateway = makeGateway();
    const service = new RunService(
      store,
      gateway,
      { maxConcurrentRuns: 5, runTimeoutMs: 10_000, stepTimeoutMs: 5_000 },
      wallNow,
      undefined, // logger
      monotonicNow,
    );

    const scenario = makeScenario();

    let resolveStep!: () => void;
    (gateway.submitPayment as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<{ transactionHash: string; ledger: number }>((resolve) => {
        resolveStep = () => resolve({ transactionHash: "TX", ledger: 1 });
      })
    );

    const startPromise = service.start(scenario);

    // Simulate a wall-clock jump (e.g. NTP correction) while the run is in flight
    wallClock += 100_000; // +100 seconds wall-clock jump
    monotonic += 1_500;   // +1.5 seconds real elapsed time

    resolveStep();
    await startPromise;

    const metrics = service.getMetrics();
    // Duration should reflect the monotonic elapsed time (~1500ms), not the
    // wall-clock jump (~100_000ms)
    const avgDuration = metrics.runDuration.totalMilliseconds / metrics.runDuration.count;
    expect(avgDuration).toBeGreaterThanOrEqual(1_400);
    expect(avgDuration).toBeLessThan(10_000); // not the wall-clock value of 100_000
  });

  it("preserves wall-clock createdAt and completedAt timestamps", async () => {
    const wallClock = 1_700_000_000_000;
    const monotonicNow = () => 0;

    const store = new InMemoryRunStore();
    const gateway = makeGateway();
    (gateway.submitPayment as ReturnType<typeof vi.fn>).mockResolvedValue({ transactionHash: "TX", ledger: 1 });

    const service = new RunService(
      store,
      gateway,
      { maxConcurrentRuns: 5, runTimeoutMs: 10_000, stepTimeoutMs: 5_000 },
      () => wallClock,
      undefined,
      monotonicNow,
    );

    const run = await service.start(makeScenario());
    expect(Date.parse(run.createdAt)).toBe(wallClock);
    if (run.completedAt) {
      expect(Date.parse(run.completedAt)).toBe(wallClock);
    }
  });
});
