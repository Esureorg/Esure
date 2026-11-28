/**
 * Argument parsing and typed dispatch boundary extracted from cli.ts (issue #3).
 *
 * `parseCliArgs` returns a discriminated union (`ParsedArgs`) so each command
 * handler receives only the flags it needs, and the type-checker enforces
 * that every command branch is covered.
 */

import { parseArgs } from "node:util";

// ─────────────────────────────────────────────────────────────────────────────
// Timeout constants (re-exported for use in cli.ts without a circular import)
// ─────────────────────────────────────────────────────────────────────────────

/** Default overall run timeout in milliseconds. */
export const DEFAULT_CLI_TIMEOUT_MS = 120_000;
export const MIN_CLI_TIMEOUT_MS = 1;
export const MAX_CLI_TIMEOUT_MS = 600_000;

// ─────────────────────────────────────────────────────────────────────────────
// Shared option types
// ─────────────────────────────────────────────────────────────────────────────

export type OutputFormat = "human" | "json";

export interface CommonOptions {
  output: OutputFormat;
  ascii: boolean;
}

export interface RunOptions extends CommonOptions {
  timeoutMs: number;
  reportFile?: string;
  junit?: string;
  overwrite: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Discriminated union of parsed commands
// ─────────────────────────────────────────────────────────────────────────────

export type ParsedArgs =
  | { command: "help" }
  | { command: "version" }
  | { command: "list"; options: CommonOptions & { search?: string; sort?: string } }
  | { command: "show"; scenarioId: string; options: CommonOptions }
  | { command: "validate"; target: string; options: CommonOptions }
  | { command: "validate-stdin"; format: "json" | "yaml"; options: CommonOptions }
  | { command: "validate-directory"; dirPath: string; options: CommonOptions }
  | { command: "run"; target: string; isExplicitFile: boolean; options: RunOptions; failFast: boolean }
  | { command: "run-suite"; ids: string[]; options: RunOptions; failFast: boolean }
  | { command: "completions"; shell: string }
  | { command: "doctor"; options: CommonOptions }
  | { command: "unknown"; name: string; options: CommonOptions }
  | { command: "arg-error"; message: string; usageHint: string; options: CommonOptions };

// ─────────────────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse `process.argv` (from index 2) into a typed `ParsedArgs` value.
 *
 * Returns an `arg-error` variant for invalid option values so callers can
 * emit a consistent structured error without reaching into the command logic.
 * Never throws.
 */
export function parseCliArgs(argv: string[] = process.argv.slice(2)): ParsedArgs {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        output: { type: "string", short: "o" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        search: { type: "string" },
        sort: { type: "string" },
        stdin: { type: "boolean" },
        format: { type: "string" },
        file: { type: "string" },
        ascii: { type: "boolean" },
        "timeout-ms": { type: "string" },
        "report-file": { type: "string" },
        "junit": { type: "string" },
        "junit-file": { type: "string" },
        overwrite: { type: "boolean" },
        "fail-fast": { type: "boolean" },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Extract output from the raw argv before giving up, so JSON mode is honoured.
    const outputIdx = argv.indexOf("--output") !== -1
      ? argv.indexOf("--output")
      : argv.indexOf("-o");
    const rawOutput = outputIdx !== -1 ? argv[outputIdx + 1] : undefined;
    const output: OutputFormat = rawOutput === "json" ? "json" : "human";
    return {
      command: "arg-error",
      message: `Unknown option: ${message}`,
      usageHint: 'Run "esure --help" for usage information',
      options: { output, ascii: false },
    };
  }

  const { values, positionals } = parsed;

  // --version / --help take priority over everything.
  if (values.version) return { command: "version" };
  if (values.help) return { command: "help" };

  // Validate --output early so error reporting is consistent.
  const rawOutput = values.output;
  if (rawOutput !== undefined && rawOutput !== "human" && rawOutput !== "json") {
    return {
      command: "arg-error",
      message: `Invalid output format "${rawOutput}". Use "human" or "json".`,
      usageHint: 'Run "esure --help" for usage information',
      options: { output: "human", ascii: false },
    };
  }
  const output: OutputFormat = rawOutput === "json" ? "json" : "human";
  const ascii = Boolean(values.ascii);
  const common: CommonOptions = { output, ascii };

  const commandName = positionals[0];
  const args = positionals.slice(1);

  if (!commandName) {
    return { command: "help" };
  }

  // Resolve --timeout-ms for run commands.
  function resolveTimeout(): number | { error: string } {
    const raw = values["timeout-ms"];
    if (raw === undefined) return DEFAULT_CLI_TIMEOUT_MS;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < MIN_CLI_TIMEOUT_MS || n > MAX_CLI_TIMEOUT_MS) {
      return { error: `--timeout-ms must be an integer between ${MIN_CLI_TIMEOUT_MS} and ${MAX_CLI_TIMEOUT_MS}` };
    }
    return n;
  }

  function resolveRunOptions(): RunOptions | { error: string } {
    const timeout = resolveTimeout();
    if (typeof timeout === "object") return timeout;
    return {
      output,
      ascii,
      timeoutMs: timeout,
      reportFile: typeof values["report-file"] === "string" ? values["report-file"] : undefined,
      junit: typeof values["junit"] === "string"
        ? values["junit"]
        : typeof values["junit-file"] === "string"
          ? values["junit-file"]
          : undefined,
      overwrite: Boolean(values.overwrite),
    };
  }

  switch (commandName) {
    case "list": {
      if (args.length > 0) {
        return {
          command: "arg-error",
          message: "Unexpected argument(s) for list command",
          usageHint: "Usage: esure list",
          options: common,
        };
      }
      return {
        command: "list",
        options: {
          ...common,
          search: typeof values.search === "string" ? values.search : undefined,
          sort: typeof values.sort === "string" ? values.sort : undefined,
        },
      };
    }

    case "show": {
      if (args.length === 0) {
        return {
          command: "arg-error",
          message: "Missing scenario ID",
          usageHint: "Usage: esure show <scenario-id>",
          options: common,
        };
      }
      return { command: "show", scenarioId: args[0], options: common };
    }

    case "validate": {
      if (values.stdin) {
        const fmt = values.format;
        if (fmt !== "json" && fmt !== "yaml") {
          return {
            command: "arg-error",
            message: "Missing required --format option. Usage: esure validate --stdin --format <json|yaml>",
            usageHint: "Usage: esure validate --stdin --format <json|yaml>",
            options: common,
          };
        }
        return { command: "validate-stdin", format: fmt, options: common };
      }
      if (args.length === 0) {
        return {
          command: "arg-error",
          message: "Missing file path argument",
          usageHint: "Usage: esure validate <file> or esure validate --stdin --format <json|yaml>",
          options: common,
        };
      }
      if (args.length > 1) {
        return {
          command: "arg-error",
          message: "Unexpected argument(s) for validate command",
          usageHint: "Usage: esure validate <file>",
          options: common,
        };
      }
      return { command: "validate", target: args[0], options: common };
    }

    case "validate-directory": {
      if (args.length === 0) {
        return {
          command: "arg-error",
          message: "Missing directory path",
          usageHint: "Usage: esure validate-directory <directory>",
          options: common,
        };
      }
      return { command: "validate-directory", dirPath: args[0], options: common };
    }

    case "run": {
      const runOpts = resolveRunOptions();
      if (typeof runOpts === "object" && "error" in runOpts) {
        return { command: "arg-error", message: runOpts.error, usageHint: "", options: common };
      }
      const fileFlag = typeof values.file === "string" ? values.file : undefined;
      if (fileFlag !== undefined && args.length > 0) {
        return {
          command: "arg-error",
          message: "Cannot specify both --file and a positional target",
          usageHint: "Usage: esure run <scenario-id> | esure run <file> | esure run --file <file>",
          options: common,
        };
      }
      if (fileFlag !== undefined) {
        if (!fileFlag.trim()) {
          return {
            command: "arg-error",
            message: "Missing file path for --file",
            usageHint: "Usage: esure run --file <file>",
            options: common,
          };
        }
        return { command: "run", target: fileFlag, isExplicitFile: true, options: runOpts, failFast: false };
      }
      if (args.length === 0) {
        return {
          command: "arg-error",
          message: "Missing scenario ID or file path",
          usageHint: "Usage: esure run <scenario-id> or esure run <file>",
          options: common,
        };
      }
      if (args.length > 1) {
        return {
          command: "arg-error",
          message: "Unexpected argument(s) for run command",
          usageHint: "Usage: esure run <scenario-id> or esure run <file>",
          options: common,
        };
      }
      return { command: "run", target: args[0], isExplicitFile: false, options: runOpts, failFast: false };
    }

    case "run-suite": {
      const runOpts = resolveRunOptions();
      if (typeof runOpts === "object" && "error" in runOpts) {
        return { command: "arg-error", message: runOpts.error, usageHint: "", options: common };
      }
      if (args.length === 0) {
        return {
          command: "arg-error",
          message: "Missing scenario IDs",
          usageHint: "Usage: esure run-suite <id> [<id>...]",
          options: common,
        };
      }
      return {
        command: "run-suite",
        ids: args,
        options: runOpts,
        failFast: Boolean(values["fail-fast"]),
      };
    }

    case "completions": {
      if (args.length === 0) {
        return {
          command: "arg-error",
          message: "Missing shell argument",
          usageHint: "Usage: esure completions <bash|zsh>",
          options: common,
        };
      }
      return { command: "completions", shell: args[0] };
    }

    case "doctor": {
      return { command: "doctor", options: common };
    }

    default: {
      return { command: "unknown", name: commandName, options: common };
    }
  }
}
