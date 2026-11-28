import { execFile, execFileSync } from "node:child_process";
import { unlinkSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cliPath = resolve(__dirname, "../dist/cli.js");

describe("Packaging and distribution smoke tests (#58)", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "esure-pkg-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("node dist/cli.js list --help works without tsx or typescript source imports", async () => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, "list", "--help"], {
      cwd: tempDir,
    });
    expect(stderr).toBe("");
    expect(stdout).toContain("esure - Stellar Testnet scenario testing toolkit");
    expect(stdout).toContain("init <file>");
    expect(stdout).toContain("--report-file");
    expect(stdout).toContain("--junit");
  });

  it("node dist/cli.js --version displays correct version", async () => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, "--version"], {
      cwd: tempDir,
    });
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("esure v0.1.0");
  });

  it("node dist/cli.js list resolves bundled scenarios from outside the source checkout", async () => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, "list"], {
      cwd: tempDir,
    });
    expect(stderr).toBe("");
    expect(stdout).toMatch(/Bundled Scenarios \(\d+\):/);
    expect(stdout).toContain("xlm-payment");
    expect(stdout).toContain("basic-payment-with-checks");
  });

  it("node dist/cli.js list --output json returns valid JSON catalogue from outside checkout", async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [cliPath, "list", "--output", "json"],
      { cwd: tempDir },
    );
    expect(stderr).toBe("");
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed.scenarios)).toBe(true);
    expect(parsed.scenarios.length).toBeGreaterThan(0);
    expect(parsed.scenarios.some((s: { id: string }) => s.id === "xlm-payment")).toBe(true);
  });

  it("node dist/cli.js validate works from outside checkout on local files", async () => {
    const scenarioPath = join(tempDir, "sample.json");
    await writeFile(
      scenarioPath,
      JSON.stringify({
        schemaVersion: 1,
        id: "sample-scenario",
        version: 1,
        name: "Sample Scenario",
        description: "A test scenario for packaging validation",
        network: "testnet",
        accounts: [{ id: "alice", generate: true, fund: true }],
        assets: [{ id: "xlm", type: "native" }],
        steps: [],
        assertions: [{ type: "accountExists", account: "alice" }],
      }),
      "utf-8",
    );

    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [cliPath, "validate", scenarioPath],
      { cwd: tempDir },
    );
    expect(stderr).toBe("");
    expect(stdout).toContain("Scenario is valid");
    expect(stdout).toContain("sample-scenario");
  });

  it("npm pack contains only compiled dist files and excludes ts source and tests", () => {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const tarball = execFileSync(npmCmd, ["pack"], {
      cwd: resolve(__dirname, ".."),
      encoding: "utf-8",
      shell: true,
    }).trim();
    try {
      const tarCmd = process.platform === "win32" ? "tar.exe" : "tar";
      const contents = execFileSync(tarCmd, ["-tf", tarball], {
        cwd: resolve(__dirname, ".."),
        encoding: "utf-8",
        shell: true,
      });
      expect(contents).toContain("package/dist/cli.js");
      expect(contents).not.toContain("package/src/cli.ts");
      expect(contents).not.toContain("package/test/cli.test.ts");
    } finally {
      try {
        unlinkSync(resolve(__dirname, "..", tarball));
      } catch {}
    }
  });
});
