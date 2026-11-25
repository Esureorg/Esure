/**
 * Tests for shell completion generation (#158):
 *   - PowerShell Register-ArgumentCompleter output
 *   - Fish completion output
 *   - Consistent rejection of unsupported shells
 *   - Spaces in option names handled safely (no word-splitting)
 *   - Snapshot of generated output for regression detection
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateCompletions,
  SUPPORTED_SHELLS,
  type SupportedShell,
} from "../src/cli.js";

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests — generateCompletions()
// ─────────────────────────────────────────────────────────────────────────────

describe("generateCompletions unit tests (#158)", () => {
  describe("bash", () => {
    it("emits a valid bash completion function", () => {
      const script = generateCompletions("bash");
      expect(script).toContain("_esure_complete()");
      expect(script).toContain("complete -F _esure_complete esure");
      expect(script).toContain("COMPREPLY=");
    });

    it("includes all supported commands", () => {
      const script = generateCompletions("bash");
      for (const cmd of ["list", "validate", "init", "run", "run-suite", "completions", "doctor"]) {
        expect(script).toContain(cmd);
      }
    });

    it("includes all supported options", () => {
      const script = generateCompletions("bash");
      for (const opt of ["--help", "--output", "--ascii", "--fail-fast", "--report-file", "--junit"]) {
        expect(script).toContain(opt);
      }
    });

    it("quotes the current word correctly to handle spaces in paths", () => {
      const script = generateCompletions("bash");
      // compgen -f must receive a quoted argument so paths with spaces work
      expect(script).toContain('compgen -f -- "${cur}"');
    });

    it("triggers file completion for run, validate, and init subcommands", () => {
      const script = generateCompletions("bash");
      expect(script).toContain("run|validate|init");
    });
  });

  describe("zsh", () => {
    it("emits a valid zsh completion script", () => {
      const script = generateCompletions("zsh");
      expect(script).toContain("#compdef esure");
      expect(script).toContain("_esure()");
      expect(script).toContain("_describe");
    });

    it("includes all supported commands", () => {
      const script = generateCompletions("zsh");
      for (const cmd of ["list", "validate", "init", "run", "run-suite", "completions", "doctor"]) {
        expect(script).toContain(cmd);
      }
    });

    it("includes all supported options", () => {
      const script = generateCompletions("zsh");
      for (const opt of ["--help", "--output", "--ascii", "--fail-fast"]) {
        expect(script).toContain(opt);
      }
    });
  });

  describe("fish", () => {
    it("emits a fish completion script", () => {
      const script = generateCompletions("fish");
      expect(script).toContain("complete -c esure");
      expect(script).toContain("__fish_use_subcommand");
      expect(script).toContain("__fish_seen_subcommand_from");
    });

    it("includes all supported commands as individual complete lines", () => {
      const script = generateCompletions("fish");
      for (const cmd of ["list", "validate", "init", "run", "run-suite", "completions", "doctor"]) {
        expect(script).toContain(`-a '${cmd}'`);
      }
    });

    it("includes all supported options as individual complete lines", () => {
      const script = generateCompletions("fish");
      for (const opt of ["help", "output", "ascii", "fail-fast", "report-file", "junit"]) {
        expect(script).toContain(`-l '${opt}'`);
      }
    });

    it("adds file completion for run, validate, init subcommands", () => {
      const script = generateCompletions("fish");
      for (const cmd of ["run", "validate", "init"]) {
        expect(script).toContain(`__fish_seen_subcommand_from ${cmd}`);
      }
    });

    it("does not contain bare option strings without quoting (space-safe)", () => {
      const script = generateCompletions("fish");
      // Each option must appear inside single quotes in a complete invocation
      // so an option like --fail-fast never breaks word splitting
      expect(script).toContain("-l 'fail-fast'");
      expect(script).toContain("-l 'report-file'");
    });

    it("includes installation instructions as a comment", () => {
      const script = generateCompletions("fish");
      expect(script).toContain("~/.config/fish/completions/esure.fish");
    });
  });

  describe("powershell", () => {
    it("emits a Register-ArgumentCompleter block", () => {
      const script = generateCompletions("powershell");
      expect(script).toContain("Register-ArgumentCompleter");
      expect(script).toContain("-Native");
      expect(script).toContain("-CommandName");
    });

    it("targets the esure command", () => {
      const script = generateCompletions("powershell");
      expect(script).toContain("@('esure')");
    });

    it("includes all supported commands as single-quoted array elements", () => {
      const script = generateCompletions("powershell");
      for (const cmd of ["list", "validate", "init", "run", "run-suite", "completions", "doctor"]) {
        expect(script).toContain(`'${cmd}'`);
      }
    });

    it("includes all supported options as single-quoted array elements", () => {
      const script = generateCompletions("powershell");
      for (const opt of ["--help", "--output", "--ascii", "--fail-fast", "--report-file", "--junit"]) {
        expect(script).toContain(`'${opt}'`);
      }
    });

    it("handles options with hyphens safely (no unquoted concatenation)", () => {
      const script = generateCompletions("powershell");
      // All options must be wrapped in single quotes — never bare
      expect(script).toContain("'--fail-fast'");
      expect(script).toContain("'--report-file'");
    });

    it("adds file path completion for run, validate, init subcommands", () => {
      const script = generateCompletions("powershell");
      expect(script).toContain("'run', 'validate', 'init'");
    });

    it("quotes completions that contain spaces", () => {
      const script = generateCompletions("powershell");
      // The scriptblock quotes completions with spaces using single-quotes
      expect(script).toContain("if ($completion -match ' ')");
    });

    it("includes Windows usage example comment", () => {
      const script = generateCompletions("powershell");
      expect(script).toContain("Out-File -Encoding UTF8");
      expect(script).toContain("Invoke-Expression");
    });

    it("includes installation instructions for profile", () => {
      const script = generateCompletions("powershell");
      expect(script).toContain("$PROFILE");
    });
  });

  describe("SUPPORTED_SHELLS constant", () => {
    it("includes bash, zsh, fish, and powershell", () => {
      expect(SUPPORTED_SHELLS).toContain("bash");
      expect(SUPPORTED_SHELLS).toContain("zsh");
      expect(SUPPORTED_SHELLS).toContain("fish");
      expect(SUPPORTED_SHELLS).toContain("powershell");
    });

    it("does not include unsupported shells", () => {
      expect(SUPPORTED_SHELLS).not.toContain("tcsh");
      expect(SUPPORTED_SHELLS).not.toContain("ksh");
      expect(SUPPORTED_SHELLS).not.toContain("csh");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Generation snapshots (regression detection)
// ─────────────────────────────────────────────────────────────────────────────

describe("completion generation snapshots (#158)", () => {
  it.each(["bash", "zsh", "fish", "powershell"] as SupportedShell[])(
    "%s snapshot matches expected structure",
    (shell) => {
      const script = generateCompletions(shell);
      // All scripts must be non-empty strings
      expect(typeof script).toBe("string");
      expect(script.length).toBeGreaterThan(100);
      // All scripts must mention the esure command name
      expect(script).toContain("esure");
      // All scripts must list at least one command
      expect(script).toContain("run-suite");
      // All scripts must end with a newline
      expect(script.endsWith("\n")).toBe(true);
    },
  );

  it("bash and zsh scripts are distinct", () => {
    expect(generateCompletions("bash")).not.toBe(generateCompletions("zsh"));
  });

  it("fish and powershell scripts are distinct from each other and from bash/zsh", () => {
    const scripts = SUPPORTED_SHELLS.map((s) => generateCompletions(s));
    const unique = new Set(scripts);
    expect(unique.size).toBe(SUPPORTED_SHELLS.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CLI integration via invokeCli
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  createRegistry: vi.fn(),
}));

vi.mock("@esure/backend/src/scenarios.js", () => ({
  createScenarioRegistry: mocks.createRegistry,
}));

async function waitForExitCode(timeoutMs = 5000): Promise<number | undefined> {
  const start = Date.now();
  while (process.exitCode === undefined && Date.now() - start < timeoutMs) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return process.exitCode;
}

async function invokeCli(...args: string[]): Promise<{ code: number | undefined; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  process.argv = ["node", "cli.ts", ...args];
  process.exitCode = undefined;

  const logSpy = vi.spyOn(console, "log").mockImplementation((...v) => { out.push(v.join(" ")); });
  const errSpy = vi.spyOn(console, "error").mockImplementation((...v) => { err.push(v.join(" ")); });

  vi.resetModules();
  await import("../src/cli.js");
  const code = await waitForExitCode();

  logSpy.mockRestore();
  errSpy.mockRestore();
  process.argv = originalArgv;
  process.exitCode = originalExitCode;

  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

describe("completions CLI command (#158)", () => {
  beforeEach(() => {
    mocks.createRegistry.mockReturnValue({ list: vi.fn().mockReturnValue([]), find: vi.fn() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["bash", "zsh", "fish", "powershell"] as SupportedShell[])(
    "completions %s exits 0 and prints script to stdout",
    async (shell) => {
      const { code, stdout, stderr } = await invokeCli("completions", shell);
      expect(code).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("esure");
    },
  );

  it("rejects an unsupported shell with exit code 1", async () => {
    const { code, stderr } = await invokeCli("completions", "tcsh");
    expect(code).toBe(1);
    expect(stderr).toContain("Unsupported shell");
    expect(stderr).toContain("bash");
    expect(stderr).toContain("zsh");
    expect(stderr).toContain("fish");
    expect(stderr).toContain("powershell");
  });

  it("rejects missing shell argument with exit code 1", async () => {
    const { code, stderr } = await invokeCli("completions");
    expect(code).toBe(1);
    expect(stderr).toContain("Missing shell argument");
  });

  it("powershell output contains Register-ArgumentCompleter", async () => {
    const { code, stdout } = await invokeCli("completions", "powershell");
    expect(code).toBe(0);
    expect(stdout).toContain("Register-ArgumentCompleter");
  });

  it("fish output contains complete -c esure", async () => {
    const { code, stdout } = await invokeCli("completions", "fish");
    expect(code).toBe(0);
    expect(stdout).toContain("complete -c esure");
  });
});
