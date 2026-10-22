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
vi.mock("@esure/backend/stellar-gateway.js", () => ({
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

  describe("#50 positional argument count enforcement", () => {
    it("list rejects any positional target", async () => {
      expect(await invokeCli("list", "unexpected-arg")).toBe(1);
      expect(stderr.join("\n")).toContain("Error: Unexpected argument(s) for list command");
      expect(stderr.join("\n")).toContain("Usage: esure list");
    });

    it("validate requires exactly one target (rejects missing target)", async () => {
      expect(await invokeCli("validate")).toBe(1);
      expect(stderr.join("\n")).toContain("Error: Missing file path argument");
      expect(stderr.join("\n")).toContain("Usage: esure validate <file>");
    });

    it("validate requires exactly one target (rejects multiple targets)", async () => {
      expect(await invokeCli("validate", "scenario1.json", "scenario2.json")).toBe(1);
      expect(stderr.join("\n")).toContain("Error: Unexpected argument(s) for validate command");
      expect(stderr.join("\n")).toContain("Usage: esure validate <file>");
    });

    it("run requires a target (rejects missing target)", async () => {
      expect(await invokeCli("run")).toBe(1);
      expect(stderr.join("\n")).toContain("Error: Missing scenario ID or file path");
      expect(stderr.join("\n")).toContain("Usage: esure run <scenario-id> or esure run <file>");
    });

    it("run rejects multiple positional targets", async () => {
      expect(await invokeCli("run", "target1", "target2")).toBe(1);
      expect(stderr.join("\n")).toContain("Error: Unexpected argument(s) for run command");
      expect(stderr.join("\n")).toContain("Usage: esure run <scenario-id> or esure run <file>");
    });

    it("accepts paths containing spaces when passed as a single argument", async () => {
      await withFile(validJson);
      expect(await invokeCli("validate", "my scenarios/path payment.json")).toBe(0);
      expect(stdout.join("\n")).toContain("Scenario is valid");
    });
  });

  describe("#51 canonical scenario parser for local files", () => {
    it("rejects YAML with duplicate mapping keys", async () => {
      const duplicateKeyYaml = "id: test-scenario\nid: duplicate-scenario\n";
      await withFile(duplicateKeyYaml);
      expect(await invokeCli("validate", "scenario.yaml", "--output", "json")).toBe(1);
      const res = JSON.parse(stderr.join("\n"));
      expect(res.valid).toBe(false);
      expect(res.error.issues).toContain("definition is not valid YAML");
    });

    it("enforces file size limit via stat before reading oversized files", async () => {
      mocks.stat.mockResolvedValueOnce({ size: 16_385, isFile: () => true });
      expect(await invokeCli("validate", "oversized.json", "--output", "json")).toBe(1);
      const res = JSON.parse(stderr.join("\n"));
      expect(res.valid).toBe(false);
      expect(res.error.issues).toContain("definition exceeds 16384 bytes");
      expect(mocks.readFile).not.toHaveBeenCalled();
    });

    it("rejects malformed syntax without printing full file content", async () => {
      await withFile("{ not valid json at all");
      expect(await invokeCli("validate", "malformed.json")).toBe(1);
      expect(stderr.join("\n")).toContain("definition is not valid JSON");
      expect(stderr.join("\n")).not.toContain("{ not valid json at all");
    });
  });

  describe("#52 case-insensitive scenario file extensions", () => {
    it.each([
      ["uppercase JSON", "test.JSON", validJson],
      ["uppercase YAML", "test.YAML", validYaml],
      ["mixed-case YML", "test.Yml", validYaml],
      ["mixed-case JSON", "test.jSoN", validJson],
    ])("accepts %s file extensions", async (_label, filePath, content) => {
      await withFile(content);
      expect(await invokeCli("validate", filePath)).toBe(0);
      expect(stdout.join("\n")).toContain("Scenario is valid");
    });

    it("rejects unsupported suffixes explicitly", async () => {
      await withFile(validJson);
      expect(await invokeCli("validate", "scenario.toml")).toBe(1);
      expect(stderr.join("\n")).toContain("Scenario file must be .json, .yaml, or .yml");
    });

    it("does not let directory names containing .json determine file format", async () => {
      await withFile(validYaml);
      expect(await invokeCli("validate", "dir.json/scenario.yaml")).toBe(0);
      expect(stdout.join("\n")).toContain("Scenario is valid");
    });
  });

  describe("#53 explicit --file selector for run targets", () => {
    it("runs local scenario with --file even if filename has no slashes or dots", async () => {
      await withFile(validJson);
      expect(await invokeCli("run", "--file", "custom-file.json")).toBe(0);
      expect(stdout.join("\n")).toContain("Running scenario: Test scenario");
      expect(stdout.join("\n")).toContain("Result: PASSED");
    });

    it("fails clearly when combining --file with positional target", async () => {
      expect(await invokeCli("run", "--file", "scenario.json", "positional-id")).toBe(1);
      expect(stderr.join("\n")).toContain("Error: Cannot specify both --file and a positional target");
    });

    it("produces useful path-related error when file does not exist", async () => {
      mocks.stat.mockRejectedValueOnce(Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" }));
      expect(await invokeCli("run", "--file", "nonexistent.json")).toBe(1);
      expect(stderr.join("\n")).toContain('Scenario file not found: "nonexistent.json"');
    });

    it("help text includes --file selector explanation", async () => {
      stdout = [];
      expect(await invokeCli("--help")).toBe(1);
      expect(stdout.join("\n")).toContain("--file <path>");
    });
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
    mocks.stat.mockReset();
    mocks.stat.mockResolvedValue({ size: 100, isFile: () => true });
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

  it("completions bash emits a bash completion script", async () => {
    expect(await invokeCli("completions", "bash")).toBe(0);
    const out = stdout.join("\n");
    expect(out).toContain("_esure_complete()");
    expect(out).toContain("complete -F _esure_complete esure");
    expect(out).toContain("list");
    expect(out).toContain("doctor");
  });

  it("completions zsh emits a zsh completion script", async () => {
    expect(await invokeCli("completions", "zsh")).toBe(0);
    const out = stdout.join("\n");
    expect(out).toContain("#compdef esure");
    expect(out).toContain("_esure()");
    expect(out).toContain("list");
    expect(out).toContain("doctor");
  });

  it("completions rejects an unsupported shell", async () => {
    expect(await invokeCli("completions", "fish")).toBe(1);
    const err = stderr.join("\n");
    expect(err).toContain("Unsupported shell");
    expect(err).toContain("bash");
    expect(err).toContain("zsh");
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

