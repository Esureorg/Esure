import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cliPath = resolve(__dirname, "../dist/cli.js");

const validReport = {
  id: "run-123",
  scenarioId: "xlm-payment",
  scenarioVersion: 1,
  scenarioSchemaVersion: 1,
  scenarioContentHash: "sha256:scenario",
  network: "testnet",
  status: "passed",
  createdAt: "2026-10-16T00:00:00.000Z",
  completedAt: "2026-10-16T00:00:10.000Z",
  expiresAt: "2026-10-17T00:00:10.000Z",
  steps: [{
    id: "payment",
    type: "payment",
    status: "passed",
    message: "Payment confirmed.",
    feeCharged: "100",
  }],
  assertions: [{
    type: "balanceEquals",
    status: "passed",
    expected: "12.3400000",
    actual: "12.3400000",
    message: "Balance matches.",
  }],
  summary: { stepsPassed: 1, stepsFailed: 0, assertionsPassed: 1, assertionsFailed: 0 },
};

describe("CLI offline report validation (#156)", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "esure-report-validation-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function validateFile(name: string, contents: string, output = "human") {
    const filePath = join(tempDir, name);
    await writeFile(filePath, contents, "utf-8");
    return execFileAsync(process.execPath, [cliPath, "report", "validate", filePath, "--output", output], {
      cwd: tempDir,
    });
  }

  it("accepts a valid report offline and preserves decimal-string values", async () => {
    const { stdout } = await validateFile("valid.json", JSON.stringify(validReport), "json");
    expect(JSON.parse(stdout)).toEqual({
      valid: true,
      reportId: "run-123",
      scenarioId: "xlm-payment",
      status: "passed",
    });
    expect(validReport.assertions[0].expected).toBe("12.3400000");
  });

  it("accepts older reports without optional expiry metadata", async () => {
    const { stdout } = await validateFile(
      "without-expiry.json",
      JSON.stringify(Object.fromEntries(Object.entries(validReport).filter(([key]) => key !== "expiresAt"))),
      "json",
    );
    expect(JSON.parse(stdout)).toMatchObject({ valid: true, reportId: "run-123" });
  });

  it.each([
    ["malformed JSON", "{" , "invalid JSON"],
    ["invalid schema", JSON.stringify({ ...validReport, network: "mainnet" }), "/network"],
    ["invalid assertion status", JSON.stringify({
      ...validReport,
      assertions: [{ ...validReport.assertions[0], status: "skipped" }],
    }), "/assertions/0/status"],
    ["invalid expiry timestamp", JSON.stringify({ ...validReport, expiresAt: "not-a-date" }), "/expiresAt"],
  ])("rejects %s with a clear JSON error", async (_label, contents, expectedMessage) => {
    try {
      await validateFile("invalid.json", contents, "json");
      expect.unreachable("invalid report should return exit code 1");
    } catch (error) {
      expect(error).toMatchObject({ code: 1 });
      expect((error as { stderr: string }).stderr).toContain(expectedMessage);
    }
  });

  it("rejects input larger than 5 MiB before parsing", async () => {
    const oversized = `${JSON.stringify(validReport)}${" ".repeat(5 * 1024 * 1024)}`;
    try {
      await validateFile("oversized.json", oversized, "json");
      expect.unreachable("oversized report should return exit code 1");
    } catch (error) {
      expect(error).toMatchObject({ code: 1 });
      expect((error as { stderr: string }).stderr).toContain("exceeds the maximum size");
    }
  });

  it("rejects unsupported file extensions", async () => {
    try {
      await validateFile("report.yaml", JSON.stringify(validReport), "json");
      expect.unreachable("unsupported extension should return exit code 1");
    } catch (error) {
      expect(error).toMatchObject({ code: 1 });
      expect((error as { stderr: string }).stderr).toContain(".json extension");
    }
  });
});
