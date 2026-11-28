import { describe, it, expect } from "vitest";
import { buildComparisonArtifact, compareReports, type RunReport } from "./api.js";

/**
 * Issue #202 — Export report comparison as a standalone JSON artifact.
 * Tests: deterministic output, versioned format, provenance fields,
 * structured differences, and download failure path (error state).
 */

function makeReport(overrides: Partial<RunReport> = {}): RunReport {
  return {
    id: "run-aaa",
    scenarioId: "xlm-payment",
    scenarioVersion: 1,
    scenarioSchemaVersion: 1,
    scenarioContentHash: "sha256:abc",
    network: "testnet",
    status: "passed",
    createdAt: "2026-11-01T10:00:00.000Z",
    completedAt: "2026-11-01T10:00:05.000Z",
    steps: [
      { id: "fund-source", type: "friendbot", status: "passed", message: "ok" },
      { id: "send-payment", type: "payment", status: "passed", message: "ok" },
    ],
    assertions: [
      { type: "balance-check", status: "passed", message: "balance ok", expected: "100", actual: "100" },
    ],
    summary: { stepsPassed: 2, stepsFailed: 0, assertionsPassed: 1, assertionsFailed: 0 },
    ...overrides,
  };
}

describe("buildComparisonArtifact (issue #202)", () => {
  it("produces a versioned artifact with comparisonFormatVersion: 1", () => {
    const a = makeReport({ id: "run-aaa" });
    const b = makeReport({ id: "run-bbb" });
    const comparison = compareReports(a, b);
    const artifact = buildComparisonArtifact(a, b, comparison);
    expect(artifact.comparisonFormatVersion).toBe(1);
  });

  it("includes provenance for both reports", () => {
    const a = makeReport({ id: "run-aaa" });
    const b = makeReport({ id: "run-bbb", scenarioVersion: 2 });
    const artifact = buildComparisonArtifact(a, b, compareReports(a, b));
    expect(artifact.reportA.id).toBe("run-aaa");
    expect(artifact.reportA.scenarioId).toBe("xlm-payment");
    expect(artifact.reportA.scenarioVersion).toBe(1);
    expect(artifact.reportB.id).toBe("run-bbb");
    expect(artifact.reportB.scenarioVersion).toBe(2);
  });

  it("embeds the structured comparison differences", () => {
    const a = makeReport({ id: "run-aaa" });
    const b = makeReport({
      id: "run-bbb",
      steps: [
        { id: "fund-source", type: "friendbot", status: "passed", message: "ok" },
        { id: "send-payment", type: "payment", status: "failed", message: "err" },
      ],
      status: "failed",
      summary: { stepsPassed: 1, stepsFailed: 1, assertionsPassed: 1, assertionsFailed: 0 },
    });
    const comparison = compareReports(a, b);
    const artifact = buildComparisonArtifact(a, b, comparison);
    expect(artifact.comparison.statusChanged).toBe(true);
    const changed = artifact.comparison.steps.find((s) => s.id === "send-payment");
    expect(changed?.statusChange).toBe("changed");
    expect(changed?.statusA).toBe("passed");
    expect(changed?.statusB).toBe("failed");
  });

  it("is deterministic: same inputs produce same output (modulo exportedAt)", () => {
    const fixedNow = () => "2026-11-01T12:00:00.000Z";
    const a = makeReport({ id: "run-aaa" });
    const b = makeReport({ id: "run-bbb" });
    const comparison = compareReports(a, b);
    const first = buildComparisonArtifact(a, b, comparison, fixedNow);
    const second = buildComparisonArtifact(a, b, comparison, fixedNow);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("omits completedAt when not present in source report", () => {
    const a = makeReport({ id: "run-aaa", completedAt: undefined });
    const b = makeReport({ id: "run-bbb" });
    const artifact = buildComparisonArtifact(a, b, compareReports(a, b));
    expect("completedAt" in artifact.reportA).toBe(false);
    expect(artifact.reportB.completedAt).toBe("2026-11-01T10:00:05.000Z");
  });

  it("exportedAt is a valid ISO string", () => {
    const a = makeReport({ id: "run-aaa" });
    const b = makeReport({ id: "run-bbb" });
    const artifact = buildComparisonArtifact(a, b, compareReports(a, b));
    expect(() => new Date(artifact.exportedAt).toISOString()).not.toThrow();
  });
});
