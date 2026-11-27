/**
 * In-memory idempotency store for run creation requests.
 *
 * Contract:
 *  - The same key + identical canonical request body returns the original run
 *    without re-executing.
 *  - The same key with a different canonical body returns a conflict error.
 *  - Concurrent identical requests are deduplicated atomically within one
 *    process (the first caller sets the entry; concurrent callers wait for the
 *    same settled promise).
 *  - Entries expire after `retentionMs` (default 24 h) measured from creation.
 *  - Capacity is bounded; once `maxEntries` is reached, new keys are rejected
 *    with a 503 until enough entries expire.
 *
 * Limitations (documented):
 *  - Retention and deduplication are in-process only. A process restart or
 *    a second instance will not find entries written by another process. For
 *    distributed or durable idempotency use a shared database.
 */

export interface IdempotencyEntry<T> {
  /** Canonical JSON fingerprint of the request that created this entry. */
  readonly requestFingerprint: string;
  /** Settled result shared across all callers with the same key. */
  readonly result: Promise<T>;
  /** Millisecond epoch of when the entry was created. */
  readonly createdAt: number;
}

export type IdempotencyConflict = { conflict: true; existingFingerprint: string };
export type IdempotencyCapacityError = { capacityExceeded: true };

export type IdempotencyInsertResult<T> =
  | { status: "created"; entry: IdempotencyEntry<T> }
  | { status: "existing"; entry: IdempotencyEntry<T> }
  | { status: "conflict"; existingFingerprint: string }
  | { status: "capacity" };

/**
 * Pre-admission failures that should release the idempotency key so the
 * caller can retry with the same key. Errors that occur after the run is
 * admitted (i.e. already running) are NOT transient in this sense — the entry
 * stays so callers that re-submit get the same result. (#215)
 */
export type TransientRejectionPredicate = (err: unknown) => boolean;

export class IdempotencyStore<T> {
  readonly #entries = new Map<string, IdempotencyEntry<T>>();

  constructor(
    private readonly maxEntries: number = 1_000,
    private readonly retentionMs: number = 86_400_000, // 24 h
    private readonly now: () => number = Date.now,
    /**
     * When set, a producer that rejects with an error matching this predicate
     * is treated as a *pre-admission* transient failure: the entry is removed
     * from the store so the caller can retry with the same key without getting
     * a spurious "existing" response. (#215)
     *
     * Errors that do NOT match are treated as settled results — the entry
     * stays, and re-submitters with the same key receive the same rejection,
     * which prevents duplicate execution.
     */
    private readonly isTransient?: TransientRejectionPredicate,
  ) {}

  get size(): number {
    this.#removeExpired();
    return this.#entries.size;
  }

  /**
   * Attempt to insert an idempotency entry.
   *
   * @param key            - The Idempotency-Key header value.
   * @param fingerprint    - Canonical JSON fingerprint of the request body.
   * @param resultPromise  - The promise returned by the actual handler (only
   *                         used when creating a new entry; ignored otherwise).
   */
  insert(key: string, fingerprint: string, producer: Promise<T> | (() => Promise<T>)): IdempotencyInsertResult<T> {
    this.#removeExpired();

    const existing = this.#entries.get(key);
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        return { status: "conflict", existingFingerprint: existing.requestFingerprint };
      }
      return { status: "existing", entry: existing };
    }

    if (this.#entries.size >= this.maxEntries) {
      return { status: "capacity" };
    }

    const rawPromise = typeof producer === "function" ? producer() : producer;

    // If a transient predicate is configured, tap the promise so that a
    // matching rejection deletes the entry. The tap itself never swallows
    // the rejection — the caller still receives the original rawPromise
    // through entry.result and must handle it. (#215)
    const resultPromise = this.isTransient
      ? rawPromise.catch((err: unknown) => {
          if (this.isTransient!(err) && this.#entries.get(key)?.result === resultPromise) {
            this.#entries.delete(key);
          }
          return Promise.reject(err);
        })
      : rawPromise;

    const entry: IdempotencyEntry<T> = {
      requestFingerprint: fingerprint,
      result: resultPromise,
      createdAt: this.now(),
    };
    this.#entries.set(key, entry);
    return { status: "created", entry };
  }

  #removeExpired(): void {
    const cutoff = this.now() - this.retentionMs;
    for (const [key, entry] of this.#entries) {
      if (entry.createdAt <= cutoff) this.#entries.delete(key);
    }
  }
}
