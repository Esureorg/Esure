import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, compareReports, getRun, listScenarios, parseReportJson, parseRetryAfter, RateLimitError, startRun, type RunReport, type ScenarioSummary } from "./api";
import {
  completeAdditiveReportFixture,
  minimalLegacyReportFixture,
  reportFixtureVersion,
} from "../../../shared/report-fixtures";

const scenario: ScenarioSummary = {
  id: "xlm-payment",
  version: 1,
  name: "XLM payment",
  description: "Transfer XLM on Testnet.",
  contentHash: "sha256:scenario",
};

const run: RunReport = {
  id: "run-123",
  scenarioId: scenario.id,
  scenarioVersion: 1,
  scenarioSchemaVersion: 1,
  scenarioContentHash: scenario.contentHash,
  network: "testnet",
  status: "failed",
  createdAt: "2026-10-16T00:00:00.000Z",
  completedAt: "2026-10-16T00:00:10.000Z",
  steps: [{
    id: "pay",
    type: "payment",
    status: "failed",
    message: "Payment failed.",
    transactionHash: "f".repeat(64),
    stellarOperationCodes: ["op_no_trust"],
  }],
  assertions: [{
    type: "balanceEquals",
    status: "failed",
    expected: "100.0000000",
    actual: "0.0000000",
    message: "Balance mismatch.",
  }],
  summary: { stepsPassed: 0, stepsFailed: 1, assertionsPassed: 0, assertionsFailed: 1 },
  error: {
    code: "STELLAR_TRANSACTION_FAILED",
    message: "Payment failed.",
    category: "stellar",
    retryable: false,
    failedStepId: "pay",
  },
};

function mockResponse(body: string, status = 200) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  })));
}

async function expectInvalidResponse(promise: Promise<unknown>) {
  const error = await promise.catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(ApiError);
  if (!(error instanceof ApiError)) throw new Error("Expected ApiError");
  expect(error).toMatchObject({
    message: "The server returned an invalid response. Please try again.",
    code: "INVALID_RESPONSE",
    status: 200,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("frontend API response validation", () => {
  it("turns malformed JSON from a successful response into a recoverable API error", async () => {
    mockResponse("<html>upstream failure details</html>");

    await expectInvalidResponse(listScenarios());
    await expectInvalidResponse(getRun("run-123"));
  });

  it("rejects empty objects and missing catalogue items", async () => {
    mockResponse("{}");
    await expectInvalidResponse(listScenarios());
    await expectInvalidResponse(getRun("run-123"));

    mockResponse('{"scenarios":[]}');
    await expectInvalidResponse(listScenarios());
  });

  it("rejects catalogue rows with invalid field types", async () => {
    mockResponse(JSON.stringify({ items: [{ ...scenario, version: "1" }] }));

    await expectInvalidResponse(listScenarios());
  });

  it("rejects unknown run statuses and malformed report arrays", async () => {
    mockResponse(JSON.stringify({ ...run, status: "complete" }));
    await expectInvalidResponse(getRun("run-123"));

    mockResponse(JSON.stringify({ ...run, steps: {} }));
    await expectInvalidResponse(getRun("run-123"));

    mockResponse(JSON.stringify({
      ...run,
      assertions: [{ ...run.assertions[0], status: "skipped" }],
    }));
    await expectInvalidResponse(getRun("run-123"));

    mockResponse(JSON.stringify({ ...run, summary: { ...run.summary, stepsFailed: "1" } }));
    await expectInvalidResponse(getRun("run-123"));
  });

  it("preserves valid decimal strings, optional fields, and run data", async () => {
    mockResponse(JSON.stringify({ items: [scenario] }));
    await expect(listScenarios()).resolves.toEqual([scenario]);

    mockResponse(JSON.stringify(run));
    const result = await getRun("run-123");
    expect(result.assertions[0].expected).toBe("100.0000000");
    expect(result.assertions[0].actual).toBe("0.0000000");
    expect(result.steps[0].transactionHash).toBe("f".repeat(64));
    expect(result.steps[0].stellarOperationCodes).toEqual(["op_no_trust"]);
    expect(result.error?.failedStepId).toBe("pay");

    mockResponse(JSON.stringify(run));
    await expect(startRun("xlm-payment", 1)).resolves.toEqual(run);
  });

  it("sends the explicitly selected version with a new run request", async () => {
    mockResponse(JSON.stringify(run));

    await startRun("xlm-payment", 4, "request-key");

    expect(fetch).toHaveBeenCalledWith("/api/backend/api/v1/runs", expect.objectContaining({
      body: JSON.stringify({ scenarioId: "xlm-payment", scenarioVersion: 4, inputs: {} }),
      headers: expect.objectContaining({ "idempotency-key": "request-key" }),
    }));
  });

  it("fetches paginated history and exact version details", async () => {
    const history = {
      items: [{ version: 2, schemaVersion: 1, contentHash: "hash", createdAt: "2026-10-16T00:00:00.000Z" }],
      nextCursor: 2,
    };
    mockResponse(JSON.stringify(history));
    await expect(getScenarioVersions("xlm-payment", 10, 3)).resolves.toEqual(history);
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/backend/api/v1/scenarios/xlm-payment/versions?limit=10&cursor=3",
      expect.any(Object),
    );

    const detail = {
      id: "xlm-payment",
      version: 2,
      name: "XLM payment",
      description: "Testnet payment.",
      contentHash: "hash",
      network: "testnet",
      schemaVersion: 1,
      accounts: [],
      assets: [],
      steps: [],
      assertions: [],
    };
    mockResponse(JSON.stringify(detail));
    await expect(getScenarioVersion("xlm-payment", 2)).resolves.toEqual(detail);
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/backend/api/v1/scenarios/xlm-payment/versions/2",
      expect.any(Object),
    );
  });

  it("accepts optional expiry metadata without rejecting a report with malformed metadata", async () => {
    const expiresAt = "2026-10-16T00:15:00.000Z";
    mockResponse(JSON.stringify({ ...run, expiresAt }));
    await expect(getRun("run-123")).resolves.toMatchObject({ ...run, expiresAt });

    mockResponse(JSON.stringify({ ...run, expiresAt: { invalid: true } }));
    await expect(getRun("run-123")).resolves.toMatchObject({ ...run, expiresAt: { invalid: true } });
  });

  it("does not expose malformed upstream bodies for unsuccessful responses", async () => {
    mockResponse("<html>private upstream diagnostic</html>", 502);

    const error = await listScenarios().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: "The request failed.",
      code: "UNKNOWN_ERROR",
      status: 502,
    });
    if (!(error instanceof ApiError)) throw new Error("Expected ApiError");
    expect(error.message).not.toContain("private upstream diagnostic");
  });
});

describe("shared report fixtures (Issue #279)", () => {
  it("exposes a versioned fixture set", () => {
    expect(reportFixtureVersion).toBeGreaterThanOrEqual(1);
    expect(minimalLegacyReportFixture.id).toBeTruthy();
    expect(completeAdditiveReportFixture.id).toBeTruthy();
  });

  it("accepts the minimal legacy report via getRun", async () => {
    mockResponse(JSON.stringify(minimalLegacyReportFixture));
    const result = await getRun(minimalLegacyReportFixture.id);
    expect(result.id).toBe(minimalLegacyReportFixture.id);
    expect(result.steps).toHaveLength(minimalLegacyReportFixture.steps.length);
    expect(result.assertions).toHaveLength(minimalLegacyReportFixture.assertions.length);
  });

  it("accepts the complete additive-field report via getRun", async () => {
    mockResponse(JSON.stringify(completeAdditiveReportFixture));
    const result = await getRun(completeAdditiveReportFixture.id);
    expect(result.id).toBe(completeAdditiveReportFixture.id);
    expect(result.steps).toHaveLength(completeAdditiveReportFixture.steps.length);
    expect(result.assertions).toHaveLength(completeAdditiveReportFixture.assertions.length);
  });

  it("preserves optional timing, fee, and subject fields from the additive fixture", async () => {
    mockResponse(JSON.stringify(completeAdditiveReportFixture));
    const result = await getRun(completeAdditiveReportFixture.id);
    const step = result.steps[0] as Record<string, unknown>;
    expect(step.startedAt).toBe(completeAdditiveReportFixture.steps[0].startedAt);
    expect(step.completedAt).toBe(completeAdditiveReportFixture.steps[0].completedAt);
    expect(step.durationMs).toBe(completeAdditiveReportFixture.steps[0].durationMs);
    expect(step.feeCharged).toBe(completeAdditiveReportFixture.steps[0].feeCharged);
    expect(step.subject).toEqual(completeAdditiveReportFixture.steps[0].subject);
  });

  it("parses both fixtures offline with parseReportJson", () => {
    const legacy = parseReportJson(JSON.stringify(minimalLegacyReportFixture));
    expect(legacy.id).toBe(minimalLegacyReportFixture.id);
    expect(legacy.steps).toHaveLength(minimalLegacyReportFixture.steps.length);

    const additive = parseReportJson(JSON.stringify(completeAdditiveReportFixture));
    expect(additive.id).toBe(completeAdditiveReportFixture.id);
    expect(additive.steps).toHaveLength(completeAdditiveReportFixture.steps.length);
    const step = additive.steps[0] as Record<string, unknown>;
    expect(step.startedAt).toBe(completeAdditiveReportFixture.steps[0].startedAt);
    expect(step.completedAt).toBe(completeAdditiveReportFixture.steps[0].completedAt);
    expect(step.durationMs).toBe(completeAdditiveReportFixture.steps[0].durationMs);
    expect(step.feeCharged).toBe(completeAdditiveReportFixture.steps[0].feeCharged);
    expect(step.subject).toEqual(completeAdditiveReportFixture.steps[0].subject);
  });
});

describe("offline report parsing (Issue #47)", () => {
  it("parses valid report JSON successfully", () => {
    const parsed = parseReportJson(JSON.stringify(run));
    expect(parsed.id).toBe("run-123");
    expect(parsed.scenarioId).toBe("xlm-payment");
    expect(parsed.steps).toHaveLength(1);
  });

  it("rejects files exceeding byte limit", () => {
    expect(() => parseReportJson(JSON.stringify(run), 10)).toThrow(/too large/i);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseReportJson("not json content")).toThrow(/valid JSON document/i);
  });

  it("rejects invalid report schema", () => {
    expect(() => parseReportJson(JSON.stringify({ not: "a report" }))).toThrow(/missing required report fields/i);
  });
});

describe("report comparison (Issue #48)", () => {
  const baseRun: RunReport = { ...run };
  const nextRun: RunReport = {
    ...run,
    id: "run-456",
    status: "passed",
    completedAt: "2026-10-16T00:00:15.000Z", // 15s duration vs 10s
    steps: [
      {
        id: "pay",
        type: "payment",
        status: "passed",
        message: "Payment succeeded.",
      },
      {
        id: "check",
        type: "balance",
        status: "passed",
        message: "Balance checked.",
      },
    ],
    assertions: [
      {
        type: "balanceEquals",
        status: "passed",
        expected: "100.0000000",
        actual: "100.0000000",
        message: "Balance matches.",
      },
      {
        type: "balanceEquals",
        status: "passed",
        expected: "200.0000000",
        actual: "200.0000000",
        message: "Second balance matches.",
      },
    ],
    summary: { stepsPassed: 2, stepsFailed: 0, assertionsPassed: 2, assertionsFailed: 0 },
    error: undefined,
  };

  it("computes step and assertion differences with stable keys and duration diff", () => {
    const comp = compareReports(baseRun, nextRun);
    expect(comp.scenariosMatch).toBe(true);
    expect(comp.scenarioIdMatch).toBe(true);
    expect(comp.versionMatch).toBe(true);
    expect(comp.contentHashMatch).toBe(true);
    expect(comp.statusA).toBe("failed");
    expect(comp.statusB).toBe("passed");
    expect(comp.statusChanged).toBe(true);
    expect(comp.durationMsA).toBe(10000);
    expect(comp.durationMsB).toBe(15000);
    expect(comp.durationDiffMs).toBe(5000);

    // pay changed from failed to passed, check was added
    expect(comp.steps).toHaveLength(2);
    const payStep = comp.steps.find((s) => s.id === "pay");
    expect(payStep?.statusChange).toBe("changed");
    expect(payStep?.statusA).toBe("failed");
    expect(payStep?.statusB).toBe("passed");

    const checkStep = comp.steps.find((s) => s.id === "check");
    expect(checkStep?.statusChange).toBe("added");

    // Assertions: balanceEquals#0 changed from failed to passed; balanceEquals#1 was added
    expect(comp.assertions).toHaveLength(2);
    const firstAssert = comp.assertions.find((a) => a.key === "balanceEquals#0");
    expect(firstAssert?.statusChange).toBe("changed");
    const secondAssert = comp.assertions.find((a) => a.key === "balanceEquals#1");
    expect(secondAssert?.statusChange).toBe("added");
  });

  it("detects scenario mismatch when id, version, or hash differs", () => {
    const mismatched = { ...nextRun, scenarioId: "other-flow" };
    const comp = compareReports(baseRun, mismatched);
    expect(comp.scenariosMatch).toBe(false);
    expect(comp.scenarioIdMatch).toBe(false);
  });
});

describe("report comparison property invariants (Issue #283)", () => {
  // Deterministic PRNG so generated reports are reproducible across runs.
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const STEP_TYPES = ["payment", "balance", "trustline", "offer"];
  const ASSERTION_TYPES = ["balanceEquals", "trustlineExists", "offerExists"];
  const MAX_STEPS = 4;
  const MAX_ASSERTIONS = 5;

  function generateReport(rand: () => number, index: number): RunReport {
    const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
    const int = (max: number) => Math.floor(rand() * (max + 1));
    const status = (): "passed" | "failed" => (rand() < 0.5 ? "passed" : "failed");

    const stepCount = int(MAX_STEPS);
    const steps = Array.from({ length: stepCount }, (_, i) => ({
      id: `step-${i}`,
      type: pick(STEP_TYPES),
      status: status(),
      message: `Step ${i}.`,
    }));

    // Repeated assertion types exercise the `${type}#${index}` occurrence keys.
    const assertionCount = int(MAX_ASSERTIONS);
    const assertions = Array.from({ length: assertionCount }, (_, i) => ({
      type: pick(ASSERTION_TYPES),
      status: status(),
      expected: `${i}.0000000`,
      actual: `${i}.0000000`,
      message: `Assertion ${i}.`,
    }));

    const stepsPassed = steps.filter((s) => s.status === "passed").length;
    const assertionsPassed = assertions.filter((a) => a.status === "passed").length;

    return {
      ...run,
      id: `run-prop-${index}`,
      status: stepsFailedCount(steps) === 0 ? "passed" : "failed",
      createdAt: "2026-10-16T00:00:00.000Z",
      completedAt: `2026-10-16T00:00:${String(int(59)).padStart(2, "0")}.000Z`,
      steps,
      assertions,
      summary: {
        stepsPassed,
        stepsFailed: steps.length - stepsPassed,
        assertionsPassed,
        assertionsFailed: assertions.length - assertionsPassed,
      },
      error: undefined,
    };
  }

  function stepsFailedCount(steps: RunReport["steps"]): number {
    return steps.filter((s) => s.status === "failed").length;
  }

  function stepIds(report: RunReport): Set<string> {
    return new Set(report.steps.map((s) => s.id));
  }

  function assertionKeys(report: RunReport): Set<string> {
    const seen = new Map<string, number>();
    const keys = new Set<string>();
    for (const assertion of report.assertions) {
      const occurrence = seen.get(assertion.type) ?? 0;
      seen.set(assertion.type, occurrence + 1);
      keys.add(`${assertion.type}#${occurrence}`);
    }
    return keys;
  }

  function union<T>(a: Set<T>, b: Set<T>): Set<T> {
    return new Set([...a, ...b]);
  }

  const SEED = 0x5eed_0283;
  const PAIRS = 25;

  it("self-comparison yields no changes and unchanged counts", () => {
    const rand = mulberry32(SEED);
    for (let i = 0; i < PAIRS; i++) {
      const report = generateReport(rand, i);
      const comp = compareReports(report, report);

      expect(comp.scenariosMatch).toBe(true);
      expect(comp.statusChanged).toBe(false);
      expect(comp.durationDiffMs).toBe(0);

      for (const entry of [...comp.steps, ...comp.assertions]) {
        expect(entry.statusChange).toBe("unchanged");
      }

      expect(comp.stepsAdded).toBe(0);
      expect(comp.stepsRemoved).toBe(0);
      expect(comp.stepsChanged).toBe(0);
      expect(comp.stepsUnchanged).toBe(stepIds(report).size);
      expect(comp.assertionsAdded).toBe(0);
      expect(comp.assertionsRemoved).toBe(0);
      expect(comp.assertionsChanged).toBe(0);
      expect(comp.assertionsUnchanged).toBe(assertionKeys(report).size);
    }
  });

  it("A/B reversal swaps added/removed and preserves changed/unchanged", () => {
    const rand = mulberry32(SEED);
    for (let i = 0; i < PAIRS; i++) {
      const a = generateReport(rand, i * 2);
      const b = generateReport(rand, i * 2 + 1);
      const ab = compareReports(a, b);
      const ba = compareReports(b, a);

      expect(ba.stepsAdded).toBe(ab.stepsRemoved);
      expect(ba.stepsRemoved).toBe(ab.stepsAdded);
      expect(ba.stepsChanged).toBe(ab.stepsChanged);
      expect(ba.stepsUnchanged).toBe(ab.stepsUnchanged);

      expect(ba.assertionsAdded).toBe(ab.assertionsRemoved);
      expect(ba.assertionsRemoved).toBe(ab.assertionsAdded);
      expect(ba.assertionsChanged).toBe(ab.assertionsChanged);
      expect(ba.assertionsUnchanged).toBe(ab.assertionsUnchanged);
    }
  });

  it("counts are conserved over the union of step ids and assertion keys", () => {
    const rand = mulberry32(SEED);
    for (let i = 0; i < PAIRS; i++) {
      const a = generateReport(rand, i * 2);
      const b = generateReport(rand, i * 2 + 1);
      const comp = compareReports(a, b);

      expect(comp.stepsAdded + comp.stepsRemoved + comp.stepsChanged + comp.stepsUnchanged)
        .toBe(union(stepIds(a), stepIds(b)).size);
      expect(comp.assertionsAdded + comp.assertionsRemoved + comp.assertionsChanged + comp.assertionsUnchanged)
        .toBe(union(assertionKeys(a), assertionKeys(b)).size);

      // Every reported entry is classified exactly once.
      expect(comp.steps).toHaveLength(union(stepIds(a), stepIds(b)).size);
      expect(comp.assertions).toHaveLength(union(assertionKeys(a), assertionKeys(b)).size);
    }
  });
});

describe("parseRetryAfter", () => {

  it("parses a numeric seconds value", () => {
    expect(parseRetryAfter("30")).toBe(30);
    expect(parseRetryAfter("0")).toBe(0);
  });

  it("caps at maxSeconds (default 60)", () => {
    expect(parseRetryAfter("120")).toBe(60);
    expect(parseRetryAfter("120", 90)).toBe(90);
  });

  it("parses an HTTP-date value and returns remaining seconds (capped)", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const result = parseRetryAfter(future);
    expect(result).toBeGreaterThanOrEqual(4);
    expect(result).toBeLessThanOrEqual(6);
  });

  it("returns null for null, empty, or unparseable values", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter("invalid-date")).toBeNull();
  });

  it("clamps expired HTTP-date to 0", () => {
    const past = new Date(Date.now() - 5000).toUTCString();
    const result = parseRetryAfter(past);
    expect(result).toBe(0);
  });
});

describe("RateLimitError from 429 response", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws RateLimitError with parsed retry-after seconds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { code: "RATE_LIMITED", message: "Too many requests" } }),
      { status: 429, headers: { "content-type": "application/json", "retry-after": "15" } }
    )));
    const error = await listScenarios().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    if (!(error instanceof RateLimitError)) throw new Error("Expected RateLimitError");
    expect(error.retryAfterSeconds).toBe(15);
    expect(error.status).toBe(429);
  });

  it("throws RateLimitError with null retryAfterSeconds when header is absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { code: "RATE_LIMITED", message: "Rate limited" } }),
      { status: 429, headers: { "content-type": "application/json" } }
    )));
    const error = await listScenarios().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    if (!(error instanceof RateLimitError)) throw new Error("Expected RateLimitError");
    expect(error.retryAfterSeconds).toBeNull();
  });
});
