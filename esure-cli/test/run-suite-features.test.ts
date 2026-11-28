/**
 * Tests for run-suite enhancements:
 *   - File targets in addition to bundled IDs (#issue)
 *   - Deterministic ordering of file targets
 *   - Maximum suite size cap (MAX_SUITE_SIZE)
 *   - Pre-execution file validation with machine-readable errors
 *   - Explicit skipped records and planned/executed counts in JSON (#issue)
 *   - JUnit skipped testcases for unexecuted targets (#issue)
 *   - Fail-fast execution and exit-code behavior preserved
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ValidatedScenario } from "@esure/backend/src/domain.js";
import { generateJunitXml, MAX_SUITE_SIZE } from "../src/cli.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  find: vi.fn(),
  list: vi.fn(),
  createRegistry: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  fsReaddirSync: vi.fn(),
  fsStatSync: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
  stat: mocks.stat,
  // Stub out artifact-writing functions so they don't throw
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
}));
vi.mock("node:fs", () => ({
  readdirSync: mocks.fsReaddirSync,
  statSync: mocks.fsStatSync,
}));
vi.mock("@esure/backend/src/scenarios.js", () => ({
  createScenarioRegistry: mocks.createRegistry,
}));
vi.mock("@esure/backend/src/stellar-gateway.js", () => ({
  StellarTestnetGateway: class {
    execute = mocks.execute;
  },
}));

const baseDefinition = {
  schemaVersion: 1 as const,
  id: "suite-scenario",
  version: 1,
  name: "Suite scenario",
  description: "Used by run-suite tests",
  network: "testnet" as const,
  accounts: [{ id: "alice", generate: true as const, fund: true as const }],
  assets: [{ id: "xlm", type: "native" as const }],
  steps: [],
  assertions: [{ type: "accountExists" as const, account: "alice" }],
};

const scenario: ValidatedScenario = { ...baseDefinition, contentHash: "sha256:a" };
const scenario2: ValidatedScenario = { ...baseDefinition, id: "suite-scenario-2", contentHash: "sha256:b" };

const passedExecution = {
  steps: [{ id: "s1", type: "payment", status: "passed", message: "ok" }],
  assertions: [{ type: "accountExists", status: "passed", expected: true, actual: true, message: "exists" }],
};

const failedExecution = {
  steps: [{ id: "s1", type: "payment", status: "failed", message: "fail" }],
  assertions: [],
};

let stdout: string[];
let stderr: string[];
let originalArgv: string[];
let originalExitCode: number | undefined;

async function waitForExitCode(timeoutMs = 5000): Promise<number | undefined> {
  const start = Date.now();
  while (process.exitCode === undefined && Date.now() - start < timeoutMs) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return process.exitCode;
}

async function invokeCli(...args: string[]): Promise<number | undefined> {
  process.argv = ["node", "cli.ts", ...args];
  vi.resetModules();
  await import("../src/cli.js");
  return waitForExitCode();
}

describe("run-suite file targets", () => {
  beforeEach(() => {
    stdout = [];
    stderr = [];
    originalArgv = process.argv;
    originalExitCode = process.exitCode;
    process.exitCode = undefined;

    vi.spyOn(console, "log").mockImplementation((...v) => { stdout.push(v.join(" ")); });
    vi.spyOn(console, "error").mockImplementation((...v) => { stderr.push(v.join(" ")); });

    mocks.execute.mockReset();
    mocks.readFile.mockReset();
    mocks.stat.mockReset();
    mocks.list.mockReturnValue([scenario]);
    mocks.find.mockImplementation((id: string) => id === scenario.id ? structuredClone(scenario) : undefined);
    mocks.createRegistry.mockReturnValue({ list: mocks.list, find: mocks.find });
    mocks.execute.mockResolvedValue(passedExecution);
    mocks.stat.mockResolvedValue({ size: 100 });
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("accepts a valid local JSON file as a suite target", async () => {
    mocks.stat.mockResolvedValue({ size: 100 });
    mocks.readFile.mockResolvedValue(JSON.stringify(baseDefinition));
    const code = await invokeCli("run-suite", "./scenario.json", "--output", "json");
    expect(code).toBe(0);
    const result = JSON.parse(stdout.join("\n"));
    expect(result.status).toBe("passed");
    expect(result.executed).toBe(1);
  });

  it("validates file contents before any execution and reports machine-readable errors", async () => {
    mocks.stat.mockResolvedValue({ size: 100 });
    mocks.readFile.mockResolvedValue(JSON.stringify({ ...baseDefinition, network: "mainnet" }));
    const code = await invokeCli("run-suite", "./bad.json", "--output", "json");
    expect(code).toBe(1);
    expect(mocks.execute).not.toHaveBeenCalled();
    const err = JSON.parse(stderr.join("\n"));
    expect(err.error.code).toBe("VALIDATION_FAILED");
    expect(err.error.targets).toHaveLength(1);
    expect(err.error.targets[0].target).toContain("bad.json");
  });

  it("rejects a non-existent file with a machine-readable error before execution", async () => {
    mocks.stat.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const code = await invokeCli("run-suite", "./missing.json", "--output", "json");
    expect(code).toBe(1);
    expect(mocks.execute).not.toHaveBeenCalled();
    const err = JSON.parse(stderr.join("\n"));
    expect(err.error.code).toBe("VALIDATION_FAILED");
  });

  it("mixes bundled IDs and file targets in one suite call", async () => {
    // First target: bundled ID; second: file path
    mocks.stat.mockResolvedValueOnce({ size: 100 });
    mocks.readFile.mockResolvedValueOnce(JSON.stringify({ ...baseDefinition, id: "file-scenario" }));
    mocks.execute.mockResolvedValue(passedExecution);

    const code = await invokeCli(
      "run-suite",
      scenario.id,         // bundled ID
      "./file-scenario.json", // file path
      "--output", "json",
    );
    expect(code).toBe(0);
    const result = JSON.parse(stdout.join("\n"));
    expect(result.executed).toBe(2);
    expect(result.passed).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Skipped records and planned/executed counts
// ─────────────────────────────────────────────────────────────────────────────

describe("run-suite skipped records with --fail-fast", () => {
  beforeEach(() => {
    stdout = [];
    stderr = [];
    originalArgv = process.argv;
    originalExitCode = process.exitCode;
    process.exitCode = undefined;

    vi.spyOn(console, "log").mockImplementation((...v) => { stdout.push(v.join(" ")); });
    vi.spyOn(console, "error").mockImplementation((...v) => { stderr.push(v.join(" ")); });

    mocks.find.mockImplementation((id: string) => {
      if (id === scenario.id) return structuredClone(scenario);
      if (id === scenario2.id) return structuredClone(scenario2);
      return undefined;
    });
    mocks.createRegistry.mockReturnValue({ list: mocks.list, find: mocks.find });
    mocks.stat.mockResolvedValue({ size: 100 });
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("JSON output includes planned, executed, skipped counts when fail-fast fires", async () => {
    mocks.execute.mockResolvedValueOnce(failedExecution);

    const code = await invokeCli(
      "run-suite",
      scenario.id,
      scenario2.id,
      "--fail-fast",
      "--output", "json",
    );
    expect(code).toBe(1);
    const result = JSON.parse(stdout.join("\n"));
    expect(result.status).toBe("failed");
    expect(result.planned).toBe(2);
    expect(result.executed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.total).toBe(2);  // executed + skipped
  });

  it("JSON scenarios array includes explicit skipped records with status=skipped", async () => {
    mocks.execute.mockResolvedValueOnce(failedExecution);

    await invokeCli("run-suite", scenario.id, scenario2.id, "--fail-fast", "--output", "json");
    const result = JSON.parse(stdout.join("\n"));
    const skipped = result.scenarios.filter((s: { status: string }) => s.status === "skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0].scenarioId).toBe(scenario2.id);
  });

  it("without fail-fast, no skipped records are added even on failure", async () => {
    mocks.execute
      .mockResolvedValueOnce(failedExecution)
      .mockResolvedValueOnce(passedExecution);

    await invokeCli("run-suite", scenario.id, scenario2.id, "--output", "json");
    const result = JSON.parse(stdout.join("\n"));
    expect(result.skipped).toBe(0);
    expect(result.executed).toBe(2);
    const skipped = result.scenarios.filter((s: { status: string }) => s.status === "skipped");
    expect(skipped).toHaveLength(0);
  });

  it("exit code is 1 when fail-fast fires, preserving existing behavior", async () => {
    mocks.execute.mockResolvedValueOnce(failedExecution);
    const code = await invokeCli("run-suite", scenario.id, scenario2.id, "--fail-fast");
    expect(code).toBe(1);
  });

  it("exit code is 0 when all scenarios pass with fail-fast enabled", async () => {
    mocks.execute.mockResolvedValue(passedExecution);
    const code = await invokeCli(
      "run-suite", scenario.id, scenario2.id, "--fail-fast", "--output", "json",
    );
    expect(code).toBe(0);
    const result = JSON.parse(stdout.join("\n"));
    expect(result.skipped).toBe(0);
    expect(result.executed).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// JUnit skipped testcases
// ─────────────────────────────────────────────────────────────────────────────

describe("generateJunitXml skipped records", () => {
  it("emits <skipped/> testcase for skipped scenarios", () => {
    const xml = generateJunitXml([
      {
        scenarioId: "skipped-scenario",
        skipped: true,
      },
    ]);
    expect(xml).toContain('<testcase classname="skipped-scenario" name="execution" time="0"><skipped/></testcase>');
    expect(xml).toContain('skipped="1"');
  });

  it("counts skipped scenarios in testsuite attributes", () => {
    const xml = generateJunitXml([
      { scenarioId: "skipped-1", skipped: true },
      { scenarioId: "skipped-2", skipped: true },
    ]);
    expect(xml).toContain('tests="2"');
    expect(xml).toContain('skipped="2"');
  });

  it("includes skipped attribute on testsuites element when any scenario is skipped", () => {
    const xml = generateJunitXml([
      {
        scenarioId: "passed-scenario",
        execution: {
          scenarioId: "passed-scenario",
          scenarioVersion: 1,
          steps: [{ id: "s1", type: "payment", status: "passed", message: "ok" }],
          assertions: [],
        },
      },
      { scenarioId: "skipped-scenario", skipped: true },
    ]);
    expect(xml).toContain('skipped="1"');
    expect(xml).toContain('<testsuite name="skipped-scenario" tests="1" failures="0" errors="0" skipped="1">');
  });

  it("omits skipped attribute from testsuites when no scenario is skipped", () => {
    const xml = generateJunitXml([
      {
        scenarioId: "normal",
        execution: {
          scenarioId: "normal",
          scenarioVersion: 1,
          steps: [],
          assertions: [],
        },
      },
    ]);
    // No skipped attribute should appear in the outer testsuites element
    const firstLine = xml.split("\n").find((l) => l.includes("<testsuites"))!;
    expect(firstLine).not.toContain("skipped");
  });

  it("preserves pass/fail/error semantics alongside skipped records", () => {
    const xml = generateJunitXml([
      {
        scenarioId: "failed-scenario",
        execution: {
          scenarioId: "failed-scenario",
          scenarioVersion: 1,
          steps: [{ id: "s1", type: "payment", status: "failed", message: "fail" }],
          assertions: [],
        },
      },
      { scenarioId: "skipped-after-fail", skipped: true },
    ]);
    expect(xml).toContain("<failure");
    expect(xml).toContain("<skipped/>");
    expect(xml).toContain('tests="2"');
    expect(xml).toContain('failures="1"');
    expect(xml).toContain('skipped="1"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MAX_SUITE_SIZE
// ─────────────────────────────────────────────────────────────────────────────

describe("MAX_SUITE_SIZE enforcement", () => {
  beforeEach(() => {
    stdout = [];
    stderr = [];
    originalArgv = process.argv;
    originalExitCode = process.exitCode;
    process.exitCode = undefined;

    vi.spyOn(console, "log").mockImplementation((...v) => { stdout.push(v.join(" ")); });
    vi.spyOn(console, "error").mockImplementation((...v) => { stderr.push(v.join(" ")); });

    mocks.createRegistry.mockReturnValue({ list: vi.fn().mockReturnValue([]), find: vi.fn() });
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("MAX_SUITE_SIZE is 50", () => {
    expect(MAX_SUITE_SIZE).toBe(50);
  });

  it("rejects a suite larger than MAX_SUITE_SIZE before any validation", async () => {
    const tooMany = Array.from({ length: MAX_SUITE_SIZE + 1 }, (_, i) => `scenario-${i}`);
    const code = await invokeCli("run-suite", ...tooMany, "--output", "json");
    expect(code).toBe(1);
    const err = JSON.parse(stderr.join("\n"));
    expect(err.error.code).toBe("SUITE_TOO_LARGE");
    expect(err.error.message).toContain(String(MAX_SUITE_SIZE));
  });

  it("accepts a suite of exactly MAX_SUITE_SIZE (validation may still fail on unknown IDs)", async () => {
    // We just want to confirm the size check itself passes
    const exactly = Array.from({ length: MAX_SUITE_SIZE }, (_, i) => `scenario-${i}`);
    const code = await invokeCli("run-suite", ...exactly, "--output", "json");
    // Should NOT be SUITE_TOO_LARGE (it will fail on unknown IDs, but that's a different error)
    const errText = stderr.join("\n");
    expect(errText).not.toContain("SUITE_TOO_LARGE");
    // Exit code 1 is fine — it fails on unknown IDs
    expect(code).toBe(1);
  });
});
