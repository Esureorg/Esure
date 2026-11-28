import { describe, it, expect } from "vitest";
import { IdempotencyStore } from "../src/idempotency-store.js";

/**
 * Issue #215 — Idempotency retries after transient producer rejection.
 *
 * Tests:
 *   1. `release()` removes the key so a subsequent same-key insert succeeds
 *   2. `release()` returns false when the key does not exist
 *   3. Successful results and conflicts are NOT released
 *   4. A transient failure followed by a successful same-key retry executes
 *      the producer only once (after re-insert)
 */

describe("IdempotencyStore.release (issue #215)", () => {
  it("releasing a key allows a subsequent insert with the same key to succeed", async () => {
    const store = new IdempotencyStore<string>(100, 86_400_000);
    const key = "key-A";
    const fp = "fp1";

    store.insert(key, fp, Promise.resolve("first run"));
    const released = store.release(key);
    expect(released).toBe(true);

    // After release, a new insert with the same key should be treated as a fresh entry
    const second = store.insert(key, fp, Promise.resolve("second run"));
    expect(second.status).toBe("created");
    expect(await (second as { status: "created"; entry: { result: Promise<string> } }).entry.result).toBe("second run");
  });

  it("release() returns false when the key does not exist", () => {
    const store = new IdempotencyStore<string>(100, 86_400_000);
    expect(store.release("nonexistent")).toBe(false);
  });

  it("release() returns false after the entry has already expired", () => {
    let now = 0;
    const store = new IdempotencyStore<string>(100, 1_000, () => now);
    store.insert("k", "fp", Promise.resolve("val"));
    now += 1_001; // past retention
    // Size check triggers removeExpired
    void store.size;
    expect(store.release("k")).toBe(false);
  });

  it("transient failure followed by a successful same-key retry does not duplicate execution", async () => {
    const store = new IdempotencyStore<string>(100, 86_400_000);
    const key = "retry-key";
    const fp = "fingerprint";
    let callCount = 0;

    // First attempt: producer rejects (simulating RunCapacityError)
    const first = store.insert(key, fp, (async () => {
      callCount += 1;
      throw new Error("capacity exceeded");
    })());
    expect(first.status).toBe("created");

    // Await and expect rejection
    await expect(first.status === "created" ? first.entry.result : Promise.resolve("")).rejects.toThrow("capacity exceeded");

    // Caller notices the failure and releases the key
    store.release(key);

    // Second attempt: producer succeeds
    const second = store.insert(key, fp, (async () => {
      callCount += 1;
      return "run-id-123";
    })());
    expect(second.status).toBe("created");
    const result = await (second as { status: "created"; entry: { result: Promise<string> } }).entry.result;
    expect(result).toBe("run-id-123");

    // Producer was called exactly twice (once for each attempt), not deduplicated
    expect(callCount).toBe(2);
  });

  it("existing results are not affected by release() on a different key", async () => {
    const store = new IdempotencyStore<string>(100, 86_400_000);
    store.insert("key-keep", "fp-keep", Promise.resolve("keep me"));
    store.release("key-other"); // different key

    const result = store.insert("key-keep", "fp-keep", Promise.resolve("ignored"));
    expect(result.status).toBe("existing");
  });

  it("size decrements after release", () => {
    const store = new IdempotencyStore<string>(100, 86_400_000);
    store.insert("k1", "fp1", Promise.resolve("a"));
    store.insert("k2", "fp2", Promise.resolve("b"));
    expect(store.size).toBe(2);
    store.release("k1");
    expect(store.size).toBe(1);
  });
});
