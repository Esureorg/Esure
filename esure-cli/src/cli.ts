#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { validateScenarioDefinition } from "@esure/backend/src/scenario-schema.js";
import { prepareScenario } from "@esure/backend/src/scenario-loader.js";
import { createScenarioRegistry } from "@esure/backend/src/scenarios.js";
import { StellarTestnetGateway } from "@esure/backend/src/stellar-gateway.js";
import { SafeRunError } from "@esure/backend/src/errors.js";
import { parse as parseYaml } from "yaml";
import type { ValidatedScenario } from "@esure/backend/src/domain.js";
import type { LedgerExecution, LedgerExecutionOptions } from "@esure/backend/src/domain.js";

// ─────────────────────────────────────────────────────────────────────────────
// Version resolution (#57)
// ─────────────────────────────────────────────────────────────────────────────

export function resolveVersion(): string {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 4; i++) {
      const candidate = join(dir, "package.json");
      if (existsSync(candidate)) {
        try {
          const pkg = JSON.parse(readFileSync(candidate, "utf8"));
          if (pkg.name === "@esure/cli" && typeof pkg.version === "string") {
            return pkg.version;
          }
        } catch {
          // ignore JSON parse error and keep walking up
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // fallback if import.meta.url is unavailable
  }
  return "0.1.0";
}

const VERSION = resolveVersion();
const BUNDLED_SCENARIO_DIR_TIMEOUT_MS = 30_000;

/** Default overall run timeout in milliseconds (#55). */
export const DEFAULT_CLI_TIMEOUT_MS = 120_000;
export const MIN_CLI_TIMEOUT_MS = 1;
export const MAX_CLI_TIMEOUT_MS = 600_000;

// ─────────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────────

interface CliOptions {
  output?: "human" | "json";
  help?: boolean;
  version?: boolean;
  /** #68 — use ASCII status markers (PASS/FAIL) instead of Unicode glyphs */
  ascii?: boolean;
  /** #55 — overall run timeout in milliseconds */
  timeoutMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status markers (#68)
// ─────────────────────────────────────────────────────────────────────────────

interface Markers {
  pass: string;
  fail: string;
}

function markers(ascii: boolean): Markers {
  return ascii ? { pass: "PASS", fail: "FAIL" } : { pass: "✓", fail: "✗" };
}

function statusMarker(status: "passed" | "failed" | string, m: Markers): string {
  return status === "passed" ? m.pass : m.fail;
}

// ─────────────────────────────────────────────────────────────────────────────
// Output and error helpers (#54, #55, #56)
// ─────────────────────────────────────────────────────────────────────────────

function reportArgumentError(
  message: string,
  usageHint: string | undefined,
  output: "human" | "json" | undefined,
): void {
  if (output === "json") {
    console.error(JSON.stringify({ error: { code: "INVALID_ARGUMENT", message } }));
  } else {
    console.error(`Error: ${message}`);
    if (usageHint) {
      console.error(usageHint);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Help & version
// ─────────────────────────────────────────────────────────────────────────────

function showHelp(): void {
  console.log(`
esure - Stellar Testnet scenario testing toolkit

Usage:
  esure list                              List bundled scenarios
  esure validate <file>                   Validate a scenario file
  esure run <scenario-id>                 Run a bundled scenario
  esure run <file>                        Run a scenario from file
  esure run-suite <id> [<id>...]          Run multiple bundled scenarios sequentially

Options:
  --output, -o <format> Output format: human (default) or json
  --timeout-ms <ms>     Overall run timeout in milliseconds (default: 120000)
  --ascii               Use ASCII status markers (PASS/FAIL) instead of Unicode glyphs
  --fail-fast           (run-suite) Stop after first failure
  --help, -h            Show this help message
  --version, -v         Show version information

Examples:
  esure list
  esure validate ./my-scenario.yaml
  esure run xlm-payment
  esure run ./my-scenario.yaml --output json
  esure run xlm-payment --timeout-ms 30000
  esure run-suite xlm-payment path-payment --fail-fast

Documentation: https://github.com/Esureorg/Esure
`);
}

function showVersion(): void {
  console.log(`esure v${VERSION}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseCliArgs(): {
  command?: string;
  args: string[];
  options: CliOptions;
  failFast: boolean;
  parseError?: { message: string; usage?: string };
} {
  // Pre-scan for requested output mode so parse errors can be formatted as JSON (#54)
  const argv = process.argv.slice(2);
  let requestedOutput: "human" | "json" = "human";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--output=json" || arg === "-o=json") {
      requestedOutput = "json";
    } else if ((arg === "--output" || arg === "-o") && argv[i + 1] === "json") {
      requestedOutput = "json";
    }
  }

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      options: {
        output: { type: "string", short: "o" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        ascii: { type: "boolean" },
        "fail-fast": { type: "boolean" },
        "timeout-ms": { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    return {
      args: [],
      options: { output: requestedOutput },
      failFast: false,
      parseError: {
        message: error instanceof Error ? error.message : String(error),
        usage: 'Run "esure --help" for usage information',
      },
    };
  }

  const { values, positionals } = parsed;

  let output: "human" | "json" = "human";
  if (values.output !== undefined) {
    if (values.output === "json") {
      output = "json";
    } else if (values.output === "human") {
      output = "human";
    } else {
      return {
        args: [],
        options: { output: requestedOutput },
        failFast: false,
        parseError: {
          message: `Invalid output format "${values.output}". Supported formats are "human" and "json".`,
        },
      };
    }
  }

  let timeoutMs: number | undefined;
  if (values["timeout-ms"] !== undefined) {
    const parsedTimeout = Number(values["timeout-ms"]);
    if (
      !Number.isInteger(parsedTimeout) ||
      parsedTimeout < MIN_CLI_TIMEOUT_MS ||
      parsedTimeout > MAX_CLI_TIMEOUT_MS
    ) {
      return {
        args: [],
        options: { output },
        failFast: false,
        parseError: {
          message: `--timeout-ms must be an integer between ${MIN_CLI_TIMEOUT_MS} and ${MAX_CLI_TIMEOUT_MS}`,
        },
      };
    }
    timeoutMs = parsedTimeout;
  }

  return {
    command: positionals[0],
    args: positionals.slice(1),
    options: {
      output,
      help: Boolean(values.help),
      version: Boolean(values.version),
      ascii: Boolean(values.ascii),
      timeoutMs,
    },
    failFast: Boolean(values["fail-fast"]),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario loading
// ─────────────────────────────────────────────────────────────────────────────

async function loadScenarioFile(filePath: string): Promise<ValidatedScenario> {
  const absolutePath = resolve(filePath);
  const content = await readFile(absolutePath, "utf-8");

  let parsed: unknown;
  if (filePath.endsWith(".json")) {
    parsed = JSON.parse(content);
  } else if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    parsed = parseYaml(content);
  } else {
    throw new Error("Scenario file must be .json, .yaml, or .yml");
  }

  const validated = validateScenarioDefinition(parsed);
  return prepareScenario(validated);
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a LedgerExecutionOptions object that prints progress in human mode (#66). */
function buildExecutionOptions(
  options: CliOptions,
  signal?: AbortSignal,
): LedgerExecutionOptions {
  const execOptions: LedgerExecutionOptions = {
    stepTimeoutMs: BUNDLED_SCENARIO_DIR_TIMEOUT_MS,
    signal,
  };
  if (options.output === "human") {
    const m = markers(options.ascii ?? false);
    execOptions.onStep = (step) => {
      console.log(`  ${statusMarker(step.status, m)} step  ${step.id}: ${step.message}`);
    };
    execOptions.onAssertion = (assertion) => {
      console.log(
        `  ${statusMarker(assertion.status, m)} check ${assertion.type}: ${assertion.message}`,
      );
    };
  }
  return execOptions;
}

function buildRunReport(
  scenario: ValidatedScenario,
  execution: LedgerExecution,
): {
  scenarioId: string;
  scenarioVersion: number;
  status: "passed" | "failed";
  steps: LedgerExecution["steps"];
  assertions: LedgerExecution["assertions"];
  summary: {
    stepsPassed: number;
    stepsFailed: number;
    assertionsPassed: number;
    assertionsFailed: number;
  };
} {
  const passed =
    execution.steps.every((s) => s.status === "passed") &&
    execution.assertions.every((a) => a.status === "passed");
  const stepsPassed = execution.steps.filter((s) => s.status === "passed").length;
  const assertionsPassed = execution.assertions.filter((a) => a.status === "passed").length;
  return {
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    status: passed ? "passed" : "failed",
    steps: execution.steps,
    assertions: execution.assertions,
    summary: {
      stepsPassed,
      stepsFailed: execution.steps.length - stepsPassed,
      assertionsPassed,
      assertionsFailed: execution.assertions.length - assertionsPassed,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal & timeout execution runner (#55, #56)
// ─────────────────────────────────────────────────────────────────────────────

interface ExecutionRunnerResult<T> {
  result?: T;
  exitCode?: number;
}

async function runWithSignalsAndTimeout<T>(
  timeoutMs: number,
  options: CliOptions,
  action: (signal: AbortSignal) => Promise<T>,
): Promise<ExecutionRunnerResult<T>> {
  const controller = new AbortController();
  let timedOut = false;
  let receivedSignal: "SIGINT" | "SIGTERM" | undefined;
  let timer: NodeJS.Timeout | undefined;

  const onSigint = () => {
    if (receivedSignal === "SIGINT") {
      process.exit(130);
    }
    receivedSignal = "SIGINT";
    controller.abort();
  };

  const onSigterm = () => {
    if (receivedSignal === "SIGTERM") {
      process.exit(143);
    }
    receivedSignal = "SIGTERM";
    controller.abort();
  };

  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timer.unref?.();

  try {
    const result = await action(controller.signal);
    return { result };
  } catch (error) {
    if (receivedSignal === "SIGINT") {
      if (options.output === "json") {
        console.error(
          JSON.stringify({
            status: "cancelled",
            error: {
              code: "SIGINT",
              message: "Execution interrupted by SIGINT.",
            },
          }),
        );
      } else {
        const m = markers(options.ascii ?? false);
        console.error(`\n${m.fail} Execution interrupted by SIGINT.`);
      }
      return { exitCode: 130 };
    }

    if (receivedSignal === "SIGTERM") {
      if (options.output === "json") {
        console.error(
          JSON.stringify({
            status: "cancelled",
            error: {
              code: "SIGTERM",
              message: "Execution terminated by SIGTERM.",
            },
          }),
        );
      } else {
        const m = markers(options.ascii ?? false);
        console.error(`\n${m.fail} Execution terminated by SIGTERM.`);
      }
      return { exitCode: 143 };
    }

    if (timedOut) {
      const timeoutError = {
        code: "RUN_TIMEOUT",
        message: `The run exceeded its ${timeoutMs}ms execution limit.`,
      };
      if (options.output === "json") {
        console.error(
          JSON.stringify(
            {
              status: "error",
              error: timeoutError,
            },
            null,
            2,
          ),
        );
      } else {
        const m = markers(options.ascii ?? false);
        console.error(`\n${m.fail} Run timed out: ${timeoutError.message}`);
      }
      return { exitCode: 1 };
    }

    // Normal execution error
    if (options.output === "json") {
      const errorObj: { message: string; report?: unknown } = {
        message: error instanceof Error ? error.message : String(error),
      };
      if (error && typeof error === "object" && "report" in error) {
        errorObj.report = (error as { report: unknown }).report;
      }
      console.error(JSON.stringify({ status: "error", error: errorObj }, null, 2));
    } else {
      const m = markers(options.ascii ?? false);
      console.error(
        `\n${m.fail} Run failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { exitCode: 1 };
  } finally {
    if (timer) clearTimeout(timer);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────

async function listCommand(options: CliOptions): Promise<number> {
  try {
    const registry = createScenarioRegistry();
    const scenarios = registry.list();

    if (options.output === "json") {
      console.log(
        JSON.stringify(
          {
            scenarios: scenarios.map((s) => ({
              id: s.id,
              version: s.version,
              name: s.name,
              description: s.description,
            })),
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`\nBundled Scenarios (${scenarios.length}):\n`);
      for (const scenario of scenarios) {
        console.log(`  ${scenario.id}`);
        console.log(`    ${scenario.name}`);
        console.log(`    ${scenario.description}\n`);
      }
    }
    return 0;
  } catch (error) {
    if (options.output === "json") {
      console.error(
        JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }),
      );
    } else {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
    return 1;
  }
}

async function validateCommand(filePath: string, options: CliOptions): Promise<number> {
  try {
    const scenario = await loadScenarioFile(filePath);

    if (options.output === "json") {
      console.log(
        JSON.stringify(
          {
            valid: true,
            scenarioId: scenario.id,
            version: scenario.version,
            schemaVersion: scenario.schemaVersion,
            contentHash: scenario.contentHash,
          },
          null,
          2,
        ),
      );
    } else {
      const m = markers(options.ascii ?? false);
      console.log(`${m.pass} Scenario is valid`);
      console.log(`  ID: ${scenario.id}`);
      console.log(`  Version: ${scenario.version}`);
      console.log(`  Name: ${scenario.name}`);
      console.log(`  Schema: v${scenario.schemaVersion}`);
      console.log(`  Hash: ${scenario.contentHash}`);
    }
    return 0;
  } catch (error) {
    if (options.output === "json") {
      const errorObj: { message: string; issues?: string[] } = {
        message: error instanceof Error ? error.message : String(error),
      };
      if (error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)) {
        errorObj.issues = error.issues as string[];
      }
      console.error(JSON.stringify({ valid: false, error: errorObj }, null, 2));
    } else {
      const m = markers(options.ascii ?? false);
      console.error(
        `${m.fail} Validation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)) {
        for (const issue of error.issues) {
          console.error(`  - ${issue}`);
        }
      }
    }
    return 1;
  }
}

async function runCommand(target: string, options: CliOptions): Promise<number> {
  let scenario: ValidatedScenario;
  try {
    // Determine if target is a bundled scenario ID or file path
    if (target.includes("/") || target.includes("\\") || target.includes(".")) {
      scenario = await loadScenarioFile(target);
    } else {
      const registry = createScenarioRegistry();
      const found = registry.find(target);
      if (!found) {
        throw new Error(
          `Bundled scenario "${target}" not found. Run "esure list" to see available scenarios.`,
        );
      }
      scenario = found;
    }
  } catch (error) {
    if (options.output === "json") {
      console.error(
        JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }),
      );
    } else {
      const m = markers(options.ascii ?? false);
      console.error(
        `\n${m.fail} Run failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return 1;
  }

  const effectiveTimeout = options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;

  const executionResult = await runWithSignalsAndTimeout(
    effectiveTimeout,
    options,
    async (signal) => {
      // Execute scenario on Stellar Testnet
      const gateway = new StellarTestnetGateway(
        "https://horizon-testnet.stellar.org",
        "https://friendbot.stellar.org",
      );

      if (options.output === "human") {
        console.log(`Running scenario: ${scenario.name}`);
        console.log(`ID: ${scenario.id} (v${scenario.version})\n`);
      }

      const execOptions = buildExecutionOptions(options, signal);
      return gateway.execute(scenario, execOptions);
    },
  );

  if (executionResult.exitCode !== undefined) {
    return executionResult.exitCode;
  }

  const execution = executionResult.result!;
  const report = buildRunReport(scenario, execution);

  if (options.output === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    // In human mode the steps/assertions were already printed via callbacks.
    // Only print the final summary — do not reprint the full step list.
    const m = markers(options.ascii ?? false);
    const passed = report.status === "passed";
    console.log(`\nResult: ${passed ? "PASSED" : "FAILED"}`);
    console.log(
      `  Steps: ${report.summary.stepsPassed}/${execution.steps.length} passed`,
    );
    console.log(
      `  Assertions: ${report.summary.assertionsPassed}/${execution.assertions.length} passed`,
    );
    if (!passed) {
      console.log(`\n${m.fail} One or more checks failed.`);
    }
  }

  return report.status === "passed" ? 0 : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// #67 — run-suite command
// ─────────────────────────────────────────────────────────────────────────────

interface SuiteScenarioResult {
  scenarioId: string;
  status: "passed" | "failed" | "error";
  summary?: {
    stepsPassed: number;
    stepsFailed: number;
    assertionsPassed: number;
    assertionsFailed: number;
  };
  error?: { message: string };
}

async function runSuiteCommand(
  ids: string[],
  options: CliOptions,
  failFast: boolean,
): Promise<number> {
  // 1. Validate all IDs before any network work
  let registry: ReturnType<typeof createScenarioRegistry>;
  try {
    registry = createScenarioRegistry();
  } catch (error) {
    if (options.output === "json") {
      console.error(
        JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }),
      );
    } else {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
    return 1;
  }

  // Check for duplicate IDs
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) duplicates.push(id);
    seen.add(id);
  }
  if (duplicates.length > 0) {
    const msg = `Duplicate scenario IDs: ${duplicates.join(", ")}`;
    if (options.output === "json") {
      console.error(JSON.stringify({ error: { message: msg } }));
    } else {
      console.error(`Error: ${msg}`);
    }
    return 1;
  }

  // Check all IDs exist
  const invalid: string[] = [];
  const scenarios: ValidatedScenario[] = [];
  for (const id of ids) {
    const scenario = registry.find(id);
    if (!scenario) {
      invalid.push(id);
    } else {
      scenarios.push(scenario);
    }
  }
  if (invalid.length > 0) {
    const msg = `Unknown bundled scenario IDs: ${invalid.join(", ")}. Run "esure list" to see available scenarios.`;
    if (options.output === "json") {
      console.error(JSON.stringify({ error: { message: msg } }));
    } else {
      console.error(`Error: ${msg}`);
    }
    return 1;
  }

  // 2. Execute sequentially with isolated gateway per scenario and overall signal/timeout wiring
  const effectiveTimeout = options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;

  const suiteRun = await runWithSignalsAndTimeout(
    effectiveTimeout,
    options,
    async (signal) => {
      const results: SuiteScenarioResult[] = [];
      let suitePassed = true;

      if (options.output === "human") {
        console.log(`\nRun suite: ${ids.length} scenario(s)\n`);
      }

      for (const scenario of scenarios) {
        if (signal.aborted) {
          throw new SafeRunError({
            code: "RUN_TIMEOUT",
            message: "The run was cancelled after reaching its execution limit.",
            category: "timeout",
            retryable: true,
          });
        }

        if (options.output === "human") {
          console.log(`Running: ${scenario.id} — ${scenario.name}`);
        }

        let result: SuiteScenarioResult;
        try {
          const gateway = new StellarTestnetGateway(
            "https://horizon-testnet.stellar.org",
            "https://friendbot.stellar.org",
          );
          // Per-scenario isolated execution with progress callbacks in human mode
          const execOptions = buildExecutionOptions(options, signal);
          const execution = await gateway.execute(scenario, execOptions);
          const report = buildRunReport(scenario, execution);
          result = {
            scenarioId: scenario.id,
            status: report.status,
            summary: report.summary,
          };
        } catch (error) {
          if (signal.aborted) {
            throw error;
          }
          result = {
            scenarioId: scenario.id,
            status: "error",
            error: { message: error instanceof Error ? error.message : String(error) },
          };
        }

        results.push(result);
        if (result.status !== "passed") suitePassed = false;

        if (options.output === "human") {
          const m = markers(options.ascii ?? false);
          const marker = result.status === "passed" ? m.pass : m.fail;
          if (result.status === "error") {
            console.log(`  ${marker} ${scenario.id}: error — ${result.error?.message ?? "unknown"}\n`);
          } else {
            const s = result.summary!;
            console.log(
              `  ${marker} ${scenario.id}: ${result.status} (steps ${s.stepsPassed}/${s.stepsPassed + s.stepsFailed}, checks ${s.assertionsPassed}/${s.assertionsPassed + s.assertionsFailed})\n`,
            );
          }
        }

        if (!suitePassed && failFast) break;
      }

      return { results, suitePassed };
    },
  );

  if (suiteRun.exitCode !== undefined) {
    return suiteRun.exitCode;
  }

  const { results, suitePassed } = suiteRun.result!;

  // 3. Output final summary
  const passedCount = results.filter((r) => r.status === "passed").length;
  const failedCount = results.length - passedCount;

  if (options.output === "json") {
    console.log(
      JSON.stringify(
        {
          status: suitePassed ? "passed" : "failed",
          total: results.length,
          passed: passedCount,
          failed: failedCount,
          scenarios: results,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`Suite result: ${suitePassed ? "PASSED" : "FAILED"}`);
    console.log(`  ${passedCount}/${results.length} scenarios passed`);
    if (failFast && !suitePassed && results.length < ids.length) {
      console.log(
        `  Stopped early (--fail-fast). ${ids.length - results.length} scenario(s) not run.`,
      );
    }
  }

  return suitePassed ? 0 : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const { command, args, options, failFast, parseError } = parseCliArgs();

  if (parseError) {
    reportArgumentError(parseError.message, parseError.usage, options.output);
    return 1;
  }

  if (options.version) {
    showVersion();
    return 0;
  }

  if (options.help || !command) {
    showHelp();
    return command ? 0 : 1;
  }

  switch (command) {
    case "list":
      return listCommand(options);
    case "validate":
      if (args.length === 0) {
        reportArgumentError(
          "Missing file path argument",
          "Usage: esure validate <file>",
          options.output,
        );
        return 1;
      }
      return validateCommand(args[0], options);
    case "run":
      if (args.length === 0) {
        reportArgumentError(
          "Missing scenario ID or file path",
          "Usage: esure run <scenario-id> or esure run <file>",
          options.output,
        );
        return 1;
      }
      return runCommand(args[0], options);
    case "run-suite":
      if (args.length === 0) {
        reportArgumentError(
          "Missing scenario IDs",
          "Usage: esure run-suite <id> [<id>...]",
          options.output,
        );
        return 1;
      }
      return runSuiteCommand(args, options, failFast);
    default:
      reportArgumentError(
        `Unknown command "${command}"`,
        'Run "esure --help" for usage information',
        options.output,
      );
      return 1;
  }
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exitCode = 1;
  });
