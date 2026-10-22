#!/usr/bin/env node

import { readFile as readFilePromises } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";

import { extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { validateScenarioDefinition } from "@esure/backend/src/scenario-schema.js";
import { SCENARIO_LIMITS, ScenarioValidationError } from "@esure/backend/src/scenario-schema.js";
import { parseScenario, prepareScenario, contentHash } from "@esure/backend/src/scenario-loader.js";
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
const MAX_REPORT_FILE_BYTES = 5 * 1024 * 1024;

/** Default overall run timeout in milliseconds (#55). */
export const DEFAULT_CLI_TIMEOUT_MS = 120_000;
export const MIN_CLI_TIMEOUT_MS = 1;
export const MAX_CLI_TIMEOUT_MS = 600_000;

// ─────────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────────

const supportedExtensions = new Set([".json", ".yaml", ".yml"]);
const maxFilesPerDirectory = 100;

interface CliOptions {
  output?: "human" | "json";
  help?: boolean;
  version?: boolean;
  search?: string;
  sort?: string;
  stdin?: boolean;
  format?: "json" | "yaml";
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
  esure list                                  List bundled scenarios
  esure list --search <term>                  Filter scenarios by ID, name, or description
  esure list --sort id                        Sort scenarios by ID
  esure show <scenario-id>                    Show a bundled scenario definition
  esure validate <file>                       Validate a scenario file
  esure validate --stdin --format <format>    Validate a scenario from standard input
  esure validate-directory <dir>              Validate scenario files in a directory
  esure run <scenario-id>                     Run a bundled scenario
  esure run <file>                            Run a scenario from file

Options:
  --output <format>   Output format: human (default) or json
  --search <term>     Filter scenarios by ID, name, or description (case-insensitive)
  --sort <field>      Sort results: id
  --stdin             Read the scenario definition from standard input
  --format <format>   Input format for standard input: json or yaml (required with --stdin)
  --help              Show this help message
  --version           Show version information

Examples:
  esure list
  esure list --search payment --sort id --output json
  esure show xlm-payment
  esure validate ./my-scenario.yaml
  cat ./my-scenario.json | esure validate --stdin --format json
  esure validate-directory ./scenarios
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

function parseCliArgs(): { command?: string; args: string[]; options: CliOptions } {
  const { values, positionals } = parseArgs({
    options: {
      output: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      search: { type: "string" },
      sort: { type: "string" },
      stdin: { type: "boolean" },
      format: { type: "string" },
    },
    allowPositionals: true,
    strict: false,
  });

  return {
    command: positionals[0],
    args: positionals.slice(1),
    options: {
      output,
      help: Boolean(values.help),
      version: Boolean(values.version),
      search: typeof values.search === "string" ? values.search : undefined,
      sort: typeof values.sort === "string" ? values.sort : undefined,
      stdin: Boolean(values.stdin),
      format: values.format === "json" || values.format === "yaml" ? values.format : undefined,
    },
    failFast: Boolean(values["fail-fast"]),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario loading
// ─────────────────────────────────────────────────────────────────────────────

async function loadScenarioFile(filePath: string): Promise<ValidatedScenario> {
  const ext = extname(filePath).toLowerCase();
  let format: "json" | "yaml";
  if (ext === ".json") {
    format = "json";
  } else if (ext === ".yaml" || ext === ".yml") {
    format = "yaml";
  } else {
    throw new Error("Scenario file must be .json, .yaml, or .yml");
  }

  const absolutePath = resolve(filePath);
  const content = await readFilePromises(absolutePath, "utf-8");

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

function renderValidationSuccess(scenario: ValidatedScenario, options: CliOptions): void {
  if (options.output === "json") {
    console.log(JSON.stringify({
      valid: true,
      scenarioId: scenario.id,
      version: scenario.version,
      schemaVersion: scenario.schemaVersion,
      contentHash: scenario.contentHash,
    }, null, 2));
  } else {
    console.log(`✓ Scenario is valid`);
    console.log(`  ID: ${scenario.id}`);
    console.log(`  Version: ${scenario.version}`);
    console.log(`  Name: ${scenario.name}`);
    console.log(`  Schema: v${scenario.schemaVersion}`);
    console.log(`  Hash: ${scenario.contentHash}`);
  }
}

function renderValidationError(error: unknown, options: CliOptions): void {
  if (options.output === "json") {
    const errorObj: { message: string; issues?: string[] } = {
      message: error instanceof Error ? error.message : String(error),
    };
    if (error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)) {
      errorObj.issues = error.issues as string[];
    }
    console.error(JSON.stringify({
      valid: false,
      error: errorObj,
    }, null, 2));
  } else {
    console.error(`✗ Validation failed: ${error instanceof Error ? error.message : String(error)}`);
    if (error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)) {
      for (const issue of error.issues) {
        console.error(`  - ${issue}`);
      }
    }
  }
}

async function listCommand(options: CliOptions): Promise<number> {
  try {
    const registry = createScenarioRegistry();
    let scenarios = registry.list();

    if (options.search) {
      const term = options.search.trim().toLowerCase();
      if (term) {
        scenarios = scenarios.filter((scenario) =>
          scenario.id.toLowerCase().includes(term) ||
          scenario.name.toLowerCase().includes(term) ||
          scenario.description.toLowerCase().includes(term)
        );
      }
    }

    if (options.sort === "id") {
      scenarios = [...scenarios].sort((left, right) => left.id.localeCompare(right.id));
    }

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
      console.error(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }, null, 2));
    } else {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
    return 1;
  }
}

async function showCommand(scenarioId: string, options: CliOptions): Promise<number> {
  try {
    const registry = createScenarioRegistry();
    const found = registry.find(scenarioId);
    if (!found) {
      throw new Error(`Bundled scenario "${scenarioId}" not found. Run "esure list" to see available scenarios.`);
    }

    const payload = {
      id: found.id,
      version: found.version,
      name: found.name,
      description: found.description,
      contentHash: found.contentHash,
      definition: {
        schemaVersion: found.schemaVersion,
        network: found.network,
        accounts: found.accounts,
        assets: found.assets,
        steps: found.steps,
        assertions: found.assertions,
      },
    };

    if (options.output === "json") {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`Scenario: ${found.id} (v${found.version})`);
      console.log(`Hash: ${found.contentHash}`);
      console.log(`Name: ${found.name}`);
      console.log(`Description: ${found.description}`);
      console.log(`Definition:`);
      console.log(JSON.stringify(payload.definition, null, 2));
    }
    return 0;
  } catch (error) {
    if (options.output === "json") {
      console.error(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }, null, 2));
    } else {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
    return 1;
  }
}

async function validateFileCommand(filePath: string, options: CliOptions): Promise<number> {
  try {
    const scenario = await loadScenarioFile(filePath);
    renderValidationSuccess(scenario, options);
    return 0;
  } catch (error) {
    renderValidationError(error, options);
    return 1;
  }
}

export async function readStdinInput(limit: number, stdin: NodeJS.ReadableStream = process.stdin): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stdin) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    if (total > limit) {
      throw new ScenarioValidationError([`stdin input exceeds ${limit} bytes`]);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export async function validateStdinCommand(options: CliOptions, stdin: NodeJS.ReadStream = process.stdin): Promise<number> {
  try {
    if (!options.format) {
      throw new Error("Missing required --format option. Usage: esure validate --stdin --format <json|yaml>");
    }
    if (stdin.isTTY) {
      throw new Error("stdin is a terminal; pipe a scenario definition, e.g. cat scenario.json | esure validate --stdin --format json");
    }

    const content = await readStdinInput(SCENARIO_LIMITS.definitionBytes, stdin);
    if (content.trim().length === 0) {
      throw new ScenarioValidationError(["stdin input is empty"]);
    }

    const scenario = parseScenario(content, options.format);
    renderValidationSuccess(scenario, options);
    return 0;
  } catch (error) {
    renderValidationError(error, options);
    return 1;
  }
}

async function validateDirectoryCommand(dirPath: string, options: CliOptions): Promise<number> {
  try {
    const absolute = resolve(dirPath);
    const entries = readdirSync(absolute, { withFileTypes: true })
      .filter((entry) => entry.isFile() && supportedExtensions.has(extname(entry.name).toLowerCase()))
      .sort((left, right) => left.name.localeCompare(right.name));

    if (entries.length > maxFilesPerDirectory) {
      throw new Error(`scenario directory ${absolute} exceeds ${maxFilesPerDirectory} files`);
    }

    type DirectoryResult = {
      file: string;
      valid: boolean;
      scenario?: ValidatedScenario;
      issues?: string[];
    };

    const results: DirectoryResult[] = [];

    for (const entry of entries) {
      const filePath = resolve(absolute, entry.name);
      const size = statSync(filePath).size;
      if (size > SCENARIO_LIMITS.definitionBytes) {
        results.push({ file: entry.name, valid: false, issues: [`exceeds ${SCENARIO_LIMITS.definitionBytes} bytes`] });
        continue;
      }

      const content = await readFilePromises(filePath, "utf-8");
      const format = extname(entry.name).toLowerCase() === ".json" ? "json" : "yaml";
      try {
        const scenario = parseScenario(content, format);
        results.push({ file: entry.name, valid: true, scenario });
      } catch (error) {
        const issues = error instanceof ScenarioValidationError
          ? error.issues
          : [error instanceof Error ? error.message : String(error)];
        results.push({ file: entry.name, valid: false, issues });
      }
    }

    const seenIds = new Set<string>();
    for (const result of results) {
      if (result.valid && result.scenario) {
        if (seenIds.has(result.scenario.id)) {
          result.valid = false;
          result.issues = [...(result.issues ?? []), `duplicate scenario id ${result.scenario.id}`];
        } else {
          seenIds.add(result.scenario.id);
        }
      }
    }

    const total = results.length;
    const passed = results.filter((result) => result.valid).length;
    const failed = total - passed;
    const ok = failed === 0;

    if (options.output === "json") {
      console.log(JSON.stringify({
        directory: absolute,
        files: results.map((result) => ({
          file: result.file,
          valid: result.valid,
          ...(result.scenario ? { scenarioId: result.scenario.id, version: result.scenario.version, contentHash: result.scenario.contentHash } : {}),
          ...(result.issues ? { issues: result.issues } : {}),
        })),
        summary: { total, passed, failed },
        valid: ok,
      }, null, 2));
    } else {
      console.log(`\nValidate directory: ${absolute}\n`);
      for (const result of results) {
        const icon = result.valid ? "✓" : "✗";
        console.log(`  ${icon} ${result.file}`);
        if (!result.valid && result.issues) {
          for (const issue of result.issues) {
            console.log(`    - ${issue}`);
          }
        }
      }
      console.log(`\n${total} file(s) processed: ${passed} valid, ${failed} failed`);
    }
    return ok ? 0 : 1;
  } catch (error) {
    if (options.output === "json") {
      console.error(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }, null, 2));
    } else {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
    return 1;
  }
}

async function runCommand(target: string, options: CliOptions): Promise<number> {
  let scenario: ValidatedScenario;
  try {
    // Determine if target is a bundled scenario ID or file path
    if (isExplicitFile || target.includes("/") || target.includes("\\") || target.includes(".")) {
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
    executionError = error instanceof Error ? error : new Error(String(error));
    if (error && typeof error === "object" && "report" in error) {
      const rawReport = (error as { report: unknown }).report;
      if (rawReport && typeof rawReport === "object") {
        execution =
          (rawReport as { execution?: LedgerExecution }).execution ??
          (rawReport as LedgerExecution);
      }
    }

    if (options.output === "json") {
      console.error(
        JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }),
      );
    } else {
      const m = markers(options.ascii ?? false);
      console.error(
        `\n${m.fail} Run failed: ${executionError.message}`,
      );
      if (error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)) {
        for (const issue of error.issues) {
          console.error(`  - ${issue}`);
        }
      }
    }
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

  // Handle artifacts for suite (#59, #60)
  let artifactError = false;

  if (options.reportFile) {
    try {
      const suiteReportPayload = {
        status: suitePassed ? "passed" : "failed",
        total: results.length,
        passed: passedCount,
        failed: failedCount,
        scenarios: results,
      };
      await writeArtifactFile(
        options.reportFile,
        JSON.stringify(suiteReportPayload, null, 2) + "\n",
        Boolean(options.overwrite),
        "report",
      );
    } catch (err: unknown) {
      artifactError = true;
      const msg = err instanceof Error ? err.message : String(err);
      if (options.output === "json") {
        console.error(JSON.stringify({ error: { message: msg } }));
      } else {
        console.error(`Error writing report file: ${msg}`);
      }
    }
  }

  if (options.junit) {
    try {
      const xml = generateJunitXml(suiteJunitRuns);
      await writeArtifactFile(
        options.junit,
        xml,
        Boolean(options.overwrite),
        "JUnit",
      );
    } catch (err: unknown) {
      artifactError = true;
      const msg = err instanceof Error ? err.message : String(err);
      if (options.output === "json") {
        console.error(JSON.stringify({ error: { message: msg } }));
      } else {
        console.error(`Error writing JUnit file: ${msg}`);
      }
    }
  }

  if (artifactError) return 1;
  return suitePassed ? 0 : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// #158 — shell command completions (bash, zsh)
// ─────────────────────────────────────────────────────────────────────────────

const COMPLETION_COMMANDS = [
  "list",
  "validate",
  "init",
  "run",
  "run-suite",
  "completions",
  "doctor",
];

const COMPLETION_OPTIONS = [
  "--help",
  "--version",
  "--output",
  "--ascii",
  "--report-file",
  "--junit",
  "--overwrite",
  "--fail-fast",
];

function generateCompletions(shell: "bash" | "zsh"): string {
  const quotedCommands = COMPLETION_COMMANDS.map((c) => `"${c}"`).join(" ");
  const quotedOptions = COMPLETION_OPTIONS.map((o) => `"${o}"`).join(" ");
  const cmdList = COMPLETION_COMMANDS.join(" ");
  const optList = COMPLETION_OPTIONS.join(" ");

  if (shell === "zsh") {
    return `#compdef esure
# Esure CLI shell completion for zsh.
# Source this file or add it to your fpath to enable completions.

_esure() {
  local -a commands=(${quotedCommands})
  local -a options=(${quotedOptions})

  if [[ \${words[1]} == "esure" ]]; then
    if (( CURRENT == 2 )); then
      _describe 'command' commands
    elif (( CURRENT > 2 )); then
      _describe 'option' options
    fi
  fi
}

_esure "$@"
`;
  }

  return `_esure_complete() {
  local cur prev opts cmds
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  cmds="${cmdList}"
  opts="${optList}"

  if [[ \${cur} == -* ]] ; then
    COMPREPLY=( $(compgen -W "\${opts}" -- \${cur}) 2>/dev/null )
    return 0
  fi

  case "\${prev}" in
    esure)
      COMPREPLY=( $(compgen -W "\${cmds}" -- \${cur}) 2>/dev/null )
      ;;
    run|validate|init)
      COMPREPLY=( $(compgen -f \${cur}) 2>/dev/null )
      ;;
    *)
      COMPREPLY=( $(compgen -W "\${opts}" -- \${cur}) 2>/dev/null )
      ;;
  esac
}

complete -F _esure_complete esure
complete -F _esure_complete ./esure 2>/dev/null || true
`;
}

async function completionsCommand(shell: string): Promise<number> {
  const normalized = shell.toLowerCase();
  if (normalized !== "bash" && normalized !== "zsh") {
    console.error(`Error: Unsupported shell "${shell}". Use "bash" or "zsh".`);
    console.error('Usage: esure completions <bash|zsh>');
    return 1;
  }
  console.log(generateCompletions(normalized));
  return 0;
}

export async function main(): Promise<number> {
  const { command, args, options } = parseCliArgs();

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
      if (args.length > 0) {
        console.error("Error: Unexpected argument(s) for list command");
        console.error("Usage: esure list");
        return 1;
      }
      return listCommand(options);
    case "show":
      if (args.length === 0) {
        console.error("Error: Missing scenario ID");
        console.error('Usage: esure show <scenario-id>');
        return 1;
      }
      return showCommand(args[0], options);
    case "validate":
      if (options.stdin) {
        return validateStdinCommand(options);
      }
      if (args.length === 0) {
        console.error("Error: Missing file path argument");
        console.error("Usage: esure validate <file> or esure validate --stdin --format <json|yaml>");
        return 1;
      }
      return validateFileCommand(args[0], options);
    case "validate-directory":
      if (args.length === 0) {
        console.error("Error: Missing directory path");
        console.error('Usage: esure validate-directory <directory>');
        return 1;
      }
      return validateDirectoryCommand(args[0], options);
    case "run":
      if (options.file !== undefined && args.length > 0) {
        console.error("Error: Cannot specify both --file and a positional target");
        console.error("Usage: esure run <scenario-id> | esure run <file> | esure run --file <file>");
        return 1;
      }
      if (options.file !== undefined) {
        if (!options.file.trim()) {
          console.error("Error: Missing file path for --file");
          console.error("Usage: esure run --file <file>");
          return 1;
        }
        return runCommand(options.file, options, true);
      }
      if (args.length === 0) {
        reportArgumentError(
          "Missing scenario ID or file path",
          "Usage: esure run <scenario-id> or esure run <file>",
          options.output,
        );
        return 1;
      }
      if (args.length > 1) {
        console.error("Error: Unexpected argument(s) for run command");
        console.error("Usage: esure run <scenario-id> or esure run <file>");
        return 1;
      }
      return runCommand(args[0], options, false);
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
    case "completions":
      if (args.length === 0) {
        console.error('Error: Missing shell argument');
        console.error('Usage: esure completions <bash|zsh>');
        return 1;
      }
      return completionsCommand(args[0]);
    case "doctor":
      return doctorCommand(options);
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
