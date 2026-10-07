import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The gateway is the only backend dependency that talks to the network, so it
 * is mocked wholesale; the schema, loader and registry run for real against
 * fixtures on disk. `execution` is swapped per test to steer pass/fail.
 */
const mock = vi.hoisted(() => ({
  execution: {
    steps: [
      { id: "step-1", status: "passed", message: "ok", transactionHash: "abc123" },
    ],
    assertions: [{ type: "balance", status: "passed", message: "ok" }],
  } as {
    steps: { id: string; status: string; message: string; transactionHash?: string }[];
    assertions: { type: string; status: string; message: string }[];
  },
}));

vi.mock("@esure/backend/src/stellar-gateway.js", () => ({
  StellarTestnetGateway: class {
    async execute() {
      return mock.execution;
    }
  },
}));

interface CliResult {
  code: number | undefined;
  out: string;
  err: string;
}

async function runCli(args: string[]): Promise<CliResult> {
  vi.resetModules();
  process.argv = ["node", "esure", ...args];
  const out: string[] = [];
  const err: string[] = [];
  const outSpy = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    out.push(parts.map(String).join(" "));
  });
  const errSpy = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    err.push(parts.map(String).join(" "));
  });
  (process as { exitCode?: number | string | undefined }).exitCode = undefined;

  await import("../src/cli.js");

  // main() resolves asynchronously (file reads, registry loads); wait until
  // it has published an exit code rather than guessing a delay.
  const deadline = Date.now() + 5000;
  while ((process as { exitCode?: number | string }).exitCode === undefined) {
    if (Date.now() > deadline) throw new Error(`CLI did not settle. stdout:\n${out.join("\n")}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const code = Number(process.exitCode);
  outSpy.mockRestore();
  errSpy.mockRestore();
  return { code, out: out.join("\n"), err: err.join("\n") };
}

let workDir: string;

async function writeFixture(name: string, content: string): Promise<string> {
  const path = join(workDir, name);
  await writeFile(path, content, "utf-8");
  return path;
}

/** A copy of a bundled scenario the schema accepts as-is. */
async function validScenarioYaml(): Promise<string> {
  return readFile(join(import.meta.dirname, "..", "..", "esure-backend", "scenarios", "minimum-xlm-payment.yaml"), "utf-8");
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "esure-cli-test-"));
  mock.execution = {
    steps: [{ id: "step-1", status: "passed", message: "ok", transactionHash: "abc123" }],
    assertions: [{ type: "balance", status: "passed", message: "ok" }],
  };
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("esure list", () => {
  it("prints the catalog in human format with exit code 0", async () => {
    const result = await runCli(["list"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Bundled Scenarios");
    expect(result.out).toContain("minimum-xlm-payment");
    expect(result.err).toBe("");
  });

  it("emits parseable JSON with the documented fields", async () => {
    const result = await runCli(["list", "--output", "json"]);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.out);
    expect(Array.isArray(payload.scenarios)).toBe(true);
    expect(payload.scenarios.length).toBeGreaterThan(0);
    for (const scenario of payload.scenarios) {
      expect(scenario).toMatchObject({
        id: expect.any(String),
        // Bundled scenarios version as integers (schema: integer >= 1).
        version: expect.any(Number),
        name: expect.any(String),
        description: expect.any(String),
      });
    }
  });
});

describe("esure validate", () => {
  it("accepts a valid YAML scenario and reports it in human format", async () => {
    const file = await writeFixture("good.yaml", await validScenarioYaml());
    const result = await runCli(["validate", file]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Scenario is valid");
    expect(result.out).toContain("minimum-xlm-payment");
  });

  it("accepts a valid JSON scenario", async () => {
    const jsonScenario = await readFile(
      join(import.meta.dirname, "..", "..", "esure-backend", "scenarios", "issued-asset-payment.json"),
      "utf-8",
    );
    const file = await writeFixture("good.json", jsonScenario);
    const result = await runCli(["validate", file, "--output", "json"]);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.out);
    expect(payload.valid).toBe(true);
    expect(payload.scenarioId).toBeTruthy();
    expect(typeof payload.contentHash).toBe("string");
  });

  it("rejects malformed YAML with exit code 1", async () => {
    const file = await writeFixture("broken.yaml", "id: [unterminated\n  value:");
    const result = await runCli(["validate", file]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("Validation failed");
  });

  it("rejects a Mainnet configuration", async () => {
    const yaml = await validScenarioYaml();
    const file = await writeFixture("mainnet.yaml", yaml.replace("network: testnet", "network: mainnet"));
    const result = await runCli(["validate", file, "--output", "json"]);
    expect(result.code).toBe(1);
    const payload = JSON.parse(result.err);
    expect(payload.valid).toBe(false);
    expect(payload.error.message).toBeTruthy();
    expect(JSON.stringify(payload.error).toLowerCase()).toContain("network");
  });

  it("rejects a Stellar secret seed with the issue list in JSON output", async () => {
    const yaml = await validScenarioYaml();
    const seed = `S${"A".repeat(55)}`;
    const seeded = yaml.replace(/description: .+/, `description: "leaky credential ${seed}"`);
    const file = await writeFixture("seed.yaml", seeded);
    const result = await runCli(["validate", file, "--output", "json"]);
    expect(result.code).toBe(1);
    const payload = JSON.parse(result.err);
    expect(payload.valid).toBe(false);
    expect(JSON.stringify(payload.error).toLowerCase()).toContain("secret seed");
  });

  it("rejects a file with an unsupported extension", async () => {
    const file = await writeFixture("scenario.txt", "not a scenario");
    const result = await runCli(["validate", file]);
    expect(result.code).toBe(1);
    expect(result.err).toContain(".json, .yaml, or .yml");
  });

  it("complains when the file path argument is missing", async () => {
    const result = await runCli(["validate"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("Missing file path");
  });
});

describe("esure run", () => {
  it("returns exit code 0 and a PASSED result for a passing scenario", async () => {
    const result = await runCli(["run", "minimum-xlm-payment"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Result: PASSED");
    expect(result.out).toContain("✓ step-1");
    expect(result.out).toContain("Tx: abc123");
  });

  it("returns exit code 1 when any step fails", async () => {
    mock.execution = {
      steps: [{ id: "step-1", status: "failed", message: "boom" }],
      assertions: [{ type: "balance", status: "passed", message: "ok" }],
    };
    const result = await runCli(["run", "minimum-xlm-payment"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("Result: FAILED");
    expect(result.out).toContain("✗ step-1");
  });

  it("emits parseable JSON with a summary for a passing run", async () => {
    const result = await runCli(["run", "minimum-xlm-payment", "--output", "json"]);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.out);
    expect(payload.status).toBe("passed");
    expect(payload.scenarioId).toBe("minimum-xlm-payment");
    expect(payload.summary).toEqual({
      stepsPassed: 1,
      stepsFailed: 0,
      assertionsPassed: 1,
      assertionsFailed: 0,
    });
    expect(payload.steps).toHaveLength(1);
    expect(payload.assertions).toHaveLength(1);
  });

  it("emits parseable error JSON with exit code 1 for an unknown scenario", async () => {
    const result = await runCli(["run", "no-such-scenario", "--output", "json"]);
    expect(result.code).toBe(1);
    const payload = JSON.parse(result.err);
    expect(payload.status).toBe("error");
    expect(payload.error.message).toContain("not found");
  });

  it("runs a scenario from a file path", async () => {
    const file = await writeFixture("from-file.yaml", await validScenarioYaml());
    const result = await runCli(["run", file, "--output", "json"]);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.out);
    expect(payload.status).toBe("passed");
  });

  it("complains when the run argument is missing", async () => {
    const result = await runCli(["run"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("Missing scenario ID");
  });
});

describe("esure output contract", () => {
  it("--version prints the version and exits 0", async () => {
    const result = await runCli(["--version"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("esure v");
  });

  it("--help alongside a command prints usage and exits 0", async () => {
    const result = await runCli(["list", "--help"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Usage:");
    expect(result.out).toContain("--output");
  });

  it("bare --help prints usage (current parsing exits 1 when no command follows)", async () => {
    const result = await runCli(["--help"]);
    expect(result.out).toContain("Usage:");
    expect(result.out).toContain("--output");
    expect(result.code).toBe(1);
  });

  it("shows help and exits 1 when no command is given", async () => {
    const result = await runCli([]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("Usage:");
  });

  it("reports an unknown command and exits 1", async () => {
    const result = await runCli(["frobnicate"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain('Unknown command "frobnicate"');
  });

  it("ignores an unknown flag instead of crashing (strict: false)", async () => {
    const result = await runCli(["list", "--bogus-flag"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Bundled Scenarios");
  });

  it("defaults to human output when --output is absent or unrecognized", async () => {
    const human = await runCli(["list"]);
    expect(human.out).toContain("Bundled Scenarios (");
    const odd = await runCli(["list", "--output", "xml"]);
    expect(odd.out).toContain("Bundled Scenarios (");
  });
});
