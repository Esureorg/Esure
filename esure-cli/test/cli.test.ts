import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ValidatedScenario } from "@esure/backend/src/domain.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  find: vi.fn(),
  list: vi.fn(),
  createRegistry: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("@esure/backend/src/scenarios.js", () => ({
  createScenarioRegistry: mocks.createRegistry,
}));
vi.mock("@esure/backend/src/stellar-gateway.js", () => ({
  StellarTestnetGateway: class {
    execute = mocks.execute;
  },
}));

const definition = {
  schemaVersion: 1,
  id: "test-scenario",
  version: 1,
  name: "Test scenario",
  description: "A scenario used by CLI tests",
  network: "testnet",
  accounts: [{ id: "alice", generate: true, fund: true }],
  assets: [{ id: "xlm", type: "native" }],
  steps: [],
  assertions: [{ type: "accountExists", account: "alice" }],
} satisfies Omit<ValidatedScenario, "contentHash">;

const scenario: ValidatedScenario = {
  ...definition,
  contentHash: "sha256:test",
};

const catalog = [{
  id: scenario.id,
  version: scenario.version,
  name: scenario.name,
  description: scenario.description,
}];

const validJson = JSON.stringify(definition);
const validYaml = [
  "schemaVersion: 1",
  "id: test-scenario",
  "version: 1",
  "name: Test scenario",
  "description: A scenario used by CLI tests",
  "network: testnet",
  "accounts:",
  "  - id: alice",
  "    generate: true",
  "    fund: true",
  "assets:",
  "  - id: xlm",
  "    type: native",
  "steps: []",
  "assertions:",
  "  - type: accountExists",
  "    account: alice",
].join("\n");

const passedExecution = {
  steps: [{ id: "step-1", type: "payment", status: "passed", message: "Payment confirmed." }],
  assertions: [{ type: "accountExists", status: "passed", expected: true, actual: true, message: "Account exists." }],
};

let stdout: string[];
let stderr: string[];
let originalArgv: string[];
let originalExitCode: number | undefined;

async function invokeCli(...args: string[]): Promise<number | undefined> {
  process.argv = ["node", "cli.ts", ...args];
  vi.resetModules();
  await import("../src/cli.js");
  await new Promise<void>((resolve) => setImmediate(resolve));
  return process.exitCode;
}

async function withFile(content: string, _filePath?: string): Promise<void> {
  mocks.readFile.mockResolvedValueOnce(content);
}

describe("CLI commands", () => {
  beforeEach(() => {
    stdout = [];
    stderr = [];
    originalArgv = process.argv;
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
      stdout.push(values.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...values: unknown[]) => {
      stderr.push(values.join(" "));
    });

    mocks.list.mockReturnValue(catalog);
    mocks.find.mockImplementation((id: string) => id === scenario.id ? structuredClone(scenario) : undefined);
    mocks.createRegistry.mockReturnValue({ list: mocks.list, find: mocks.find });
    mocks.execute.mockResolvedValue(passedExecution);
    mocks.readFile.mockReset();
    mocks.list.mockClear();
    mocks.find.mockClear();
    mocks.createRegistry.mockClear();
    mocks.execute.mockClear();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("lists scenarios in human-readable format", async () => {
    expect(await invokeCli("list")).toBe(0);
    expect(stdout.join("\n")).toContain("Bundled Scenarios (1)");
    expect(stdout.join("\n")).toContain("test-scenario");
    expect(stderr).toEqual([]);
  });

  it("lists scenarios as JSON", async () => {
    expect(await invokeCli("list", "--output", "json")).toBe(0);
    expect(JSON.parse(stdout.join("\n"))).toEqual({ scenarios: catalog });
  });

  it.each(["human", "json"])("reports registry errors in %s format", async (format) => {
    mocks.createRegistry.mockImplementation(() => {
      throw new Error("registry unavailable");
    });
    expect(await invokeCli("list", "--output", format)).toBe(1);
    if (format === "json") {
      expect(JSON.parse(stderr.join("\n"))).toEqual({ error: { message: "registry unavailable" } });
    } else {
      expect(stderr.join("\n")).toContain("registry unavailable");
    }
  });

  it.each([
    ["JSON", "scenario.json", validJson],
    ["YAML", "scenario.yaml", validYaml],
    ["YML", "scenario.yml", validYaml],
  ])("validates %s scenario files", async (_format, filePath, contents) => {
    await withFile(contents, filePath);
    expect(await invokeCli("validate", filePath)).toBe(0);
    expect(stdout.join("\n")).toContain("Scenario is valid");
    expect(stderr).toEqual([]);
  });

  it("returns validation details as JSON", async () => {
    await withFile(validJson);
    expect(await invokeCli("validate", "scenario.json", "--output", "json")).toBe(0);
    const result = JSON.parse(stdout.join("\n"));
    expect(result).toMatchObject({
      valid: true,
      scenarioId: scenario.id,
      version: scenario.version,
      schemaVersion: scenario.schemaVersion,
    });
  });

  it.each([
    ["invalid JSON", "{", "scenario.json"],
    ["invalid YAML", "schemaVersion: [", "scenario.yaml"],
    ["invalid schema", JSON.stringify({ ...scenario, extra: true }), "scenario.json"],
    ["Mainnet configuration", JSON.stringify({ ...scenario, network: "mainnet" }), "scenario.json"],
    ["secret seed", JSON.stringify({ ...scenario, name: `seed ${"S".repeat(56)}` }), "scenario.json"],
    ["unsupported extension", validJson, "scenario.txt"],
  ])("rejects %s and emits JSON error output", async (_label, contents, filePath) => {
    await withFile(contents, filePath);
    expect(await invokeCli("validate", filePath, "--output", "json")).toBe(1);
    const result = JSON.parse(stderr.join("\n"));
    expect(result.valid).toBe(false);
    expect(result.error.message).toBeTruthy();
  });

  it("prints validation issues in human-readable output", async () => {
    await withFile(JSON.stringify({ ...scenario, network: "mainnet" }));
    expect(await invokeCli("validate", "scenario.json")).toBe(1);
    expect(stderr.join("\n")).toContain("Validation failed");
    expect(stderr.join("\n")).toContain("network");
  });

  it("reports file read errors as JSON", async () => {
    mocks.readFile.mockRejectedValueOnce(new Error("file unavailable"));
    expect(await invokeCli("validate", "scenario.json", "--output", "json")).toBe(1);
    expect(JSON.parse(stderr.join("\n"))).toEqual({
      valid: false,
      error: { message: "file unavailable" },
    });
  });

  it("runs a bundled scenario and returns a passing JSON report", async () => {
    expect(await invokeCli("run", scenario.id, "--output", "json")).toBe(0);
    const result = JSON.parse(stdout.join("\n"));
    expect(result).toMatchObject({
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      status: "passed",
      summary: { stepsPassed: 1, stepsFailed: 0, assertionsPassed: 1, assertionsFailed: 0 },
    });
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({ id: scenario.id }),
      expect.objectContaining({ stepTimeoutMs: 30000 }),
    );
  });

  it("runs a scenario file and prints a human-readable passing report", async () => {
    await withFile(validJson);
    expect(await invokeCli("run", "scenario.json")).toBe(0);
    expect(stdout.join("\n")).toContain("Running scenario: Test scenario");
    expect(stdout.join("\n")).toContain("Result: PASSED");
  });

  it("returns exit code 1 for failed steps or assertions", async () => {
    mocks.execute.mockResolvedValueOnce({
      steps: [{ id: "step-1", type: "payment", status: "failed", message: "Payment failed." }],
      assertions: [{ type: "accountExists", status: "failed", expected: true, actual: false, message: "Account missing." }],
    });
    expect(await invokeCli("run", scenario.id, "--output", "json")).toBe(1);
    expect(JSON.parse(stdout.join("\n"))).toMatchObject({
      status: "failed",
      summary: { stepsFailed: 1, assertionsFailed: 1 },
    });
  });

  it("reports execution errors as JSON and preserves attached reports", async () => {
    mocks.execute.mockRejectedValueOnce(Object.assign(new Error("gateway failed"), { report: { id: "run-1" } }));
    expect(await invokeCli("run", scenario.id, "--output", "json")).toBe(1);
    expect(JSON.parse(stderr.join("\n"))).toEqual({
      status: "error",
      error: { message: "gateway failed", report: { id: "run-1" } },
    });
  });

  it("reports unknown bundled scenarios", async () => {
    expect(await invokeCli("run", "missing-scenario", "--output", "json")).toBe(1);
    expect(JSON.parse(stderr.join("\n")).error.message).toContain("not found");
  });

  it("handles missing arguments, unknown commands, help, and version", async () => {
    expect(await invokeCli("validate")).toBe(1);
    expect(stderr.join("\n")).toContain("Missing file path argument");

    stderr = [];
    expect(await invokeCli("run")).toBe(1);
    expect(stderr.join("\n")).toContain("Missing scenario ID or file path");

    stderr = [];
    expect(await invokeCli("unknown")).toBe(1);
    expect(stderr.join("\n")).toContain('Unknown command "unknown"');

    stdout = [];
    expect(await invokeCli("list", "--help")).toBe(0);
    expect(stdout.join("\n")).toContain("Usage:");

    stdout = [];
    expect(await invokeCli("--help")).toBe(1);
    expect(stdout.join("\n")).toContain("Usage:");

    stdout = [];
    expect(await invokeCli("--version")).toBe(0);
    expect(stdout.join("\n")).toContain("esure v0.1.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #66 — bounded step progress during human-mode runs
// ─────────────────────────────────────────────────────────────────────────────

describe("#66 human-mode step progress", () => {
  beforeEach(() => {
    stdout = [];
    stderr = [];
    originalArgv = process.argv;
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
      stdout.push(values.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...values: unknown[]) => {
      stderr.push(values.join(" "));
    });
    mocks.list.mockReturnValue(catalog);
    mocks.find.mockImplementation((id: string) => id === scenario.id ? structuredClone(scenario) : undefined);
    mocks.createRegistry.mockReturnValue({ list: mocks.list, find: mocks.find });
    mocks.execute.mockReset();
    mocks.readFile.mockReset();
    mocks.list.mockClear();
    mocks.find.mockClear();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("prints each step and assertion once in human mode", async () => {
    mocks.execute.mockImplementation((_scenario: ValidatedScenario, opts: { onStep?: (s: unknown) => void; onAssertion?: (a: unknown) => void }) => {
      opts?.onStep?.({ id: "pay", type: "payment", status: "passed", message: "Payment done." });
      opts?.onAssertion?.({ type: "accountExists", status: "passed", expected: true, actual: true, message: "Exists." });
      return Promise.resolve(passedExecution);
    });
    expect(await invokeCli("run", scenario.id)).toBe(0);
    const out = stdout.join("\n");
    expect(out).toContain("pay: Payment done.");
    expect(out).toContain("accountExists: Exists.");
    expect(out).toContain("Result: PASSED");
  });

  it("does not print per-step progress in JSON mode", async () => {
    mocks.execute.mockImplementation((_scenario: ValidatedScenario, opts: { onStep?: (s: unknown) => void; onAssertion?: (a: unknown) => void }) => {
      opts?.onStep?.({ id: "pay", type: "payment", status: "passed", message: "Payment done." });
      return Promise.resolve(passedExecution);
    });
    expect(await invokeCli("run", scenario.id, "--output", "json")).toBe(0);
    const out = stdout.join("\n");
    // JSON output should not have progress lines, only the JSON report
    const parsed = JSON.parse(out);
    expect(parsed.status).toBe("passed");
    // progress text should not appear outside JSON
    expect(out).not.toContain("pay: Payment done.");
  });

  it("preserves error after partial progress in human mode", async () => {
    mocks.execute.mockImplementation((_scenario: ValidatedScenario, opts: { onStep?: (s: unknown) => void }) => {
      opts?.onStep?.({ id: "step-1", type: "payment", status: "passed", message: "Step done." });
      return Promise.reject(Object.assign(new Error("network timeout"), { report: { id: "run-abc" } }));
    });
    expect(await invokeCli("run", scenario.id)).toBe(1);
    const out = stdout.join("\n");
    const errOut = stderr.join("\n");
    expect(out).toContain("step-1: Step done.");
    expect(errOut).toContain("Run failed: network timeout");
  });

  it("does not duplicate the final step list in human mode", async () => {
    mocks.execute.mockImplementation((_scenario: ValidatedScenario, opts: { onStep?: (s: unknown) => void; onAssertion?: (a: unknown) => void }) => {
      opts?.onStep?.({ id: "step-1", type: "payment", status: "passed", message: "Payment confirmed." });
      opts?.onAssertion?.({ type: "accountExists", status: "passed", expected: true, actual: true, message: "Account exists." });
      return Promise.resolve(passedExecution);
    });
    expect(await invokeCli("run", scenario.id)).toBe(0);
    const out = stdout.join("\n");
    // Message should appear exactly once (from callback), not duplicated by final report
    const occurrences = (out.match(/Payment confirmed\./g) ?? []).length;
    expect(occurrences).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #67 — run-suite command
// ─────────────────────────────────────────────────────────────────────────────

describe("#67 run-suite command", () => {
  beforeEach(() => {
    stdout = [];
    stderr = [];
    originalArgv = process.argv;
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
      stdout.push(values.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...values: unknown[]) => {
      stderr.push(values.join(" "));
    });
    mocks.list.mockReturnValue(catalog);
    mocks.find.mockImplementation((id: string) => id === scenario.id ? structuredClone(scenario) : undefined);
    mocks.createRegistry.mockReturnValue({ list: mocks.list, find: mocks.find });
    mocks.execute.mockClear();
    mocks.execute.mockResolvedValue(passedExecution);
    mocks.readFile.mockReset();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("rejects missing IDs with a usage error", async () => {
    expect(await invokeCli("run-suite")).toBe(1);
    expect(stderr.join("\n")).toContain("Missing scenario IDs");
  });

  it("rejects unknown scenario IDs before any execution", async () => {
    expect(await invokeCli("run-suite", "missing-scenario", "--output", "json")).toBe(1);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(JSON.parse(stderr.join("\n")).error.message).toContain("missing-scenario");
  });

  it("rejects duplicate IDs before any execution", async () => {
    expect(await invokeCli("run-suite", scenario.id, scenario.id, "--output", "json")).toBe(1);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(JSON.parse(stderr.join("\n")).error.message).toContain("Duplicate");
  });

  it("runs a single known scenario and returns passed JSON", async () => {
    expect(await invokeCli("run-suite", scenario.id, "--output", "json")).toBe(0);
    const result = JSON.parse(stdout.join("\n"));
    expect(result.status).toBe("passed");
    expect(result.total).toBe(1);
    expect(result.passed).toBe(1);
    expect(result.scenarios[0].scenarioId).toBe(scenario.id);
  });

  it("returns failed status when a scenario fails, continues by default", async () => {
    const scenario2: ValidatedScenario = { ...scenario, id: "test-scenario-2" };
    mocks.find.mockImplementation((id: string) => {
      if (id === scenario.id) return structuredClone(scenario);
      if (id === "test-scenario-2") return structuredClone(scenario2);
      return undefined;
    });
    mocks.execute
      .mockResolvedValueOnce({
        steps: [{ id: "s1", type: "payment", status: "failed", message: "fail" }],
        assertions: [],
      })
      .mockResolvedValueOnce(passedExecution);
    expect(await invokeCli("run-suite", scenario.id, "test-scenario-2", "--output", "json")).toBe(1);
    const result = JSON.parse(stdout.join("\n"));
    expect(result.status).toBe("failed");
    expect(result.total).toBe(2);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(1);
    // Both scenarios ran (no fail-fast)
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("stops after first failure with --fail-fast", async () => {
    const scenario2: ValidatedScenario = { ...scenario, id: "test-scenario-2" };
    mocks.find.mockImplementation((id: string) => {
      if (id === scenario.id) return structuredClone(scenario);
      if (id === "test-scenario-2") return structuredClone(scenario2);
      return undefined;
    });
    mocks.execute.mockResolvedValueOnce({
      steps: [{ id: "s1", type: "payment", status: "failed", message: "fail" }],
      assertions: [],
    });
    expect(
      await invokeCli("run-suite", scenario.id, "test-scenario-2", "--fail-fast", "--output", "json"),
    ).toBe(1);
    const result = JSON.parse(stdout.join("\n"));
    expect(result.status).toBe("failed");
    expect(result.total).toBe(1); // only 1 ran
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("records error status for execution errors without aborting (continue mode)", async () => {
    const scenario2: ValidatedScenario = { ...scenario, id: "test-scenario-2" };
    mocks.find.mockImplementation((id: string) => {
      if (id === scenario.id) return structuredClone(scenario);
      if (id === "test-scenario-2") return structuredClone(scenario2);
      return undefined;
    });
    mocks.execute
      .mockRejectedValueOnce(new Error("gateway error"))
      .mockResolvedValueOnce(passedExecution);
    expect(await invokeCli("run-suite", scenario.id, "test-scenario-2", "--output", "json")).toBe(1);
    const result = JSON.parse(stdout.join("\n"));
    expect(result.scenarios[0].status).toBe("error");
    expect(result.scenarios[0].error.message).toBe("gateway error");
    expect(result.scenarios[1].status).toBe("passed");
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("prints human-readable suite summary", async () => {
    expect(await invokeCli("run-suite", scenario.id)).toBe(0);
    const out = stdout.join("\n");
    expect(out).toContain("Run suite:");
    expect(out).toContain(scenario.id);
    expect(out).toContain("Suite result: PASSED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #68 — ASCII status markers
// ─────────────────────────────────────────────────────────────────────────────

describe("#68 ASCII status markers", () => {
  beforeEach(() => {
    stdout = [];
    stderr = [];
    originalArgv = process.argv;
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
      stdout.push(values.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...values: unknown[]) => {
      stderr.push(values.join(" "));
    });
    mocks.list.mockReturnValue(catalog);
    mocks.find.mockImplementation((id: string) => id === scenario.id ? structuredClone(scenario) : undefined);
    mocks.createRegistry.mockReturnValue({ list: mocks.list, find: mocks.find });
    mocks.execute.mockResolvedValue(passedExecution);
    mocks.readFile.mockReset();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("uses PASS/FAIL markers with --ascii on a passing run", async () => {
    mocks.execute.mockImplementation((_scenario: ValidatedScenario, opts: { onStep?: (s: unknown) => void; onAssertion?: (a: unknown) => void }) => {
      opts?.onStep?.({ id: "step-1", type: "payment", status: "passed", message: "Done." });
      opts?.onAssertion?.({ type: "accountExists", status: "passed", expected: true, actual: true, message: "Exists." });
      return Promise.resolve(passedExecution);
    });
    expect(await invokeCli("run", scenario.id, "--ascii")).toBe(0);
    const out = stdout.join("\n");
    expect(out).toContain("PASS");
    expect(out).not.toContain("✓");
  });

  it("uses FAIL ASCII marker for a failed run", async () => {
    mocks.execute.mockImplementation((_scenario: ValidatedScenario, opts: { onStep?: (s: unknown) => void; onAssertion?: (a: unknown) => void }) => {
      opts?.onStep?.({ id: "step-1", type: "payment", status: "failed", message: "Rejected." });
      opts?.onAssertion?.({ type: "accountExists", status: "failed", expected: true, actual: false, message: "Missing." });
      return Promise.resolve({
        steps: [{ id: "step-1", type: "payment", status: "failed", message: "Rejected." }],
        assertions: [{ type: "accountExists", status: "failed", expected: true, actual: false, message: "Missing." }],
      });
    });
    expect(await invokeCli("run", scenario.id, "--ascii")).toBe(1);
    const out = stdout.join("\n") + stderr.join("\n");
    expect(out).toContain("FAIL");
    expect(out).not.toContain("✗");
  });

  it("uses ASCII PASS marker for validate with --ascii", async () => {
    mocks.readFile.mockResolvedValueOnce(validJson);
    expect(await invokeCli("validate", "scenario.json", "--ascii")).toBe(0);
    expect(stdout.join("\n")).toContain("PASS");
    expect(stdout.join("\n")).not.toContain("✓");
  });

  it("uses ASCII FAIL marker for validate failure with --ascii", async () => {
    mocks.readFile.mockResolvedValueOnce(JSON.stringify({ ...scenario, network: "mainnet" }));
    expect(await invokeCli("validate", "scenario.json", "--ascii")).toBe(1);
    expect(stderr.join("\n")).toContain("FAIL");
    expect(stderr.join("\n")).not.toContain("✗");
  });

  it("does not change JSON output format with --ascii", async () => {
    expect(await invokeCli("run", scenario.id, "--ascii", "--output", "json")).toBe(0);
    const result = JSON.parse(stdout.join("\n"));
    expect(result.status).toBe("passed");
    // no PASS/FAIL markers in JSON body
    expect(stdout.join("\n")).not.toContain('"PASS"');
  });

  it("keeps default Unicode glyphs when --ascii is not passed", async () => {
    mocks.execute.mockImplementation((_scenario: ValidatedScenario, opts: { onStep?: (s: unknown) => void }) => {
      opts?.onStep?.({ id: "step-1", type: "payment", status: "passed", message: "Done." });
      return Promise.resolve(passedExecution);
    });
    expect(await invokeCli("run", scenario.id)).toBe(0);
    expect(stdout.join("\n")).toContain("✓");
  });

  it("--ascii appears in help text", async () => {
    stdout = [];
    expect(await invokeCli("--help")).toBe(1);
    expect(stdout.join("\n")).toContain("--ascii");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #54 — Structured JSON argument errors
// ─────────────────────────────────────────────────────────────────────────────

describe("#54 CLI argument errors conform to JSON mode", () => {
  beforeEach(() => {
    stdout = [];
    stderr = [];
    originalArgv = process.argv;
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
      stdout.push(values.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...values: unknown[]) => {
      stderr.push(values.join(" "));
    });
    mocks.list.mockReturnValue(catalog);
    mocks.find.mockImplementation((id: string) => id === scenario.id ? structuredClone(scenario) : undefined);
    mocks.createRegistry.mockReturnValue({ list: mocks.list, find: mocks.find });
    mocks.execute.mockResolvedValue(passedExecution);
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("returns JSON error envelope for unknown command with --output json", async () => {
    expect(await invokeCli("unknown-cmd", "--output", "json")).toBe(1);
    expect(stdout).toEqual([]);
    const err = JSON.parse(stderr.join("\n"));
    expect(err).toEqual({
      error: {
        code: "INVALID_ARGUMENT",
        message: 'Unknown command "unknown-cmd"',
      },
    });
  });

  it("returns JSON error envelope for missing validate file target with -o json", async () => {
    expect(await invokeCli("validate", "-o", "json")).toBe(1);
    expect(stdout).toEqual([]);
    const err = JSON.parse(stderr.join("\n"));
    expect(err).toEqual({
      error: {
        code: "INVALID_ARGUMENT",
        message: "Missing file path argument",
      },
    });
  });

  it("returns JSON error envelope for missing run scenario target with --output json", async () => {
    expect(await invokeCli("run", "--output", "json")).toBe(1);
    expect(stdout).toEqual([]);
    const err = JSON.parse(stderr.join("\n"));
    expect(err).toEqual({
      error: {
        code: "INVALID_ARGUMENT",
        message: "Missing scenario ID or file path",
      },
    });
  });

  it("returns JSON error envelope for missing run-suite target with --output json", async () => {
    expect(await invokeCli("run-suite", "--output", "json")).toBe(1);
    expect(stdout).toEqual([]);
    const err = JSON.parse(stderr.join("\n"));
    expect(err).toEqual({
      error: {
        code: "INVALID_ARGUMENT",
        message: "Missing scenario IDs",
      },
    });
  });

  it("returns JSON error envelope for invalid output format with --output=unknown", async () => {
    expect(await invokeCli("list", "--output", "xml")).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join("\n")).toContain("Invalid output format");
  });

  it("returns JSON error envelope for unknown option when --output json is specified", async () => {
    expect(await invokeCli("list", "--bogus-flag", "--output", "json")).toBe(1);
    expect(stdout).toEqual([]);
    const err = JSON.parse(stderr.join("\n"));
    expect(err.error.code).toBe("INVALID_ARGUMENT");
    expect(err.error.message).toContain("Unknown option");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #55 — Bounded overall run timeout
// ─────────────────────────────────────────────────────────────────────────────

describe("#55 bounded overall run timeout", () => {
  beforeEach(() => {
    stdout = [];
    stderr = [];
    originalArgv = process.argv;
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
      stdout.push(values.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...values: unknown[]) => {
      stderr.push(values.join(" "));
    });
    mocks.list.mockReturnValue(catalog);
    mocks.find.mockImplementation((id: string) => id === scenario.id ? structuredClone(scenario) : undefined);
    mocks.createRegistry.mockReturnValue({ list: mocks.list, find: mocks.find });
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("rejects non-integer or out-of-range timeout values in JSON mode", async () => {
    expect(await invokeCli("run", scenario.id, "--timeout-ms", "0", "--output", "json")).toBe(1);
    const err = JSON.parse(stderr.join("\n"));
    expect(err.error.code).toBe("INVALID_ARGUMENT");
    expect(err.error.message).toContain("--timeout-ms must be an integer between 1 and 600000");

    stderr = [];
    expect(await invokeCli("run", scenario.id, "--timeout-ms", "abc", "--output", "json")).toBe(1);
    const err2 = JSON.parse(stderr.join("\n"));
    expect(err2.error.code).toBe("INVALID_ARGUMENT");
    expect(err2.error.message).toContain("--timeout-ms must be an integer between 1 and 600000");
  });

  it("aborts execution and returns stable timeout error in JSON mode", async () => {
    mocks.execute.mockImplementation((_sc: unknown, opts: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    });

    const exitCode = await invokeCli("run", scenario.id, "--timeout-ms", "10", "--output", "json");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(process.exitCode).toBe(1);
    const err = JSON.parse(stderr.join("\n"));
    expect(err.status).toBe("error");
    expect(err.error.code).toBe("RUN_TIMEOUT");
    expect(err.error.message).toContain("10ms");
  });

  it("aborts execution and reports timeout in human mode", async () => {
    mocks.execute.mockImplementation((_sc: unknown, opts: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    });

    await invokeCli("run", scenario.id, "--timeout-ms", "10");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(process.exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("Run timed out: The run exceeded its 10ms execution limit.");
  });

  it("clears timeout handle when execution completes before deadline", async () => {
    mocks.execute.mockResolvedValueOnce(passedExecution);
    expect(await invokeCli("run", scenario.id, "--timeout-ms", "10000", "--output", "json")).toBe(0);
    const out = JSON.parse(stdout.join("\n"));
    expect(out.status).toBe("passed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #56 — SIGINT and SIGTERM graceful cancellation
// ─────────────────────────────────────────────────────────────────────────────

describe("#56 graceful SIGINT and SIGTERM cancellation", () => {
  beforeEach(() => {
    stdout = [];
    stderr = [];
    originalArgv = process.argv;
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
      stdout.push(values.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...values: unknown[]) => {
      stderr.push(values.join(" "));
    });
    mocks.list.mockReturnValue(catalog);
    mocks.find.mockImplementation((id: string) => id === scenario.id ? structuredClone(scenario) : undefined);
    mocks.createRegistry.mockReturnValue({ list: mocks.list, find: mocks.find });
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("handles SIGINT with exit code 130 and concise JSON output", async () => {
    const initialSigintListeners = process.listenerCount("SIGINT");
    const initialSigtermListeners = process.listenerCount("SIGTERM");

    mocks.execute.mockImplementation((_sc: unknown, opts: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener("abort", () => {
          reject(new Error("operation aborted"));
        });
        setImmediate(() => {
          process.emit("SIGINT");
        });
      });
    });

    const exitCode = await invokeCli("run", scenario.id, "--output", "json");
    expect(exitCode).toBe(130);
    const err = JSON.parse(stderr.join("\n"));
    expect(err).toEqual({
      status: "cancelled",
      error: {
        code: "SIGINT",
        message: "Execution interrupted by SIGINT.",
      },
    });

    // Verify listeners are cleaned up
    expect(process.listenerCount("SIGINT")).toBe(initialSigintListeners);
    expect(process.listenerCount("SIGTERM")).toBe(initialSigtermListeners);
  });

  it("handles SIGTERM with exit code 143 and concise human output", async () => {
    mocks.execute.mockImplementation((_sc: unknown, opts: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener("abort", () => {
          reject(new Error("operation aborted"));
        });
        setImmediate(() => {
          process.emit("SIGTERM");
        });
      });
    });

    const exitCode = await invokeCli("run", scenario.id);
    expect(exitCode).toBe(143);
    expect(stderr.join("\n")).toContain("Execution terminated by SIGTERM.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #57 — Dynamic version from package metadata
// ─────────────────────────────────────────────────────────────────────────────

describe("#57 derive --version from package metadata", () => {
  beforeEach(() => {
    stdout = [];
    stderr = [];
    originalArgv = process.argv;
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
      stdout.push(values.join(" "));
    });
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("displays version matching package.json", async () => {
    expect(await invokeCli("--version")).toBe(0);
    expect(stdout.join("\n")).toBe("esure v0.1.0");
  });
});

