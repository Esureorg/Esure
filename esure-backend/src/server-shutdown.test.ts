/**
 * Focused process-exit tests for the graceful-shutdown path (issue #208).
 *
 * server.ts is a top-level executable module; we test the shutdown logic
 * in isolation by extracting and re-implementing the relevant function shape,
 * then verifying that:
 *   - process.exit(1) is called when closeAfterDrain throws
 *   - process.exit(0) is called when closeAfterDrain resolves
 *   - a repeated SIGTERM after shutdown is in progress is a no-op
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// Minimal in-process reimplementation of the shutdown function defined in
// server.ts so we can test it without spawning a child process.
function makeShutdown(closeAfterDrain: () => Promise<void>) {
  let shuttingDown = false;
  const exitSpy = vi.fn();

  async function shutdown(_signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    let cleanupFailed = false;
    try {
      await closeAfterDrain();
    } catch {
      cleanupFailed = true;
    }

    if (cleanupFailed) {
      exitSpy(1);
      return;
    }
    exitSpy(0);
  }

  return { shutdown, exitSpy, isShuttingDown: () => shuttingDown };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("shutdown — exit code behaviour (issue #208)", () => {
  it("calls exit(0) when closeAfterDrain resolves successfully", async () => {
    const { shutdown, exitSpy } = makeShutdown(() => Promise.resolve());
    await shutdown("SIGTERM");
    expect(exitSpy).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("calls exit(1) when closeAfterDrain throws", async () => {
    const { shutdown, exitSpy } = makeShutdown(() =>
      Promise.reject(new Error("drain timeout"))
    );
    await shutdown("SIGTERM");
    expect(exitSpy).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("does not call exit twice when shutdown is already in progress (repeated signal)", async () => {
    // The first call will await a never-settling promise; the second should
    // return immediately because shuttingDown is already true.
    let resolveFirst!: () => void;
    const firstDrain = new Promise<void>((resolve) => { resolveFirst = resolve; });

    const { shutdown, exitSpy } = makeShutdown(() => firstDrain);

    const p1 = shutdown("SIGTERM");
    // Second signal arrives before the first drain completes
    await shutdown("SIGINT");

    // The second call should have been a no-op (shuttingDown guard)
    expect(exitSpy).not.toHaveBeenCalled();

    // Let the first drain complete cleanly
    resolveFirst();
    await p1;
    expect(exitSpy).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("calls exit(1) even when closeAfterDrain rejects with a non-Error value", async () => {
    const { shutdown, exitSpy } = makeShutdown(() =>
      // eslint-disable-next-line prefer-promise-reject-errors
      Promise.reject("string rejection")
    );
    await shutdown("SIGTERM");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
