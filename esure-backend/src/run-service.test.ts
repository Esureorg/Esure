import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RunService } from "./run-service.js";
import { InMemoryRunStore } from "./run-store.js";
import type { LedgerGateway, ValidatedScenario, StepResult, AssertionResult, LedgerExecutionOptions } from "./domain.js";
import { RunTimeoutError, SafeRunError } from "./errors.js";
import type { RunLifecycleLog } from "./run-service.js";

const dummyScenario: ValidatedScenario = {
  id: "test-scenario",
  version: 1,
  schemaVersion: 1,
  name: "Test",
  description: "Test scenario",
  network: "testnet",
  contentHash: "hash",
  accounts: [],
  assets: [],
  steps: [],
  assertions: [],
};

const dummyStep: StepResult = {
  id: "step-1",
  type: "payment",
  status: "passed",
  message: "Done",
};

const dummyAssertion: AssertionResult = {
  type: "accountExists",
  status: "passed",
  expected: true,
  actual: true,
  message: "Yes",
};

describe("RunService", () => {
  let store: InMemoryRunStore;
  
  beforeEach(() => {
    vi.useFakeTimers();
    store = new InMemoryRunStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles normal success", async () => {
    const events: RunLifecycleLog[] = [];
    const gateway: LedgerGateway = {
      async execute(scenario, options) {
        options?.onStep?.(dummyStep);
        options?.onAssertion?.(dummyAssertion);
        return { steps: [dummyStep], assertions: [dummyAssertion] };
      }
    };
    
    const service = new RunService(
      store,
      gateway,
      { maxConcurrentRuns: 1, runTimeoutMs: 1000, stepTimeoutMs: 500 },
      Date.now,
      { info: (event) => events.push(event) },
    );
    const run = await service.start(dummyScenario, "request-123");
    expect(run.status).toBe("requested");
    expect(events).toEqual([{
      event: "run.started",
      runId: run.id,
      scenarioId: dummyScenario.id,
      scenarioVersion: dummyScenario.version,
      requestId: "request-123",
      status: "requested",
      durationMs: 0,
    }]);
    
    // allow event loop to run async execute
    await vi.runAllTimersAsync();
    
    const finalized = store.get(run.id);
    expect(finalized?.status).toBe("passed");
    expect(finalized?.summary.stepsPassed).toBe(1);
    expect(finalized?.summary.assertionsPassed).toBe(1);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      event: "run.completed",
      runId: run.id,
      scenarioId: dummyScenario.id,
      scenarioVersion: dummyScenario.version,
      requestId: "request-123",
      status: "passed",
      durationMs: expect.any(Number),
    });
  });

  it("tracks active runs, capacity and draining rejections, terminal totals, and duration", async () => {
    let resolveExecution!: (result: { steps: StepResult[]; assertions: AssertionResult[] }) => void;
    let now = 1_000;
    const gateway: LedgerGateway = {
      execute: vi.fn(() => new Promise<{ steps: StepResult[]; assertions: AssertionResult[] }>((resolve) => {
        resolveExecution = resolve;
      })),
    };
    const service = new RunService(
      store,
      gateway,
      { maxConcurrentRuns: 1, runTimeoutMs: 60_000, stepTimeoutMs: 500 },
      () => now,
    );

    await service.start(dummyScenario);
    expect(service.getMetrics().activeRuns).toBe(1);
    await expect(service.start({ ...dummyScenario, id: "secret-scenario-label" })).rejects.toThrow();
    expect(service.getMetrics().rejectedStarts.capacity).toBe(1);

    await vi.advanceTimersByTimeAsync(0);
    now = 1_600;
    resolveExecution({ steps: [dummyStep], assertions: [dummyAssertion] });
    await vi.runAllTimersAsync();

    expect(service.getMetrics()).toEqual({
      activeRuns: 0,
      terminalRuns: { passed: 1, failed: 0 },
      rejectedStarts: { capacity: 1, draining: 0 },
      runDuration: { count: 1, totalMilliseconds: 600 },
    });

    await service.drain();
    await expect(service.start(dummyScenario)).rejects.toThrow("shutting down");
    expect(service.getMetrics().rejectedStarts.draining).toBe(1);
  });

  it("counts execution exceptions as terminal failures and releases capacity", async () => {
    const events: RunLifecycleLog[] = [];
    const gateway: LedgerGateway = {
      execute: vi.fn().mockRejectedValue(new SafeRunError({
        code: "PRIVATE_SEED_VALUE",
        message: "sensitive execution detail",
        category: "internal",
        retryable: false,
      })),
    };
    const service = new RunService(
      store,
      gateway,
      { maxConcurrentRuns: 1, runTimeoutMs: 1_000, stepTimeoutMs: 500 },
      Date.now,
      { info: (event) => events.push(event) },
    );
    const run = await service.start(dummyScenario, "failure-request");
    await vi.runAllTimersAsync();

    expect(store.get(run.id)?.status).toBe("failed");
    expect(service.getMetrics()).toMatchObject({
      activeRuns: 0,
      terminalRuns: { passed: 0, failed: 1 },
      runDuration: { count: 1 },
    });
    expect(JSON.stringify(service.getMetrics())).not.toContain("sensitive");
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      event: "run.failed",
      runId: run.id,
      requestId: "failure-request",
      status: "failed",
      errorCode: "INTERNAL_ERROR",
    });
    expect(JSON.stringify(events)).not.toContain("sensitive");
    expect(JSON.stringify(events)).not.toContain("PRIVATE_SEED_VALUE");
  });

  it("handles timeout, retains progress, and ignores late callbacks and settlement", async () => {
    const events: RunLifecycleLog[] = [];
    let capturedOptions: LedgerExecutionOptions | undefined;
    let resolveExecution!: (val: any) => void;
    let rejectExecution!: (err: any) => void;

    const gateway: LedgerGateway = {
      execute(scenario, options) {
        capturedOptions = options;
        return new Promise((resolve, reject) => {
          resolveExecution = resolve;
          rejectExecution = reject;
        });
      }
    };

    const service = new RunService(
      store,
      gateway,
      { maxConcurrentRuns: 1, runTimeoutMs: 1000, stepTimeoutMs: 500 },
      Date.now,
      { info: (event) => events.push(event) },
    );
    const run = await service.start(dummyScenario, "timeout-request");
    
    // Run immediate tasks to enter execute()
    await vi.advanceTimersByTimeAsync(0);

    // Fire progress BEFORE timeout
    expect(capturedOptions).toBeDefined();
    capturedOptions?.onStep?.({ ...dummyStep, id: "early-step" });
    
    // Advance time to trigger timeout
    await vi.advanceTimersByTimeAsync(1500);

    const timedOut = store.get(run.id);
    expect(timedOut?.status).toBe("failed");
    expect(timedOut?.error?.code).toBe("RUN_TIMEOUT");
    expect(timedOut?.steps).toHaveLength(1);
    expect(timedOut?.summary.stepsPassed).toBe(1); // from early step
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      event: "run.failed",
      runId: run.id,
      requestId: "timeout-request",
      status: "failed",
      errorCode: "RUN_TIMEOUT",
    });
    
    const completedAt = timedOut?.completedAt;

    // Fire late progress callbacks AFTER timeout
    capturedOptions?.onStep?.({ ...dummyStep, id: "late-step" });
    capturedOptions?.onAssertion?.(dummyAssertion);

    const afterLateProgress = store.get(run.id);
    expect(afterLateProgress?.steps).toHaveLength(1); // late step ignored
    expect(afterLateProgress?.assertions).toHaveLength(0); // late assertion ignored
    expect(afterLateProgress?.completedAt).toBe(completedAt); // unmodified

    // Fire late settlement (resolve)
    resolveExecution({ steps: [dummyStep, dummyStep], assertions: [dummyAssertion] });
    await Promise.resolve(); // wait for execution catch block to tick

    const afterLateResolve = store.get(run.id);
    expect(afterLateResolve?.steps).toHaveLength(1); // still unmodified
    expect(events).toHaveLength(2);
    
    // Fire late settlement (reject) on a new run
    const run2 = await service.start(dummyScenario);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1500);
    rejectExecution(new Error("Late error"));
    await Promise.resolve(); // Should not crash or unhandled rejection
    
    const run2Failed = store.get(run2.id);
    expect(run2Failed?.status).toBe("failed");
    expect(run2Failed?.error?.code).toBe("RUN_TIMEOUT");
    expect(service.getMetrics()).toMatchObject({
      activeRuns: 0,
      terminalRuns: { passed: 0, failed: 2 },
      runDuration: { count: 2 },
    });
    expect(events.filter((event) => event.event !== "run.started")).toHaveLength(2);
  });

  it("ignores late callbacks after report eviction", async () => {
    let capturedOptions: LedgerExecutionOptions | undefined;
    const gateway: LedgerGateway = {
      execute(scenario, options) {
        capturedOptions = options;
        return new Promise(() => {}); // never resolves
      }
    };

    const retentionMs = 1000;
    store = new InMemoryRunStore(500, retentionMs);
    const service = new RunService(store, gateway, { maxConcurrentRuns: 1, runTimeoutMs: 1000, stepTimeoutMs: 500 });
    
    const run = await service.start(dummyScenario);
    await Promise.resolve();
    
    // trigger timeout
    await vi.advanceTimersByTimeAsync(1500);
    expect(store.get(run.id)?.status).toBe("failed");

    // advance time to evict run
    await vi.advanceTimersByTimeAsync(retentionMs + 1000);
    expect(store.get(run.id)).toBeUndefined(); // evicted

    // Late callbacks should not throw or recreate run
    expect(() => {
      capturedOptions?.onStep?.(dummyStep);
      capturedOptions?.onAssertion?.(dummyAssertion);
    }).not.toThrow();

    expect(store.get(run.id)).toBeUndefined(); // still evicted
  });
});

describe("RunService — graceful shutdown", () => {
  let store: InMemoryRunStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new InMemoryRunStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects new starts after drain() is called", async () => {
    const gateway: LedgerGateway = { execute: vi.fn().mockResolvedValue({ steps: [], assertions: [] }) };
    const service = new RunService(store, gateway, { maxConcurrentRuns: 2, runTimeoutMs: 1000, stepTimeoutMs: 500 });
    service.drain();
    await expect(service.start(dummyScenario)).rejects.toThrow("shutting down");
  });

  it("drain() resolves once all active executions finish", async () => {
    let resolveExecution!: () => void;
    const gateway: LedgerGateway = {
      execute: vi.fn().mockReturnValue(new Promise<{ steps: StepResult[]; assertions: AssertionResult[] }>((resolve) => {
        resolveExecution = () => resolve({ steps: [dummyStep], assertions: [dummyAssertion] });
      })),
    };
    const service = new RunService(store, gateway, { maxConcurrentRuns: 2, runTimeoutMs: 60_000, stepTimeoutMs: 1_000 });
    const run = await service.start(dummyScenario);
    await vi.advanceTimersByTimeAsync(0); // enter execute()

    let drained = false;
    const drainPromise = service.drain().then(() => { drained = true; });

    // drain not resolved yet
    await Promise.resolve();
    expect(drained).toBe(false);

    // resolve the execution
    resolveExecution();
    await vi.runAllTimersAsync();
    await drainPromise;

    expect(drained).toBe(true);
    expect(store.get(run.id)?.status).toBe("passed");
  });

  it("drain() with no active runs resolves immediately", async () => {
    const gateway: LedgerGateway = { execute: vi.fn().mockResolvedValue({ steps: [], assertions: [] }) };
    const service = new RunService(store, gateway, { maxConcurrentRuns: 2, runTimeoutMs: 1000, stepTimeoutMs: 500 });
    await expect(service.drain()).resolves.toBeUndefined();
  });

  it("drain() resolves even when a run fails", async () => {
    const gateway: LedgerGateway = {
      execute: vi.fn().mockRejectedValue(new Error("network error")),
    };
    const service = new RunService(store, gateway, { maxConcurrentRuns: 2, runTimeoutMs: 1000, stepTimeoutMs: 500 });
    const run = await service.start(dummyScenario);
    await vi.runAllTimersAsync();
    await expect(service.drain()).resolves.toBeUndefined();
    expect(store.get(run.id)?.status).toBe("failed");
  });

  it("repeated drain() calls do not throw", async () => {
    const gateway: LedgerGateway = { execute: vi.fn().mockResolvedValue({ steps: [], assertions: [] }) };
    const service = new RunService(store, gateway, { maxConcurrentRuns: 2, runTimeoutMs: 1000, stepTimeoutMs: 500 });
    await expect(Promise.all([service.drain(), service.drain(), service.drain()])).resolves.toBeDefined();
  });
});
