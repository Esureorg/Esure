import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ValidatedScenario } from "@esure/backend/src/domain.js";
import { SCENARIO_LIMITS } from "@esure/backend/src/scenario-schema.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  find: vi.fn(),
  list: vi.fn(),
  createRegistry: vi.fn(),
  readFile: vi.fn(),
  fsReaddirSync: vi.fn(),
  fsStatSync: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
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

const multiCatalog = [
  { id: "xlm-payment", version: 1, name: "XLM Payment", description: "Send XLM between accounts" },
  { id: "missing-trustline", version: 1, name: "Missing Trustline", description: "Payment without a trustline" },
  { id: "issued-asset-payment", version: 1, name: "Issued Asset Payment", description: "Issue and send TESTUSD" },
];

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
let originalStdin: NodeJS.ReadStream;

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

const originalStdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin") ?? {
  configurable: true,
  writable: true,
  value: process.stdin,
};

function mockStdinInput(content: string, isTTY = false): void {
  const chunks = [Buffer.from(content, "utf-8")];
  let ended = false;
  const mockStream = {
    isTTY,
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (ended) return Promise.resolve({ value: undefined, done: true });
          if (chunks.length === 0) {
            ended = true;
            return Promise.resolve({ value: undefined, done: true });
          }
          return Promise.resolve({ value: chunks.shift()!, done: false });
        },
        return: () => {
          ended = true;
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  } as unknown as NodeJS.ReadStream;

  Object.defineProperty(process, "stdin", {
    value: mockStream,
    configurable: true,
    writable: true,
  });
}

function mockDirectory(files: { name: string; size: number; content: string }[]): void {
  const ordered = [...files].sort((left, right) => left.name.localeCompare(right.name));
  mocks.fsReaddirSync.mockReturnValue(
    ordered.map((file) => ({ name: file.name, isFile: () => true }))
  );
  const sizes: Record<string, number> = {};
  for (const file of files) sizes[file.name] = file.size;
  mocks.fsStatSync.mockImplementation((_path: string) => {
    const name = String(_path).split(/[/\\]/).pop()!;
    return { size: sizes[name] ?? 1 };
  });
  const contents: Record<string, string> = {};
  for (const file of files) contents[file.name] = file.content;
  mocks.readFile.mockImplementation(async (_path: string) => {
    const name = String(_path).split(/[/\\]/).pop()!;
    return contents[name];
  });
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
    originalStdin = process.stdin;
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
    mocks.fsReaddirSync.mockReturnValue([]);
    mocks.fsStatSync.mockReturnValue({ size: 1 });
    mocks.list.mockClear();
    mocks.find.mockClear();
    mocks.createRegistry.mockClear();
    mocks.execute.mockClear();
    mocks.fsReaddirSync.mockClear();
    mocks.fsStatSync.mockClear();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    Object.defineProperty(process, "stdin", originalStdinDescriptor);
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

  it("filters list by search term case-insensitively", async () => {
    mocks.list.mockReturnValue(multiCatalog);
    expect(await invokeCli("list", "--search", "XLM", "--output", "json")).toBe(0);
    const result = JSON.parse(stdout.join("\n"));
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].id).toBe("xlm-payment");
  });

  it("trims whitespace in the search term", async () => {
    mocks.list.mockReturnValue(multiCatalog);
    expect(await invokeCli("list", "--search", "  xlm  ", "--output", "json")).toBe(0);
    const result = JSON.parse(stdout.join("\n"));
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].id).toBe("xlm-payment");
  });

  it("returns an empty collection for zero search matches", async () => {
    mocks.list.mockReturnValue(multiCatalog);
    expect(await invokeCli("list", "--search", "zzz-no-match", "--output", "json")).toBe(0);
    const result = JSON.parse(stdout.join("\n"));
    expect(result.scenarios).toEqual([]);
  });

  it("sorts list by id", async () => {
    mocks.list.mockReturnValue(multiCatalog);
    expect(await invokeCli("list", "--sort", "id", "--output", "json")).toBe(0);
    const result = JSON.parse(stdout.join("\n"));
    const ids = result.scenarios.map((s: { id: string }) => s.id);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toEqual(["issued-asset-payment", "missing-trustline", "xlm-payment"]);
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

  it("validates JSON from standard input", async () => {
    mockStdinInput(validJson);
    expect(await invokeCli("validate", "--stdin", "--format", "json")).toBe(0);
    expect(stdout.join("\n")).toContain("Scenario is valid");
    expect(stderr).toEqual([]);
  });

  it("validates YAML from standard input", async () => {
    mockStdinInput(validYaml);
    expect(await invokeCli("validate", "--stdin", "--format", "yaml")).toBe(0);
    expect(stdout.join("\n")).toContain("Scenario is valid");
    expect(stderr).toEqual([]);
  });

  it("rejects empty standard input", async () => {
    mockStdinInput("");
    expect(await invokeCli("validate", "--stdin", "--format", "json", "--output", "json")).toBe(1);
    const result = JSON.parse(stderr.join("\n"));
    expect(result.valid).toBe(false);
    expect(result.error.message).toBeTruthy();
  });

  it("rejects malformed standard input", async () => {
    mockStdinInput("{");
    expect(await invokeCli("validate", "--stdin", "--format", "json", "--output", "json")).toBe(1);
    const result = JSON.parse(stderr.join("\n"));
    expect(result.valid).toBe(false);
  });

  it("rejects oversized standard input", async () => {
    const oversized = "x".repeat(SCENARIO_LIMITS.definitionBytes + 1);
    mockStdinInput(oversized);
    expect(await invokeCli("validate", "--stdin", "--format", "json", "--output", "json")).toBe(1);
    const result = JSON.parse(stderr.join("\n"));
    expect(result.valid).toBe(false);
  });

  it("requires --format with --stdin", async () => {
    mockStdinInput(validJson);
    expect(await invokeCli("validate", "--stdin")).toBe(1);
    expect(stderr.join("\n")).toContain("--format");
  });

  it("does not hang on a terminal without piped input", async () => {
    mockStdinInput(validJson, true);
    expect(await invokeCli("validate", "--stdin", "--format", "json")).toBe(1);
    expect(stderr.join("\n")).toContain("terminal");
  });

  it("shows a bundled scenario in human-readable format", async () => {
    mocks.find.mockImplementation((id: string) => id === scenario.id ? structuredClone(scenario) : undefined);
    expect(await invokeCli("show", scenario.id)).toBe(0);
    const out = stdout.join("\n");
    expect(out).toContain(`Scenario: ${scenario.id} (v${scenario.version})`);
    expect(out).toContain(`Hash: ${scenario.contentHash}`);
    expect(out).toContain("Definition:");
    expect(stderr).toEqual([]);
  });

  it("shows a bundled scenario as JSON", async () => {
    mocks.find.mockImplementation((id: string) => id === scenario.id ? structuredClone(scenario) : undefined);
    expect(await invokeCli("show", scenario.id, "--output", "json")).toBe(0);
    const result = JSON.parse(stdout.join("\n"));
    expect(result).toMatchObject({
      id: scenario.id,
      version: scenario.version,
      contentHash: scenario.contentHash,
    });
    expect(result.definition).toBeDefined();
    expect(result.definition.accounts).toBeDefined();
  });

  it("reports an unknown scenario id for show", async () => {
    mocks.find.mockReturnValue(undefined);
    expect(await invokeCli("show", "missing-scenario", "--output", "json")).toBe(1);
    const result = JSON.parse(stderr.join("\n"));
    expect(result.error.message).toContain("not found");
  });

  it("validates all files in a directory and reports per-file results", async () => {
    mockDirectory([
      { name: "good.json", size: 50, content: validJson },
      { name: "bad.yaml", size: 50, content: "{" },
    ]);
    expect(await invokeCli("validate-directory", "./scenarios", "--output", "json")).toBe(1);
    const result = JSON.parse(stdout.join("\n"));
    expect(result.summary).toEqual({ total: 2, passed: 1, failed: 1 });
    expect(result.valid).toBe(false);
    expect(result.files).toHaveLength(2);
    const good = result.files.find((f: { file: string }) => f.file === "good.json");
    const bad = result.files.find((f: { file: string }) => f.file === "bad.yaml");
    expect(good.valid).toBe(true);
    expect(bad.valid).toBe(false);
    expect(bad.issues).toBeDefined();
  });

  it("processes directory files in stable filename order", async () => {
    mockDirectory([
      { name: "zeta.json", size: 50, content: JSON.stringify({ ...definition, id: "zeta-scenario" }) },
      { name: "alpha.json", size: 50, content: JSON.stringify({ ...definition, id: "alpha-scenario" }) },
    ]);
    expect(await invokeCli("validate-directory", "./scenarios", "--output", "json")).toBe(0);
    const result = JSON.parse(stdout.join("\n"));
    expect(result.files.map((f: { file: string }) => f.file)).toEqual(["alpha.json", "zeta.json"]);
  });

  it("skips unsupported files in a directory", async () => {
    mockDirectory([
      { name: "notes.txt", size: 5, content: "hello" },
      { name: "good.json", size: 50, content: validJson },
    ]);
    expect(await invokeCli("validate-directory", "./scenarios", "--output", "json")).toBe(0);
    const result = JSON.parse(stdout.join("\n"));
    expect(result.summary).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(result.files.map((f: { file: string }) => f.file)).toEqual(["good.json"]);
  });

  it("handles an empty directory as valid", async () => {
    mockDirectory([]);
    expect(await invokeCli("validate-directory", "./empty", "--output", "json")).toBe(0);
    const result = JSON.parse(stdout.join("\n"));
    expect(result.summary).toEqual({ total: 0, passed: 0, failed: 0 });
    expect(result.valid).toBe(true);
  });

  it("reports an oversized file without stopping the directory scan", async () => {
    mockDirectory([
      { name: "good.json", size: 50, content: validJson },
      { name: "big.json", size: SCENARIO_LIMITS.definitionBytes + 1, content: validJson },
    ]);
    expect(await invokeCli("validate-directory", "./scenarios", "--output", "json")).toBe(1);
    const result = JSON.parse(stdout.join("\n"));
    expect(result.valid).toBe(false);
    expect(result.files.map((f: { file: string }) => f.file)).toEqual(["big.json", "good.json"]);
    const big = result.files.find((f: { file: string }) => f.file === "big.json");
    expect(big.valid).toBe(false);
    expect(big.issues).toContain(`exceeds ${SCENARIO_LIMITS.definitionBytes} bytes`);
  });

  it("returns nonzero and reports duplicate scenario ids", async () => {
    const dup = { ...definition, id: "test-scenario" };
    mockDirectory([
      { name: "a.json", size: 50, content: JSON.stringify(dup) },
      { name: "b.json", size: 50, content: JSON.stringify(dup) },
    ]);
    expect(await invokeCli("validate-directory", "./scenarios", "--output", "json")).toBe(1);
    const result = JSON.parse(stdout.join("\n"));
    expect(result.valid).toBe(false);
    expect(result.files[0].valid).toBe(true);
    expect(result.files[1].valid).toBe(false);
    expect(result.files[1].issues).toContain("duplicate scenario id test-scenario");
  });

  it("reports when a directory exceeds the file count bound", async () => {
    const files = Array.from({ length: 101 }, (_, i) => ({
      name: `file-${i}.json`,
      size: 50,
      content: validJson,
    }));
    mockDirectory(files);
    expect(await invokeCli("validate-directory", "./scenarios", "--output", "json")).toBe(1);
    const result = JSON.parse(stderr.join("\n"));
    expect(result.error.message).toContain("exceeds 100 files");
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
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ id: scenario.id }), {
      stepTimeoutMs: 30000,
    });
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
