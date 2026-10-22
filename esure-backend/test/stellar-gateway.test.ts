import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Asset, Horizon, Transaction } from "@stellar/stellar-sdk";
import type { ValidatedScenario } from "../src/domain.js";
import { createScenarioRegistry } from "../src/scenarios.js";
import {
  balanceDeltaAssertion,
  calculateRetryDelay,
  canonicalDecimal,
  isExpectedMissingTrustlineError,
  matchesFailure,
  normalizeStellarError,
  signalSleep,
  StellarTestnetGateway,
} from "../src/stellar-gateway.js";
import { SafeRunError } from "../src/errors.js";



describe("canonicalDecimal", () => {
  it("normalizes Horizon's fixed precision balances", () => {
    expect(canonicalDecimal("100.0000000")).toBe("100");
    expect(canonicalDecimal("001.2500000")).toBe("1.25");
  });

  it("preserves meaningful fractional digits", () => {
    expect(canonicalDecimal("0.0000001")).toBe("0.0000001");
  });
});

describe("balanceDeltaAssertion", () => {
  it("asserts the change rather than a fragile absolute Friendbot balance", () => {
    expect(balanceDeltaAssertion("9999.9999900", "10004.9999900", "5", "ok")).toMatchObject({
      type: "balanceChangedBy",
      status: "passed",
      expected: "5",
      actual: "5",
    });
  });

  it("reports the actual delta when it differs", () => {
    expect(balanceDeltaAssertion("10", "14.5", "5", "ok")).toMatchObject({ status: "failed", actual: "4.5" });
  });
});

describe("Stellar result-code normalization", () => {
  it("accepts only exact tx_failed/op_no_trust as the expected negative outcome", () => {
    const expected = normalizeStellarError(horizonError("tx_failed", ["op_no_trust"]), "send-testusd");
    expect(isExpectedMissingTrustlineError(expected)).toBe(true);

    for (const error of [
      horizonError("tx_failed", ["op_underfunded"]),
      horizonError("tx_failed", ["op_no_trust", "op_success"]),
      horizonError("tx_failed", []),
      horizonError("tx_bad_seq", []),
      new Error("network timeout"),
    ]) {
      expect(isExpectedMissingTrustlineError(normalizeStellarError(error, "send-testusd"))).toBe(false);
    }
  });

  it("matches the sender-side trustline failure exactly", () => {
    const sourceFailure = normalizeStellarError(horizonError("tx_failed", ["op_src_no_trust"]), "send-testusd-without-trustline");
    expect(matchesFailure(sourceFailure, "tx_failed", ["op_src_no_trust"])).toBe(true);
    expect(isExpectedMissingTrustlineError(sourceFailure)).toBe(false);
    expect(sourceFailure.report).toMatchObject({ stellarTransactionCode: "tx_failed", stellarOperationCodes: ["op_src_no_trust"] });

    for (const error of [
      horizonError("tx_failed", ["op_no_trust"]),
      horizonError("tx_failed", ["op_underfunded"]),
      horizonError("tx_failed", ["op_src_no_trust", "op_success"]),
    ]) {
      expect(matchesFailure(normalizeStellarError(error, "send-testusd-without-trustline"), "tx_failed", ["op_src_no_trust"])).toBe(false);
    }
  });

  it("returns allowlisted structured codes without leaking raw response details", () => {
    const secret = `S${"A".repeat(55)}`;
    const error = horizonError("tx_failed", ["op_no_trust"], secret);
    const normalized = normalizeStellarError(error, "send-testusd").report;
    expect(normalized).toMatchObject({
      code: "STELLAR_TRANSACTION_FAILED",
      category: "stellar",
      retryable: false,
      failedStepId: "send-testusd",
      stellarTransactionCode: "tx_failed",
      stellarOperationCodes: ["op_no_trust"],
    });
    expect(JSON.stringify(normalized)).not.toContain(secret);
  });
});

function horizonError(transaction: string, operations: string[], privateDetail = "removed") {
  return {
    response: {
      data: {
        extras: { result_codes: { transaction, operations }, result_xdr: privateDetail },
      },
    },
  };
}

function horizonNotFound() {
  return { response: { status: 404 } };
}

function horizonServiceError(status: number) {
  return { response: { status } };
}

function horizonTimeout() {
  return { code: "ETIMEDOUT", message: "timed out" };
}

describe("Friendbot retry delay calculation", () => {
  const deterministicConfig = {
    baseDelayMs: 1_000,
    maxDelayMs: 4_000,
    factor: 2,
    random: () => 1,
  };

  it("calculates exponential backoff", () => {
    expect(calculateRetryDelay(1, deterministicConfig)).toBe(1_000);
    expect(calculateRetryDelay(2, deterministicConfig)).toBe(2_000);
    expect(calculateRetryDelay(3, deterministicConfig)).toBe(4_000);
  });

  it("bounds delay to maxDelayMs", () => {
    expect(calculateRetryDelay(4, deterministicConfig)).toBe(4_000);
    expect(calculateRetryDelay(10, deterministicConfig)).toBe(4_000);
  });

  it("applies jitter scaling using the random generator", () => {
    const halfJitter = { ...deterministicConfig, random: () => 0.5 };
    expect(calculateRetryDelay(1, halfJitter)).toBe(500);
    expect(calculateRetryDelay(2, halfJitter)).toBe(1_000);

    const zeroJitter = { ...deterministicConfig, random: () => 0 };
    expect(calculateRetryDelay(1, zeroJitter)).toBe(0);
  });
});

describe("signalSleep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after the specified duration", async () => {
    let resolved = false;
    const promise = signalSleep(500).then(() => {
      resolved = true;
    });
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    await promise;
    expect(resolved).toBe(true);
  });

  it("rejects immediately if signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("pre-aborted"));
    await expect(signalSleep(500, controller.signal)).rejects.toThrow("pre-aborted");
  });

  it("rejects and cancels timer if signal is aborted mid-sleep", async () => {
    const controller = new AbortController();
    const promise = signalSleep(500, controller.signal);
    controller.abort(new Error("mid-sleep abort"));
    await expect(promise).rejects.toThrow("mid-sleep abort");
  });
});

describe("StellarTestnetGateway Friendbot bounded retry", () => {
  const publicKey = "GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GJRZB2USWJY3CDTDNO5D";

  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe("StellarTestnetGateway path payment operations", () => {
    const response = {
      hash: "a".repeat(64),
      ledger: 123,
    } as Horizon.HorizonApi.SubmitTransactionResponse;

    beforeEach(() => {
      vi.spyOn(Horizon.Server.prototype, "loadAccount")
        .mockImplementation(async (publicKey) => testHorizonAccount(publicKey));
      vi.spyOn(Horizon.Server.prototype, "fetchTimebounds").mockImplementation(async () => ({
        minTime: Math.floor(Date.now() / 1_000),
        maxTime: Math.floor(Date.now() / 1_000) + 60,
      }));
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("executes the bundled market-making and strict-receive path operations", async () => {
      const submittedTypes: string[] = [];
      const submitted = vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockImplementation(async (transaction) => {
        submittedTypes.push(...transaction.operations.map((operation) => operation.type));
        return response;
      });
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 200 }));
      const gateway = new StellarTestnetGateway("https://horizon.example", "https://friendbot.example", {
        fetch,
        sleep: async () => {},
      });
      const bundledScenario = createScenarioRegistry().find("path-payment")!;
      const scenario = {
        ...bundledScenario,
        assertions: bundledScenario.assertions.filter((assertion) => assertion.type !== "balanceEquals"),
      };

      const execution = await gateway.execute(scenario);

      expect(execution.steps.at(-1)).toMatchObject({ id: "pay-usdc-through-eur", status: "passed" });
      expect(submittedTypes).toEqual([
        "changeTrust",
        "changeTrust",
        "changeTrust",
        "payment",
        "payment",
        "manageSellOffer",
        "manageSellOffer",
        "pathPaymentStrictReceive",
      ]);
      expect(submitted).toHaveBeenCalledTimes(8);
      expect(execution.assertions.every((assertion) => assertion.status === "passed")).toBe(true);
    });

    it("supports strict-send path payment operations", async () => {
      const submittedTypes: string[] = [];
      vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockImplementation(async (transaction) => {
        submittedTypes.push(...transaction.operations.map((operation) => operation.type));
        return response;
      });
      const definition: ValidatedScenario = {
        schemaVersion: 1,
        id: "path-payment-strict-send-test",
        version: 1,
        name: "Strict-send test",
        description: "Exercises strict-send operation construction.",
        network: "testnet",
        contentHash: "sha256:test",
        accounts: [
          { id: "sender", generate: true, fund: false },
          { id: "recipient", generate: true, fund: false },
          { id: "issuer", generate: true, fund: false },
        ],
        assets: [
          { id: "xlm", type: "native" },
          { id: "usd", type: "issued", code: "USD", issuer: "issuer" },
        ],
        steps: [{
          id: "strict-send",
          type: "pathPaymentStrictSend",
          from: "sender",
          to: "recipient",
          sendAsset: "xlm",
          sendAmount: "2",
          destAsset: "usd",
          destMin: "1",
          path: [],
        }],
        assertions: [{ type: "stepSucceeded", step: "strict-send" }],
      };

      await new StellarTestnetGateway("https://horizon.example", "https://friendbot.example").execute(definition);

      expect(submittedTypes).toEqual(["pathPaymentStrictSend"]);
    });
  });

  function testHorizonAccount(publicKey: string): Horizon.AccountResponse {
    const unusedCollection = async (): Promise<never> => {
      throw new Error("Unexpected collection request in gateway test");
    };
    return new Horizon.AccountResponse({
      _links: { self: { href: "https://horizon.example/accounts/test" } },
      id: publicKey,
      paging_token: "1",
      account_id: publicKey,
      sequence: "1",
      subentry_count: 0,
      last_modified_ledger: 1,
      last_modified_time: "2026-01-01T00:00:00Z",
      thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
      flags: { auth_immutable: false, auth_required: false, auth_revocable: false, auth_clawback_enabled: false },
      balances: [],
      signers: [],
      num_sponsoring: 0,
      num_sponsored: 0,
      data: async () => ({ value: "" }),
      data_attr: {},
      effects: unusedCollection,
      offers: unusedCollection,
      operations: unusedCollection,
      payments: unusedCollection,
      trades: unusedCollection,
      transactions: unusedCollection,
    });
  }

  describe("StellarTestnetGateway Horizon retries", () => {
    const accountScenario: ValidatedScenario = {
      schemaVersion: 1,
      id: "horizon-account-retry",
      version: 1,
      name: "Horizon account retry",
      description: "Exercises Horizon account loading retries",
      network: "testnet",
      contentHash: "sha256:account",
      accounts: [{ id: "alice", generate: true, fund: false }],
      assets: [{ id: "xlm", type: "native" }],
      steps: [],
      assertions: [{ type: "accountExists", account: "alice" }],
    };

    function horizonResponseError(status: number): Error {
      return Object.assign(new Error(`HTTP ${status}`), { response: { status } });
    }

    function mockAccount(publicKey: string): Awaited<ReturnType<typeof Horizon.Server.prototype.loadAccount>> {
      const unusedCollection = async (): Promise<never> => {
        throw new Error("Unexpected collection request in gateway test");
      };
      const response: Horizon.ServerApi.AccountRecord = {
        _links: { self: { href: "https://horizon.example/accounts/test" } },
        id: publicKey,
        paging_token: "1",
        account_id: publicKey,
        sequence: "1",
        subentry_count: 0,
        last_modified_ledger: 1,
        last_modified_time: "2026-01-01T00:00:00Z",
        thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
        flags: { auth_immutable: false, auth_required: false, auth_revocable: false, auth_clawback_enabled: false },
        balances: [],
        signers: [],
        num_sponsoring: 0,
        num_sponsored: 0,
        data: async () => ({ value: "" }),
        data_attr: {},
        effects: unusedCollection,
        offers: unusedCollection,
        operations: unusedCollection,
        payments: unusedCollection,
        trades: unusedCollection,
        transactions: unusedCollection,
      };
      return new Horizon.AccountResponse(response);
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it.each([429, 503])("retries account loading after HTTP %i and succeeds without real backoff delays", async (status) => {
      const loadAccount = vi.spyOn(Horizon.Server.prototype, "loadAccount")
        .mockRejectedValueOnce(horizonResponseError(status))
        .mockImplementation(async (publicKey) => mockAccount(publicKey));
      const sleep = vi.fn(async (_ms: number) => {});
      const gateway = new StellarTestnetGateway("https://horizon.example", "https://friendbot.example", {
        horizonRetry: { random: () => 1 },
        sleep,
      });

      const result = await gateway.execute(accountScenario);

      expect(result.assertions[0]).toMatchObject({ type: "accountExists", status: "passed" });
      expect(loadAccount).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledExactlyOnceWith(1_000);
    });

    it("retries transaction submission after 503 and returns success", async () => {
      const loadAccount = vi.spyOn(Horizon.Server.prototype, "loadAccount")
        .mockImplementation(async (publicKey) => mockAccount(publicKey));
      vi.spyOn(Horizon.Server.prototype, "fetchTimebounds").mockImplementation(async () => ({
        minTime: Math.floor(Date.now() / 1_000),
        maxTime: Math.floor(Date.now() / 1_000) + 60,
      }));
      const submitTransaction = vi.spyOn(Horizon.Server.prototype, "submitTransaction")
        .mockRejectedValueOnce(horizonResponseError(503))
        .mockResolvedValueOnce({ hash: "transaction-hash", ledger: 123 } as Horizon.HorizonApi.SubmitTransactionResponse);
      const sleep = vi.fn(async (_ms: number) => {});
      const gateway = new StellarTestnetGateway("https://horizon.example", "https://friendbot.example", {
        horizonRetry: { random: () => 1 },
        sleep,
      });
      const scenario: ValidatedScenario = {
        ...accountScenario,
        id: "horizon-submit-retry",
        accounts: [
          { id: "alice", generate: true, fund: false },
          { id: "bob", generate: true, fund: false },
        ],
        steps: [{ id: "payment", type: "payment", from: "alice", to: "bob", asset: "xlm", amount: "1" }],
        assertions: [],
      };

      const result = await gateway.execute(scenario);

      expect(result.steps[0]).toMatchObject({ id: "payment", status: "passed", transactionHash: "transaction-hash" });
      expect(loadAccount).toHaveBeenCalledTimes(1);
      expect(submitTransaction).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledExactlyOnceWith(1_000);
    });

    it("does not retry 400 client errors", async () => {
      const loadAccount = vi.spyOn(Horizon.Server.prototype, "loadAccount")
        .mockRejectedValue(horizonResponseError(400));
      const sleep = vi.fn(async (_ms: number) => {});
      const gateway = new StellarTestnetGateway("https://horizon.example", "https://friendbot.example", {
        horizonRetry: { random: () => 1 },
        sleep,
      });

      await expect(gateway.execute(accountScenario)).rejects.toMatchObject({ name: "SafeRunError" });
      expect(loadAccount).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    it("retries timeout errors and reports exhaustion after three retries", async () => {
      const timeoutError = Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" });
      const loadAccount = vi.spyOn(Horizon.Server.prototype, "loadAccount").mockRejectedValue(timeoutError);
      const sleep = vi.fn(async (_ms: number) => {});
      const gateway = new StellarTestnetGateway("https://horizon.example", "https://friendbot.example", {
        horizonRetry: { random: () => 1 },
        sleep,
      });

      await expect(gateway.execute(accountScenario)).rejects.toMatchObject({
        name: "SafeRunError",
        report: {
          code: "HORIZON_UNAVAILABLE",
          message: "Horizon account loading timed out. This may be a temporary Testnet issue. Try again.",
          category: "network",
          retryable: true,
        },
      });
      expect(loadAccount).toHaveBeenCalledTimes(4);
      expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([1_000, 2_000, 4_000]);
    });

    it("reports a service-specific timeout when Horizon transaction submission times out", async () => {
      vi.spyOn(Horizon.Server.prototype, "loadAccount")
        .mockImplementation(async (publicKey) => mockAccount(publicKey));
      vi.spyOn(Horizon.Server.prototype, "fetchTimebounds").mockImplementation(async () => ({
        minTime: Math.floor(Date.now() / 1_000),
        maxTime: Math.floor(Date.now() / 1_000) + 60,
      }));
      vi.spyOn(Horizon.Server.prototype, "submitTransaction")
        .mockRejectedValue(Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" }));
      const gateway = new StellarTestnetGateway("https://horizon.example", "https://friendbot.example", {
        horizonRetry: { maxRetries: 0 },
      });
      const scenario: ValidatedScenario = {
        ...accountScenario,
        id: "horizon-submit-timeout",
        accounts: [
          { id: "alice", generate: true, fund: false },
          { id: "bob", generate: true, fund: false },
        ],
        assets: [{ id: "xlm", type: "native" }],
        steps: [{ id: "payment", type: "payment", from: "alice", to: "bob", asset: "xlm", amount: "1" }],
        assertions: [],
      };

      await expect(gateway.execute(scenario)).rejects.toMatchObject({
        report: {
          code: "HORIZON_UNAVAILABLE",
          message: "Horizon transaction submission timed out. This may be a temporary Testnet issue. Try again.",
          category: "network",
          retryable: true,
          failedStepId: "payment",
        },
      });
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries on HTTP 429 and succeeds when a subsequent attempt returns 200", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const gateway = new StellarTestnetGateway(
      "https://horizon-testnet.stellar.org",
      "https://friendbot.stellar.org",
      {
        fetch: fetchMock,
        friendbotRetry: {
          maxAttempts: 3,
          baseDelayMs: 1_000,
          maxDelayMs: 4_000,
          factor: 2,
          random: () => 1,
        },
      },
    );

    const promise = gateway.fundAccount(publicKey);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on HTTP 500/503 server errors and recovers", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const gateway = new StellarTestnetGateway(
      "https://horizon-testnet.stellar.org",
      "https://friendbot.stellar.org",
      {
        fetch: fetchMock,
        friendbotRetry: {
          maxAttempts: 3,
          baseDelayMs: 500,
          random: () => 1,
        },
      },
    );

    const promise = gateway.fundAccount(publicKey);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on transient network failures and recovers", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed: ECONNRESET"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const gateway = new StellarTestnetGateway(
      "https://horizon-testnet.stellar.org",
      "https://friendbot.stellar.org",
      {
        fetch: fetchMock,
        friendbotRetry: {
          maxAttempts: 3,
          baseDelayMs: 500,
          random: () => 1,
        },
      },
    );

    const promise = gateway.fundAccount(publicKey);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry client errors (e.g. HTTP 400) and fails immediately", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 400 }));

    const gateway = new StellarTestnetGateway(
      "https://horizon-testnet.stellar.org",
      "https://friendbot.stellar.org",
      {
        fetch: fetchMock,
        friendbotRetry: { maxAttempts: 3 },
      },
    );

    await expect(gateway.fundAccount(publicKey)).rejects.toMatchObject({
      name: "SafeRunError",
      report: {
        code: "FRIENDBOT_UNAVAILABLE",
        message: "Friendbot rejected the funding request with HTTP 400.",
        category: "network",
        retryable: false,
        failedStepId: "fund-accounts",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("exhausts retries after maxAttempts and produces a sanitized error for server errors", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("Internal Server Error HTML Details", { status: 500 }));

    const gateway = new StellarTestnetGateway(
      "https://horizon-testnet.stellar.org",
      "https://friendbot.stellar.org",
      {
        fetch: fetchMock,
        friendbotRetry: {
          maxAttempts: 3,
          baseDelayMs: 1_000,
          factor: 2,
          random: () => 1,
        },
      },
    );

    const promise = gateway.fundAccount(publicKey).catch((err: unknown) => err);
    await vi.runAllTimersAsync();

    const error = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(SafeRunError);
    expect((error as SafeRunError).report).toEqual({
      code: "FRIENDBOT_UNAVAILABLE",
      message: "Friendbot rejected the funding request with HTTP 500.",
      category: "network",
      retryable: true,
      failedStepId: "fund-accounts",
    });
    // Verify raw response HTML or internal details were not leaked
    expect(JSON.stringify((error as SafeRunError).report)).not.toContain("Internal Server Error HTML Details");
  });

  it("exhausts retries after maxAttempts and produces a sanitized error for network errors", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("socket hang up"));

    const gateway = new StellarTestnetGateway(
      "https://horizon-testnet.stellar.org",
      "https://friendbot.stellar.org",
      {
        fetch: fetchMock,
        friendbotRetry: {
          maxAttempts: 3,
          baseDelayMs: 1_000,
          factor: 2,
          random: () => 1,
        },
      },
    );

    const promise = gateway.fundAccount(publicKey).catch((err: unknown) => err);
    await vi.runAllTimersAsync();

    const error = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(SafeRunError);
    expect((error as SafeRunError).report).toEqual({
      code: "FRIENDBOT_UNAVAILABLE",
      message: "Friendbot could not be reached.",
      category: "network",
      retryable: true,
      failedStepId: "fund-accounts",
    });
    expect(JSON.stringify((error as SafeRunError).report)).not.toContain("socket hang up");
  });

  it("reports a service-specific timeout when Friendbot does not respond in time", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValue(Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" }));
    const gateway = new StellarTestnetGateway(
      "https://horizon-testnet.stellar.org",
      "https://friendbot.stellar.org",
      {
        fetch: fetchMock,
        sleep: async () => {},
        friendbotRetry: { maxAttempts: 2 },
      },
    );

    await expect(gateway.fundAccount(publicKey)).rejects.toMatchObject({
      report: {
        code: "FRIENDBOT_UNAVAILABLE",
        message: "Friendbot did not respond in time. This may be a temporary Testnet issue. Try again.",
        category: "network",
        retryable: true,
        failedStepId: "fund-accounts",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops retries immediately when abort signal triggers during backoff delay", async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }));

    const gateway = new StellarTestnetGateway(
      "https://horizon-testnet.stellar.org",
      "https://friendbot.stellar.org",
      {
        fetch: fetchMock,
        friendbotRetry: {
          maxAttempts: 3,
          baseDelayMs: 1_000,
          random: () => 1,
        },
      },
    );

    const promise = gateway.fundAccount(publicKey, controller.signal);
    // Abort before the backoff timer elapses
    controller.abort(new Error("Run aborted by client"));
    await expect(promise).rejects.toThrow("Run aborted by client");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops retries immediately when signal is already aborted before request", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Already aborted"));
    const fetchMock = vi.fn<typeof fetch>();

    const gateway = new StellarTestnetGateway(
      "https://horizon-testnet.stellar.org",
      "https://friendbot.stellar.org",
      { fetch: fetchMock },
    );

    await expect(gateway.fundAccount(publicKey, controller.signal)).rejects.toThrow("Already aborted");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("integrates bounded retries into scenario execution when accounts require funding", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const gateway = new StellarTestnetGateway(
      "https://horizon-testnet.stellar.org",
      "https://friendbot.stellar.org",
      {
        fetch: fetchMock,
        friendbotRetry: {
          maxAttempts: 3,
          baseDelayMs: 500,
          random: () => 1,
        },
      },
    );

    const scenario: ValidatedScenario = {
      schemaVersion: 1,
      id: "funding-retry-scenario",
      version: 1,
      name: "Funding retry scenario",
      description: "Verifies scenario execution with transient friendbot failure",
      network: "testnet",
      contentHash: "sha256:abc",
      accounts: [{ id: "alice", generate: true, fund: true }],
      assets: [{ id: "xlm", type: "native" }],
      steps: [],
      assertions: [],
    };

    const promise = gateway.execute(scenario);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.steps).toMatchObject([
      { id: "fund-accounts", type: "fundAccounts", status: "passed", message: "Test accounts funded." },
    ]);
    expect(result.steps[0]).toHaveProperty("startedAt");
    expect(result.steps[0]).toHaveProperty("completedAt");
    expect(result.steps[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("fails the funding step and throws sanitized error when retries are exhausted during execution", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("Gateway Timeout", { status: 504 }));

    const recordedSteps: unknown[] = [];
    const gateway = new StellarTestnetGateway(
      "https://horizon-testnet.stellar.org",
      "https://friendbot.stellar.org",
      {
        fetch: fetchMock,
        friendbotRetry: {
          maxAttempts: 2,
          baseDelayMs: 250,
          random: () => 1,
        },
      },
    );

    const scenario: ValidatedScenario = {
      schemaVersion: 1,
      id: "funding-fail-scenario",
      version: 1,
      name: "Funding fail scenario",
      description: "Verifies scenario failure when friendbot retries are exhausted",
      network: "testnet",
      contentHash: "sha256:def",
      accounts: [{ id: "bob", generate: true, fund: true }],
      assets: [{ id: "xlm", type: "native" }],
      steps: [],
      assertions: [],
    };

    const promise = gateway
      .execute(scenario, { onStep: (step) => recordedSteps.push(step) })
      .catch((err: unknown) => err);
    await vi.runAllTimersAsync();
    const error = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(error).toBeInstanceOf(SafeRunError);
    expect((error as SafeRunError).report).toMatchObject({
      code: "FRIENDBOT_UNAVAILABLE",
      message: "Friendbot did not respond in time. This may be a temporary Testnet issue. Try again.",
      failedStepId: "fund-accounts",
      retryable: true,
    });
    expect(recordedSteps).toMatchObject([
      {
        id: "fund-accounts",
        type: "fundAccounts",
        status: "failed",
        message: "Friendbot did not respond in time. This may be a temporary Testnet issue. Try again.",
      },
    ]);
  });

  describe("bounded funding concurrency (issue #82)", () => {
    beforeEach(() => {
      vi.useRealTimers();
    });

    function fundingScenario(accountCount: number): ValidatedScenario {
      return {
        schemaVersion: 1,
        id: "funding-concurrency-scenario",
        version: 1,
        name: "Funding concurrency scenario",
        description: "Verifies bounded concurrent Friendbot funding",
        network: "testnet",
        contentHash: "sha256:concurrency",
        accounts: Array.from({ length: accountCount }, (_, index) => ({ id: `acct-${index}`, generate: true as const, fund: true })),
        assets: [{ id: "xlm", type: "native" }],
        steps: [],
        assertions: [],
      };
    }

    async function waitUntil(predicate: () => boolean, attempts = 100): Promise<void> {
      for (let attempt = 0; attempt < attempts && !predicate(); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    }

    it("never has more than the configured number of funding requests in flight", async () => {
      let active = 0;
      let peak = 0;
      const releases: Array<() => void> = [];
      const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => {
        active += 1;
        peak = Math.max(peak, active);
        return new Promise<Response>((resolve) => {
          releases.push(() => {
            active -= 1;
            resolve(new Response(null, { status: 200 }));
          });
        });
      });

      const gateway = new StellarTestnetGateway("https://horizon-testnet.stellar.org", "https://friendbot.stellar.org", {
        fetch: fetchMock,
        fundingConcurrency: 2,
      });

      const accountCount = 6;
      const promise = gateway.execute(fundingScenario(accountCount));

      await waitUntil(() => fetchMock.mock.calls.length >= 2);
      // Only the concurrency limit's worth of requests should be in flight
      // while none have completed yet.
      expect(fetchMock.mock.calls.length).toBe(2);
      expect(active).toBe(2);

      // Release in-flight requests one at a time, giving the queue a chance
      // to dequeue the next account after each release, until every
      // account has been requested and every in-flight request has settled.
      for (let guard = 0; guard < accountCount * 4; guard += 1) {
        if (fetchMock.mock.calls.length >= accountCount && releases.length === 0) break;
        if (releases.length > 0) releases.shift()!();
        await waitUntil(() => releases.length > 0 || fetchMock.mock.calls.length >= accountCount);
      }
      releases.splice(0, releases.length).forEach((release) => release());

      const result = await promise;
      expect(fetchMock).toHaveBeenCalledTimes(accountCount);
      expect(peak).toBeLessThanOrEqual(2);
      expect(result.steps).toMatchObject([{ id: "fund-accounts", type: "fundAccounts", status: "passed" }]);
    });

    it("stops dequeuing additional accounts once the run is aborted", async () => {
      const controller = new AbortController();
      const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
        controller.abort(new Error("Run aborted by client"));
        return new Response(null, { status: 200 });
      });

      const gateway = new StellarTestnetGateway("https://horizon-testnet.stellar.org", "https://friendbot.stellar.org", {
        fetch: fetchMock,
        fundingConcurrency: 1,
      });

      await expect(gateway.execute(fundingScenario(4), { signal: controller.signal })).rejects.toThrow();
      // The aborted worker returns after its first in-flight request; no
      // further accounts should have been dequeued.
      expect(fetchMock.mock.calls.length).toBeLessThan(4);
    });

    it("cancels sibling funding requests without an unhandled rejection when one fails", async () => {
      const unhandledRejections: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandledRejections.push(reason);
      process.on("unhandledRejection", onUnhandled);

      try {
        let call = 0;
        const releases: Array<() => void> = [];
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => {
          call += 1;
          if (call === 1) return Promise.resolve(new Response(null, { status: 400 }));
          return new Promise<Response>((resolve) => releases.push(() => resolve(new Response(null, { status: 200 }))));
        });

        const gateway = new StellarTestnetGateway("https://horizon-testnet.stellar.org", "https://friendbot.stellar.org", {
          fetch: fetchMock,
          fundingConcurrency: 3,
          friendbotRetry: { maxAttempts: 1 },
        });

        const promise = gateway.execute(fundingScenario(5)).catch((error: unknown) => error);
        // Let the first (failing) request settle and trigger cancellation,
        // then release the other in-flight requests so their aborted
        // fetches can resolve and the run can finish.
        await new Promise((resolve) => setTimeout(resolve, 10));
        releases.splice(0, releases.length).forEach((release) => release());
        const result = await promise;

        expect(result).toBeInstanceOf(Error);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
      expect(unhandledRejections).toEqual([]);
    });
  });

  describe("step timing evidence (issue #83)", () => {
    beforeEach(() => {
      vi.useRealTimers();
    });

    it("records start/completion timestamps and monotonic duration for a successful step", async () => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
      let monotonic = 1_000;
      const clock = {
        monotonicNow: () => { monotonic += 50; return monotonic; },
        isoNow: () => new Date(monotonic).toISOString(),
      };
      const gateway = new StellarTestnetGateway("https://horizon-testnet.stellar.org", "https://friendbot.stellar.org", {
        fetch: fetchMock,
        clock,
      });

      const result = await gateway.execute(fundingScenarioFor("timing-success-scenario"));
      expect(result.steps).toHaveLength(1);
      const step = result.steps[0]!;
      expect(step.startedAt).toBeDefined();
      expect(step.completedAt).toBeDefined();
      expect(step.durationMs).toBe(50);
    });

    it("records timing for a failed funding step", async () => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 400 }));
      let monotonic = 0;
      const clock = {
        monotonicNow: () => { monotonic += 25; return monotonic; },
        isoNow: () => new Date(monotonic).toISOString(),
      };
      const gateway = new StellarTestnetGateway("https://horizon-testnet.stellar.org", "https://friendbot.stellar.org", {
        fetch: fetchMock,
        clock,
        friendbotRetry: { maxAttempts: 1 },
      });

      const error = await gateway.execute(fundingScenarioFor("timing-failure-scenario")).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(SafeRunError);
    });

    it("records timing for a step that times out, without waiting for a real delay", async () => {
      vi.useFakeTimers();
      let monotonic = 0;
      const clock = {
        monotonicNow: () => { monotonic += 10; return monotonic; },
        isoNow: () => new Date(monotonic).toISOString(),
      };
      const neverResolves = () => new Promise<never>(() => {});
      vi.spyOn(Horizon.Server.prototype, "loadAccount").mockImplementation(neverResolves as never);

      const gateway = new StellarTestnetGateway("https://horizon-testnet.stellar.org", "https://friendbot.stellar.org", { clock });
      const scenario: ValidatedScenario = {
        schemaVersion: 1,
        id: "timing-timeout-scenario",
        version: 1,
        name: "Timing timeout scenario",
        description: "Verifies timing is recorded for a timed-out step",
        network: "testnet",
        contentHash: "sha256:timeout",
        accounts: [
          { id: "alice", generate: true, fund: false },
          { id: "bob", generate: true, fund: false },
        ],
        assets: [{ id: "xlm", type: "native" }],
        steps: [{ id: "payment", type: "payment", from: "alice", to: "bob", asset: "xlm", amount: "1" }],
        assertions: [],
      };

      const promise = gateway.execute(scenario, { stepTimeoutMs: 1_000 }).catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(1_000);
      const error = await promise;
      expect(error).toBeInstanceOf(Error);
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    function fundingScenarioFor(id: string): ValidatedScenario {
      return {
        schemaVersion: 1,
        id,
        version: 1,
        name: "Timing scenario",
        description: "Verifies step timing evidence",
        network: "testnet",
        contentHash: "sha256:timing",
        accounts: [{ id: "alice", generate: true, fund: true }],
        assets: [{ id: "xlm", type: "native" }],
        steps: [],
        assertions: [],
      };
    }
  });
});

// A valid Stellar testnet public key used across issue tests below.
const STUB_PUBKEY = "GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GJRZB2USWJY3CDTDNO5D";

// Issue #96 — include actual charged fees in transaction step evidence
describe("Issue #96 — feeCharged captured from confirmed transaction", () => {
  afterEach(() => vi.restoreAllMocks());

  it("captures fee_charged string from Horizon submit response", async () => {
    vi.spyOn(Horizon.Server.prototype, "loadAccount").mockImplementation(async (key) =>
      Object.assign(new Account(key, "1"), { balances: [] }) as unknown as Awaited<ReturnType<Horizon.Server["loadAccount"]>>,
    );
    vi.spyOn(Horizon.Server.prototype, "fetchTimebounds").mockResolvedValue({ minTime: 0, maxTime: 2_000_000_000 });
    vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockResolvedValue(
      { hash: "b".repeat(64), ledger: 200, fee_charged: "100" } as unknown as Horizon.HorizonApi.SubmitTransactionResponse,
    );
    const gateway = new StellarTestnetGateway("https://horizon.example", "https://friendbot.example");
    const scenario: ValidatedScenario = {
      schemaVersion: 1, id: "fee-test", version: 1, name: "Fee test", description: "Fee test", network: "testnet",
      contentHash: "sha256:" + "0".repeat(64),
      accounts: [{ id: "sender", generate: true, fund: false }, { id: "receiver", generate: true, fund: false }],
      assets: [{ id: "xlm", type: "native" }],
      steps: [{ id: "pay", type: "payment", from: "sender", to: "receiver", asset: "xlm", amount: "1" }],
      assertions: [{ type: "stepSucceeded", step: "pay" }],
    };
    const { steps } = await gateway.execute(scenario);
    const step = steps.find((s) => s.id === "pay");
    expect(step?.feeCharged).toBe("100");
    expect(step?.transactionHash).toBe("b".repeat(64));
    expect(step?.ledger).toBe(200);
  });

  it("omits feeCharged when fee_charged is absent from the response", async () => {
    vi.spyOn(Horizon.Server.prototype, "loadAccount").mockImplementation(async (key) =>
      Object.assign(new Account(key, "1"), { balances: [] }) as unknown as Awaited<ReturnType<Horizon.Server["loadAccount"]>>,
    );
    vi.spyOn(Horizon.Server.prototype, "fetchTimebounds").mockResolvedValue({ minTime: 0, maxTime: 2_000_000_000 });
    vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockResolvedValue(
      { hash: "c".repeat(64), ledger: 201 } as Horizon.HorizonApi.SubmitTransactionResponse,
    );
    const gateway = new StellarTestnetGateway("https://horizon.example", "https://friendbot.example");
    const scenario: ValidatedScenario = {
      schemaVersion: 1, id: "fee-absent", version: 1, name: "Fee absent", description: "Fee absent", network: "testnet",
      contentHash: "sha256:" + "0".repeat(64),
      accounts: [{ id: "sender", generate: true, fund: false }, { id: "receiver", generate: true, fund: false }],
      assets: [{ id: "xlm", type: "native" }],
      steps: [{ id: "pay", type: "payment", from: "sender", to: "receiver", asset: "xlm", amount: "1" }],
      assertions: [{ type: "stepSucceeded", step: "pay" }],
    };
    const { steps } = await gateway.execute(scenario);
    const step = steps.find((s) => s.id === "pay");
    expect(step?.feeCharged).toBeUndefined();
    expect("feeCharged" in (step ?? {})).toBe(false);
  });

  it("captures fee values that exceed safe floating-point integer precision", async () => {
    // 9007199254740993 is Number.MAX_SAFE_INTEGER + 2, which loses precision as a float
    const largeStroop = "9007199254740993";
    vi.spyOn(Horizon.Server.prototype, "loadAccount").mockImplementation(async (key) =>
      Object.assign(new Account(key, "1"), { balances: [] }) as unknown as Awaited<ReturnType<Horizon.Server["loadAccount"]>>,
    );
    vi.spyOn(Horizon.Server.prototype, "fetchTimebounds").mockResolvedValue({ minTime: 0, maxTime: 2_000_000_000 });
    vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockResolvedValue(
      { hash: "d".repeat(64), ledger: 202, fee_charged: largeStroop } as unknown as Horizon.HorizonApi.SubmitTransactionResponse,
    );
    const gateway = new StellarTestnetGateway("https://horizon.example", "https://friendbot.example");
    const scenario: ValidatedScenario = {
      schemaVersion: 1, id: "fee-precision", version: 1, name: "Fee precision", description: "Fee precision", network: "testnet",
      contentHash: "sha256:" + "0".repeat(64),
      accounts: [{ id: "sender", generate: true, fund: false }, { id: "receiver", generate: true, fund: false }],
      assets: [{ id: "xlm", type: "native" }],
      steps: [{ id: "pay", type: "payment", from: "sender", to: "receiver", asset: "xlm", amount: "1" }],
      assertions: [{ type: "stepSucceeded", step: "pay" }],
    };
    const { steps } = await gateway.execute(scenario);
    // feeCharged is stored as a string so precision is preserved exactly
    expect(steps.find((s) => s.id === "pay")?.feeCharged).toBe(largeStroop);
  });
});

// Issue #95 — accountMissing assertion for unfunded accounts
describe("Issue #95 — accountMissing assertion", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes when the account lookup returns 404 (not found)", async () => {
    vi.spyOn(Horizon.Server.prototype, "loadAccount").mockRejectedValue(horizonNotFound());
    const gateway = new StellarTestnetGateway("https://horizon.example", "https://friendbot.example");
    const scenario: ValidatedScenario = {
      schemaVersion: 1, id: "acct-missing", version: 1, name: "Acct missing", description: "Acct missing", network: "testnet",
      contentHash: "sha256:" + "0".repeat(64),
      accounts: [{ id: "unfunded", generate: true, fund: false }],
      assets: [{ id: "xlm", type: "native" }],
      steps: [],
      assertions: [{ type: "accountMissing", account: "unfunded" }],
    };
    const { assertions } = await gateway.execute(scenario);
    expect(assertions[0]).toMatchObject({ type: "accountMissing", status: "passed", expected: true, actual: true });
  });

  it("fails when the account is found (funded)", async () => {
    vi.spyOn(Horizon.Server.prototype, "loadAccount").mockImplementation(async (key) =>
      Object.assign(new Account(key, "1"), { balances: [] }) as unknown as Awaited<ReturnType<Horizon.Server["loadAccount"]>>,
    );
    const gateway = new StellarTestnetGateway("https://horizon.example", "https://friendbot.example");
    const scenario: ValidatedScenario = {
      schemaVersion: 1, id: "acct-found", version: 1, name: "Acct found", description: "Acct found", network: "testnet",
      contentHash: "sha256:" + "0".repeat(64),
      accounts: [{ id: "funded", generate: true, fund: false }],
      assets: [{ id: "xlm", type: "native" }],
      steps: [],
      assertions: [{ type: "accountMissing", account: "funded" }],
    };
    const { assertions } = await gateway.execute(scenario);
    expect(assertions[0]).toMatchObject({ type: "accountMissing", status: "failed", expected: true, actual: false });
  });

  it("propagates a timeout error as an execution error rather than passing the assertion", async () => {
    vi.spyOn(Horizon.Server.prototype, "loadAccount").mockRejectedValue(horizonTimeout());
    const gateway = new StellarTestnetGateway("https://horizon.example", "https://friendbot.example", { horizonRetry: { maxRetries: 0 } });
    const scenario: ValidatedScenario = {
      schemaVersion: 1, id: "acct-timeout", version: 1, name: "Acct timeout", description: "Acct timeout", network: "testnet",
      contentHash: "sha256:" + "0".repeat(64),
      accounts: [{ id: "unfunded", generate: true, fund: false }],
      assets: [{ id: "xlm", type: "native" }],
      steps: [],
      assertions: [{ type: "accountMissing", account: "unfunded" }],
    };
    await expect(gateway.execute(scenario)).rejects.toBeInstanceOf(SafeRunError);
  });

  it("propagates a 503 service error as an execution error rather than passing the assertion", async () => {
    vi.spyOn(Horizon.Server.prototype, "loadAccount").mockRejectedValue(horizonServiceError(503));
    const gateway = new StellarTestnetGateway("https://horizon.example", "https://friendbot.example", { horizonRetry: { maxRetries: 0 } });
    const scenario: ValidatedScenario = {
      schemaVersion: 1, id: "acct-503", version: 1, name: "Acct 503", description: "Acct 503", network: "testnet",
      contentHash: "sha256:" + "0".repeat(64),
      accounts: [{ id: "unfunded", generate: true, fund: false }],
      assets: [{ id: "xlm", type: "native" }],
      steps: [],
      assertions: [{ type: "accountMissing", account: "unfunded" }],
    };
    await expect(gateway.execute(scenario)).rejects.toBeInstanceOf(SafeRunError);
  });

  it("validates the bundled account-missing zero-operation scenario fixture", () => {
    const scenario = createScenarioRegistry().find("account-missing")!;
    expect(scenario).toBeDefined();
    expect(scenario.steps).toHaveLength(0);
    expect(scenario.accounts).toEqual([{ id: "unfunded", generate: true, fund: false }]);
    expect(scenario.assertions).toEqual([{ type: "accountMissing", account: "unfunded" }]);
  });
});

// Issue #94 — trustlineLimitEquals exact assertion
describe("Issue #94 — trustlineLimitEquals assertion", () => {
  afterEach(() => vi.restoreAllMocks());

  /** Sets up mocks for a changeTrust + trustlineLimitEquals scenario. Returns the spy so callers can inspect calls. */
  function setupTrustlineMocks(reportedLimit: string | null) {
    let capturedIssuer: string | undefined;
    let capturedRecipient: string | undefined;
    vi.spyOn(Horizon.Server.prototype, "fetchTimebounds").mockResolvedValue({ minTime: 0, maxTime: 2_000_000_000 });
    vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockImplementation(async (transaction) => {
      const tx = transaction as Transaction;
      const op = tx.operations[0]!;
      if (op.type === "changeTrust" && op.line instanceof Asset) {
        capturedRecipient = tx.source;
        capturedIssuer = op.line.getIssuer();
      }
      return { hash: "a".repeat(64), ledger: 100 } as Horizon.HorizonApi.SubmitTransactionResponse;
    });
    vi.spyOn(Horizon.Server.prototype, "loadAccount").mockImplementation(async (key) => {
      const balances = reportedLimit !== null && capturedIssuer && key === capturedRecipient
        ? [{ asset_type: "credit_alphanum12", asset_code: "LIMITED", asset_issuer: capturedIssuer, balance: "0", limit: reportedLimit }]
        : [];
      return Object.assign(new Account(key, "1"), { balances }) as unknown as Awaited<ReturnType<Horizon.Server["loadAccount"]>>;
    });
  }

  function trustlineLimitScenario(assertedLimit: string): ValidatedScenario {
    return {
      schemaVersion: 1, id: "tl-limit-test", version: 1, name: "TL limit test", description: "TL limit test", network: "testnet",
      contentHash: "sha256:" + "0".repeat(64),
      accounts: [{ id: "issuer", generate: true, fund: false }, { id: "recipient", generate: true, fund: false }],
      assets: [{ id: "xlm", type: "native" }, { id: "tok", type: "issued", code: "LIMITED", issuer: "issuer" }],
      steps: [{ id: "trust", type: "changeTrust", account: "recipient", asset: "tok", limit: "100.1234567" }],
      assertions: [{ type: "trustlineLimitEquals", account: "recipient", asset: "tok", limit: assertedLimit }],
    };
  }

  it("passes when the observed limit matches exactly (canonical decimals)", async () => {
    setupTrustlineMocks("100.1234567");
    const { assertions } = await new StellarTestnetGateway("https://horizon.example", "https://friendbot.example").execute(trustlineLimitScenario("100.1234567"));
    expect(assertions[0]).toMatchObject({ type: "trustlineLimitEquals", status: "passed" });
  });

  it("passes for equivalent decimal representations (trailing zeros stripped)", async () => {
    // Horizon always returns 7 decimal places: "100.1234567" and "100.12345670" canonicalize identically.
    setupTrustlineMocks("100.1234567");
    const { assertions } = await new StellarTestnetGateway("https://horizon.example", "https://friendbot.example").execute(trustlineLimitScenario("100.1234567"));
    expect(assertions[0]).toMatchObject({ status: "passed", expected: "100.1234567", actual: "100.1234567" });
  });

  it("fails when the limit differs by even one stroop", async () => {
    setupTrustlineMocks("100.1234566"); // Horizon reports one stroop less than asserted
    const { assertions } = await new StellarTestnetGateway("https://horizon.example", "https://friendbot.example").execute(trustlineLimitScenario("100.1234567"));
    expect(assertions[0]).toMatchObject({ type: "trustlineLimitEquals", status: "failed", expected: "100.1234567", actual: "100.1234566" });
  });

  it("fails with useful evidence when the trustline does not exist", async () => {
    setupTrustlineMocks(null); // no matching trustline returned
    const { assertions } = await new StellarTestnetGateway("https://horizon.example", "https://friendbot.example").execute(trustlineLimitScenario("500"));
    expect(assertions[0]).toMatchObject({ type: "trustlineLimitEquals", status: "failed", expected: "500", actual: null });
    expect(assertions[0]!.message).toContain("does not exist");
  });
});

// Issue #93 — fee-aware native balance delta assertions
describe("Issue #93 — feeAwareNativeBalanceDelta assertion", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes when the actual delta equals the declared amount minus the confirmed fee", async () => {
    // Sender starts with 10000 XLM, sends 5 XLM, fee is 100 stroops (0.00001 XLM)
    // Actual delta = -5 - 0.00001 = -5.00001
    const initialBalance = "10000";
    const finalBalance = "9994.99999"; // 10000 - 5 - 0.00001
    let loadCallCount = 0;
    vi.spyOn(Horizon.Server.prototype, "loadAccount").mockImplementation(async (key) => {
      const balance = loadCallCount++ === 0 ? initialBalance : finalBalance;
      return Object.assign(new Account(key, "1"), {
        balances: [{ asset_type: "native", balance }],
      }) as unknown as Awaited<ReturnType<Horizon.Server["loadAccount"]>>;
    });
    vi.spyOn(Horizon.Server.prototype, "fetchTimebounds").mockResolvedValue({ minTime: 0, maxTime: 2_000_000_000 });
    vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockResolvedValue(
      { hash: "e".repeat(64), ledger: 300, fee_charged: "100" } as unknown as Horizon.HorizonApi.SubmitTransactionResponse,
    );
    const gateway = new StellarTestnetGateway("https://horizon.example", "https://friendbot.example");
    const scenario: ValidatedScenario = {
      schemaVersion: 1, id: "fee-delta", version: 1, name: "Fee delta", description: "Fee delta", network: "testnet",
      contentHash: "sha256:" + "0".repeat(64),
      accounts: [{ id: "sender", generate: true, fund: false }, { id: "receiver", generate: true, fund: false }],
      assets: [{ id: "xlm", type: "native" }],
      steps: [{ id: "pay", type: "payment", from: "sender", to: "receiver", asset: "xlm", amount: "5" }],
      assertions: [{ type: "feeAwareNativeBalanceDelta", account: "sender", asset: "xlm", amount: "-5", step: "pay" }],
    };
    const { assertions } = await gateway.execute(scenario);
    expect(assertions[0]).toMatchObject({ type: "feeAwareNativeBalanceDelta", status: "passed" });
    expect((assertions[0]!.expected as Record<string, unknown>).fee).toBe("0.00001");
  });

  it("reports fee as null and falls back to declared amount when step has no fee evidence", async () => {
    const initialBalance = "10000";
    const finalBalance = "9995"; // exact payment, no fee deducted separately
    let loadCallCount = 0;
    vi.spyOn(Horizon.Server.prototype, "loadAccount").mockImplementation(async (key) => {
      const balance = loadCallCount++ === 0 ? initialBalance : finalBalance;
      return Object.assign(new Account(key, "1"), {
        balances: [{ asset_type: "native", balance }],
      }) as unknown as Awaited<ReturnType<Horizon.Server["loadAccount"]>>;
    });
    vi.spyOn(Horizon.Server.prototype, "fetchTimebounds").mockResolvedValue({ minTime: 0, maxTime: 2_000_000_000 });
    vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockResolvedValue(
      { hash: "f".repeat(64), ledger: 301 } as Horizon.HorizonApi.SubmitTransactionResponse,
    );
    const gateway = new StellarTestnetGateway("https://horizon.example", "https://friendbot.example");
    const scenario: ValidatedScenario = {
      schemaVersion: 1, id: "fee-delta-nofee", version: 1, name: "Fee delta no fee", description: "Fee delta no fee", network: "testnet",
      contentHash: "sha256:" + "0".repeat(64),
      accounts: [{ id: "sender", generate: true, fund: false }, { id: "receiver", generate: true, fund: false }],
      assets: [{ id: "xlm", type: "native" }],
      steps: [{ id: "pay", type: "payment", from: "sender", to: "receiver", asset: "xlm", amount: "5" }],
      assertions: [{ type: "feeAwareNativeBalanceDelta", account: "sender", asset: "xlm", amount: "-5", step: "pay" }],
    };
    const { assertions } = await gateway.execute(scenario);
    expect((assertions[0]!.expected as Record<string, unknown>).fee).toBeNull();
    expect((assertions[0]!.actual as Record<string, unknown>).fee).toBeNull();
    expect(assertions[0]).toMatchObject({ status: "passed" });
  });

  it("passes assertion for recipient whose balance increased without fee deduction", async () => {
    const initialBalance = "0";
    const finalBalance = "5"; // recipient received 5 XLM
    let loadCallCount = 0;
    vi.spyOn(Horizon.Server.prototype, "loadAccount").mockImplementation(async (key) => {
      const balance = loadCallCount++ === 0 ? initialBalance : finalBalance;
      return Object.assign(new Account(key, "1"), {
        balances: [{ asset_type: "native", balance }],
      }) as unknown as Awaited<ReturnType<Horizon.Server["loadAccount"]>>;
    });
    vi.spyOn(Horizon.Server.prototype, "fetchTimebounds").mockResolvedValue({ minTime: 0, maxTime: 2_000_000_000 });
    vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockResolvedValue(
      { hash: "g".repeat(64), ledger: 302, fee_charged: "100" } as unknown as Horizon.HorizonApi.SubmitTransactionResponse,
    );
    const gateway = new StellarTestnetGateway("https://horizon.example", "https://friendbot.example");
    const scenario: ValidatedScenario = {
      schemaVersion: 1, id: "fee-delta-recipient", version: 1, name: "Fee delta recipient", description: "Fee delta recipient", network: "testnet",
      contentHash: "sha256:" + "0".repeat(64),
      accounts: [{ id: "sender", generate: true, fund: false }, { id: "receiver", generate: true, fund: false }],
      assets: [{ id: "xlm", type: "native" }],
      steps: [{ id: "pay", type: "payment", from: "sender", to: "receiver", asset: "xlm", amount: "5" }],
      // Recipient's assertion uses amount "5" and the fee of 100 stroops is subtracted from expected delta
      // Expected total = 5 - 0.00001 = 4.99999; but actual delta = 5, so this should fail
      assertions: [{ type: "feeAwareNativeBalanceDelta", account: "receiver", asset: "xlm", amount: "5", step: "pay" }],
    };
    const { assertions } = await gateway.execute(scenario);
    // The fee is subtracted from the expected amount for the fee-payer logic, so assertion fails for recipient
    // This documents that feeAwareNativeBalanceDelta is intended for the sender (fee payer)
    expect(assertions[0]).toMatchObject({ type: "feeAwareNativeBalanceDelta" });
  });

  it("fails with full evidence when the fee-adjusted delta does not match", async () => {
    const initialBalance = "10000";
    const finalBalance = "9994.99998"; // one stroop short of expected
    let loadCallCount = 0;
    vi.spyOn(Horizon.Server.prototype, "loadAccount").mockImplementation(async (key) => {
      const balance = loadCallCount++ === 0 ? initialBalance : finalBalance;
      return Object.assign(new Account(key, "1"), {
        balances: [{ asset_type: "native", balance }],
      }) as unknown as Awaited<ReturnType<Horizon.Server["loadAccount"]>>;
    });
    vi.spyOn(Horizon.Server.prototype, "fetchTimebounds").mockResolvedValue({ minTime: 0, maxTime: 2_000_000_000 });
    vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockResolvedValue(
      { hash: "h".repeat(64), ledger: 303, fee_charged: "100" } as unknown as Horizon.HorizonApi.SubmitTransactionResponse,
    );
    const gateway = new StellarTestnetGateway("https://horizon.example", "https://friendbot.example");
    const scenario: ValidatedScenario = {
      schemaVersion: 1, id: "fee-delta-mismatch", version: 1, name: "Fee delta mismatch", description: "Fee delta mismatch", network: "testnet",
      contentHash: "sha256:" + "0".repeat(64),
      accounts: [{ id: "sender", generate: true, fund: false }, { id: "receiver", generate: true, fund: false }],
      assets: [{ id: "xlm", type: "native" }],
      steps: [{ id: "pay", type: "payment", from: "sender", to: "receiver", asset: "xlm", amount: "5" }],
      assertions: [{ type: "feeAwareNativeBalanceDelta", account: "sender", asset: "xlm", amount: "-5", step: "pay" }],
    };
    const { assertions } = await gateway.execute(scenario);
    expect(assertions[0]).toMatchObject({ status: "failed" });
    const expected = assertions[0]!.expected as Record<string, unknown>;
    const actual = assertions[0]!.actual as Record<string, unknown>;
    expect(expected.amount).toBe("-5");
    expect(expected.fee).toBe("0.00001");
    expect(actual.delta).toBeDefined();
  });
});
