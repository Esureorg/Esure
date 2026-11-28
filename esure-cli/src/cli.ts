#!/usr/bin/env node

import {
  readFile as readFilePromises,
  writeFile as writeFilePromises,
  rename as renameFile,
  unlink as unlinkFile,
  access as accessFile,
  stat as statFile,
} from "node:fs/promises";
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { extname, resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { validateScenarioDefinition, SCENARIO_LIMITS, ScenarioValidationError } from "@esure/backend/src/scenario-schema.js";
import { parseScenario } from "@esure/backend/src/scenario-loader.js";
import { createScenarioRegistry } from "@esure/backend/src/scenarios.js";
import { StellarTestnetGateway } from "@esure/backend/src/stellar-gateway.js";
import { SafeRunError } from "@esure/backend/src/errors.js";
import { validateRunReport } from "@esure/backend/src/report-schema.js";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import type { ValidatedScenario, LedgerExecution, LedgerExecutionOptions } from "@esure/backend/src/domain.js";

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

/** Maximum number of scenarios in a single run-suite invocation. */
export const MAX_SUITE_SIZE = 50;

const supportedExtensions = new Set([".json", ".yaml", ".yml"]);
const maxFilesPerDirectory = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────────

interface CliOptions {
  output?: "human" | "json";
  stdin?: boolean;
  format?: string;
  help?: boolean;
  version?: boolean;
  search?: string;
  sort?: string;
  stdin?: boolean;
  format?: "json" | "yaml";
  timeoutMs?: number;
  reportFile?: string;
  junit?: string;
  overwrite?: boolean;
  ascii?: boolean;
  file?: string;
  failFast?: boolean;
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
// Status markers (#68)
// ─────────────────────────────────────────────────────────────────────────────

interface Markers {
  pass: string;
  fail: string;
  warn: string;
}

function markers(ascii: boolean): Markers {
  return ascii
    ? { pass: "PASS", fail: "FAIL", warn: "WARN" }
    : { pass: "✓", fail: "✗", warn: "⚠" };
}

function statusMarker(status: string, m: Markers): string {
  return status === "passed" ? m.pass : m.fail;
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
  esure init <file>                           Scaffold a new scenario file
  esure run <scenario-id>                     Run a bundled scenario
  esure run <file>                            Run a scenario from file
  esure run --file <path>                     Run an explicit scenario file
  esure run-suite <id|file> [<id|file>...]    Run multiple scenarios sequentially
  esure report validate <file>                Validate an archived run report offline
  esure completions <shell>                   Generate shell completions
  esure doctor                               Diagnose the local installation

Options:
  --output, -o <format>  Output format: human (default) or json
  --search <term>     Filter scenarios by ID, name, or description (case-insensitive)
  --sort <field>      Sort results: id
  --stdin             Read the scenario definition from standard input
  --format <format>   Input format for standard input: json or yaml (required with --stdin)
  --file <path>       Explicit scenario file for the run command
  --timeout-ms <ms>   Overall run timeout in milliseconds (default: 120000)
  --report-file <path> Write a JSON run report artifact
  --junit <path>      Write a JUnit XML artifact (alias: --junit-file)
  --ascii             Use ASCII status markers (PASS/FAIL) instead of Unicode glyphs
  --overwrite         Allow overwriting existing artifact files
  --fail-fast         Stop a suite after the first failure
  --help              Show this help message
  --version           Show version information

Examples:
  esure list
  esure list --search payment --sort id --output json`,
  show: `Usage: esure show <scenario-id>

Show a bundled scenario definition.

Options:
  --output <format>  Output format: human (default) or json

Example:
  esure show xlm-payment`,
  validate: `Usage: esure validate <file>
       esure validate --stdin --format <json|yaml>

Validate a scenario file or a definition read from standard input.

Options:
  --stdin            Read the definition from standard input
  --format <format>  Input format for standard input: json or yaml (required with --stdin)
  --output <format>  Output format: human (default) or json

Examples:
  esure validate ./my-scenario.yaml
  cat ./my-scenario.json | esure validate --stdin --format json
  esure validate-directory ./scenarios
  esure schema scenario --output json
  esure schema report
  esure run xlm-payment
  esure run ./my-scenario.yaml --output json
  esure run xlm-payment --timeout-ms 30000
  esure run-suite xlm-payment path-payment --fail-fast
  esure run-suite ./suite/a.yaml ./suite/b.yaml --junit results.xml
  esure completions bash | source
  esure completions fish | source
  esure completions powershell | Invoke-Expression

Example:
  esure doctor`,
};

function showHelp(command?: string): void {
  if (command) {
    console.log(HELP_TEXT[command] ?? `Usage: esure ${command} --help`);
    return;
  }
  console.log(`esure - Stellar Testnet scenario testing toolkit

Usage: esure <command> [options]

Commands:
  list                 List bundled scenarios
  show                 Show a bundled scenario definition
  validate             Validate a scenario file or standard input
  validate-directory   Validate scenario files in a directory
  plan                 Inspect a local execution plan without running it
  format               Convert a validated scenario between JSON and YAML
  report               Compare exported run reports
  run                  Run one bundled scenario or file
  run-suite            Run bundled scenarios sequentially
  completions          Print bash or zsh completions
  doctor               Check local prerequisites and Testnet connectivity

Use "esure <command> --help" for command-specific options and examples.
Global options: --help, --version`);
}

function showVersion(): void {
  console.log(`esure v${VERSION}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_OPTION_KEYS = new Set([
  "output",
  "help",
  "version",
  "search",
  "sort",
  "stdin",
  "format",
  "timeout-ms",
  "report-file",
  "junit",
  "junit-file",
  "overwrite",
  "fail-fast",
  "ascii",
  "file",
]);

function parseCliArgs(): {
  command?: string;
  args: string[];
  options: CliOptions;
  failFast: boolean;
  rawOutput: string | undefined;
  unknownOption: string | undefined;
} {
  const { values, positionals } = parseArgs({
    options: {
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      search: { type: "string" },
      sort: { type: "string" },
      stdin: { type: "boolean" },
      format: { type: "string" },
      "timeout-ms": { type: "string" },
      "report-file": { type: "string" },
      junit: { type: "string" },
      "junit-file": { type: "string" },
      overwrite: { type: "boolean" },
      "fail-fast": { type: "boolean" },
      ascii: { type: "boolean" },
      file: { type: "string" },
    },
    allowPositionals: true,
    strict: false,
  });

  let unknownOption: string | undefined;
  for (const key of Object.keys(values)) {
    if (!ALLOWED_OPTION_KEYS.has(key)) {
      unknownOption = `--${key}`;
      break;
    }
  }

  const rawOutput = typeof values.output === "string" ? values.output : undefined;
  const rawTimeout = typeof values["timeout-ms"] === "string" ? values["timeout-ms"] : undefined;
  const timeoutMs = rawTimeout !== undefined ? Number(rawTimeout) : undefined;
  const junit = typeof values.junit === "string" ? values.junit
    : typeof values["junit-file"] === "string" ? values["junit-file"] : undefined;

  return {
    command: positionals[0],
    args: positionals.slice(1),
    options: {
      output: rawOutput === "json" ? "json" : rawOutput === "human" ? "human" : undefined,
      help: Boolean(values.help),
      version: Boolean(values.version),
      search: typeof values.search === "string" ? values.search : undefined,
      sort: typeof values.sort === "string" ? values.sort : undefined,
      stdin: Boolean(values.stdin),
      format: values.format === "json" || values.format === "yaml" ? values.format : undefined,
      timeoutMs,
      reportFile: typeof values["report-file"] === "string" ? values["report-file"] : undefined,
      junit,
      overwrite: Boolean(values.overwrite),
      ascii: Boolean(values.ascii),
      file: typeof values.file === "string" ? values.file : undefined,
    },
    failFast: Boolean(values["fail-fast"]),
    rawOutput,
    unknownOption,
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

  let stats;
  try {
    stats = await statFile(absolutePath);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT") {
      throw new Error(`Scenario file not found: "${filePath}"`);
    }
    throw new Error(err instanceof Error ? err.message : String(err));
  }

  if (stats.size > SCENARIO_LIMITS.definitionBytes) {
    throw new ScenarioValidationError([`definition exceeds ${SCENARIO_LIMITS.definitionBytes} bytes`]);
  }

  const content = await readFilePromises(absolutePath, "utf-8");
  return parseScenario(content, format);
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
  if (options.output !== "json") {
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
  const content = await readFilePromises(absolutePath, "utf-8");
  return parseScenario(content, format);
}

  let format: ScenarioInputFormat;
  if (filePath.endsWith(".json")) {
    format = "json";
  } else if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    format = "yaml";
  } else {
    const m = markers(options.ascii ?? false);
    console.log(`${m.pass} Scenario is valid`);
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
    if (error && typeof error === "object" && "issues" in error && Array.isArray((error as { issues: unknown[] }).issues)) {
      errorObj.issues = (error as { issues: string[] }).issues;
    }
    console.error(JSON.stringify({
      valid: false,
      error: errorObj,
    }, null, 2));
  } else {
    const m = markers(options.ascii ?? false);
    console.error(`${m.fail} Validation failed: ${error instanceof Error ? error.message : String(error)}`);
    if (error && typeof error === "object" && "issues" in error && Array.isArray((error as { issues: unknown[] }).issues)) {
      for (const issue of (error as { issues: string[] }).issues) {
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

async function validateCommand(loadScenario: () => Promise<ValidatedScenario>, options: CliOptions): Promise<number> {
  try {
    const scenario = await loadScenario();

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

async function formatCommand(inputPath: string, options: CliOptions): Promise<number> {
  try {
    if (!options.targetFormat) {
      throw new Error('Missing required --to option. Choose "json" or "yaml".');
    }
    if (options.outputFile !== undefined && !options.outputFile.trim()) {
      throw new Error("Missing output file path for --output-file.");
    }
    if (options.overwrite && options.outputFile === undefined) {
      throw new Error("--overwrite requires --output-file.");
    }
    const { contentHash: _contentHash, ...definition } = await loadScenarioFile(inputPath);
    const formatted = options.targetFormat === "json"
      ? `${JSON.stringify(definition, null, 2)}\n`
      : stringifyYaml(definition, { lineWidth: 0 });

    if (Buffer.byteLength(formatted, "utf8") > SCENARIO_LIMITS.definitionBytes) {
      throw new ScenarioValidationError([
        `formatted definition exceeds ${SCENARIO_LIMITS.definitionBytes} bytes`,
      ]);
    }

    if (!options.outputFile) {
      console.log(formatted.trimEnd());
      return 0;
    }

    await writeFilePromises(options.outputFile, formatted, {
      encoding: "utf8",
      flag: options.overwrite ? "w" : "wx",
    });
    return 0;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    const message = code === "EEXIST" && options.outputFile
      ? `Scenario file "${options.outputFile}" already exists. Use --overwrite to replace it.`
      : error instanceof Error ? error.message : String(error);
    if (options.output === "json") {
      console.error(JSON.stringify({ error: { message } }));
    } else {
      console.error(`Error: ${message}`);
    }
    return 1;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

interface EvidenceChanges {
  added: { index: number; value: unknown }[];
  removed: { index: number; value: unknown }[];
  changed: { index: number; before: unknown; after: unknown }[];
}

function compareEvidence(left: unknown[], right: unknown[]): EvidenceChanges {
  const changes: EvidenceChanges = { added: [], removed: [], changed: [] };
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index++) {
    if (stableJson(left[index]) !== stableJson(right[index])) {
      changes.changed.push({ index, before: left[index], after: right[index] });
    }
  }
  for (let index = sharedLength; index < right.length; index++) {
    changes.added.push({ index, value: right[index] });
  }
  for (let index = sharedLength; index < left.length; index++) {
    changes.removed.push({ index, value: left[index] });
  }
  return changes;
}

function reportProvenance(report: RunReport) {
  return {
    id: report.id,
    scenarioId: report.scenarioId,
    scenarioVersion: report.scenarioVersion,
    scenarioSchemaVersion: report.scenarioSchemaVersion,
    scenarioContentHash: report.scenarioContentHash,
    network: report.network,
    createdAt: report.createdAt,
    completedAt: report.completedAt,
    expiresAt: report.expiresAt,
  };
}

function compareRunReports(left: RunReport, right: RunReport) {
  const leftProvenance = reportProvenance(left);
  const rightProvenance = reportProvenance(right);
  const provenance = {
    same: stableJson(leftProvenance) === stableJson(rightProvenance),
    left: leftProvenance,
    right: rightProvenance,
  };
  const status = { same: left.status === right.status, left: left.status, right: right.status };
  const evidence = {
    steps: compareEvidence(left.steps, right.steps),
    assertions: compareEvidence(left.assertions, right.assertions),
    summary: {
      same: stableJson(left.summary) === stableJson(right.summary),
      left: left.summary,
      right: right.summary,
    },
    error: {
      same: stableJson(left.error ?? null) === stableJson(right.error ?? null),
      left: left.error ?? null,
      right: right.error ?? null,
    },
  };
  const equal = provenance.same && status.same &&
    evidence.steps.added.length === 0 && evidence.steps.removed.length === 0 && evidence.steps.changed.length === 0 &&
    evidence.assertions.added.length === 0 && evidence.assertions.removed.length === 0 && evidence.assertions.changed.length === 0 &&
    evidence.summary.same && evidence.error.same;
  return { equal, exitCode: equal ? 0 : 2, provenance, status, evidence };
}

async function readRunReport(filePath: string): Promise<RunReport> {
  if (extname(filePath).toLowerCase() !== ".json") {
    throw new Error(`Run report file "${filePath}" must have a .json extension.`);
  }
  const absolutePath = resolve(filePath);
  if (statSync(absolutePath).size > MAX_REPORT_FILE_BYTES) {
    throw new Error(`Run report file exceeds the maximum size of ${MAX_REPORT_FILE_BYTES} bytes.`);
  }
  const source = await readFilePromises(absolutePath, "utf-8");
  if (Buffer.byteLength(source, "utf8") > MAX_REPORT_FILE_BYTES) {
    throw new Error(`Run report file exceeds the maximum size of ${MAX_REPORT_FILE_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error(`Run report file "${filePath}" contains invalid JSON.`);
  }
  try {
    return validateRunReport(parsed);
  } catch (error) {
    if (error instanceof RunReportValidationError) {
      throw new Error(`Run report file "${filePath}" is invalid: ${error.issues.join("; ")}`);
    }
    throw error;
  }
}

async function compareReportsCommand(leftPath: string, rightPath: string, options: CliOptions): Promise<number> {
  try {
    const [left, right] = await Promise.all([readRunReport(leftPath), readRunReport(rightPath)]);
    const comparison = compareRunReports(left, right);
    if (options.output === "json") {
      console.log(JSON.stringify(comparison, null, 2));
    } else {
      console.log(`Report comparison: ${comparison.equal ? "EQUAL" : "DIFFERENT"}`);
      console.log(`Run IDs: ${comparison.provenance.left.id} -> ${comparison.provenance.right.id}`);
      console.log(`Scenarios: ${comparison.provenance.left.scenarioId} v${comparison.provenance.left.scenarioVersion} -> ${comparison.provenance.right.scenarioId} v${comparison.provenance.right.scenarioVersion}`);
      console.log(`Scenario hashes: ${comparison.provenance.left.scenarioContentHash} -> ${comparison.provenance.right.scenarioContentHash}`);
      console.log(`Network: ${comparison.provenance.left.network} -> ${comparison.provenance.right.network}`);
      console.log(`Created: ${comparison.provenance.left.createdAt} -> ${comparison.provenance.right.createdAt}`);
      console.log(`Completed: ${comparison.provenance.left.completedAt ?? "(none)"} -> ${comparison.provenance.right.completedAt ?? "(none)"}`);
      console.log(`Expires: ${comparison.provenance.left.expiresAt ?? "(none)"} -> ${comparison.provenance.right.expiresAt ?? "(none)"}`);
      console.log(`Provenance: ${comparison.provenance.same ? "equal" : "different"}`);
      console.log(`Status: ${comparison.status.left} -> ${comparison.status.right}${comparison.status.same ? " (equal)" : " (different)"}`);
      console.log(`Steps: ${comparison.evidence.steps.changed.length} changed, ${comparison.evidence.steps.added.length} added, ${comparison.evidence.steps.removed.length} removed`);
      for (const change of comparison.evidence.steps.changed) {
        console.log(`  step ${change.index + 1}: ${stableJson(change.before)} -> ${stableJson(change.after)}`);
      }
      for (const change of comparison.evidence.steps.added) {
        console.log(`  step ${change.index + 1} added: ${stableJson(change.value)}`);
      }
      for (const change of comparison.evidence.steps.removed) {
        console.log(`  step ${change.index + 1} removed: ${stableJson(change.value)}`);
      }
      console.log(`Assertions: ${comparison.evidence.assertions.changed.length} changed, ${comparison.evidence.assertions.added.length} added, ${comparison.evidence.assertions.removed.length} removed`);
      for (const change of comparison.evidence.assertions.changed) {
        console.log(`  assertion ${change.index + 1}: ${stableJson(change.before)} -> ${stableJson(change.after)}`);
      }
      for (const change of comparison.evidence.assertions.added) {
        console.log(`  assertion ${change.index + 1} added: ${stableJson(change.value)}`);
      }
      for (const change of comparison.evidence.assertions.removed) {
        console.log(`  assertion ${change.index + 1} removed: ${stableJson(change.value)}`);
      }
      console.log(`Summary: ${stableJson(comparison.evidence.summary.left)} -> ${stableJson(comparison.evidence.summary.right)}`);
      console.log(`Error evidence: ${stableJson(comparison.evidence.error.left)} -> ${stableJson(comparison.evidence.error.right)}`);
    }
    return comparison.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.output === "json") {
      console.error(JSON.stringify({ error: { message } }));
    } else {
      console.error(`Error: ${message}`);
    }
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
      const format = extname(entry.name).toLowerCase() === ".json" ? "json" : "yaml";
      try {
        const size = statSync(filePath).size;
        if (size > SCENARIO_LIMITS.definitionBytes) {
          results.push({ file: entry.name, valid: false, issues: [`exceeds ${SCENARIO_LIMITS.definitionBytes} bytes`] });
          continue;
        }

        const content = await readFilePromises(filePath, "utf-8");
        const scenario = parseScenario(content, format);
        results.push({ file: entry.name, valid: true, scenario });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const issues = error instanceof ScenarioValidationError
          ? error.issues
          : [`unreadable: ${message}`];
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

// ─────────────────────────────────────────────────────────────────────────────
// Signal & timeout wiring (#55, #56)
// ─────────────────────────────────────────────────────────────────────────────

interface RunOutcome<T> {
  exitCode?: number;
  result?: T;
}

async function runWithSignalsAndTimeout<T>(
  timeoutMs: number,
  options: CliOptions,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<RunOutcome<T>> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let signalReason: "SIGINT" | "SIGTERM" | "RUN_TIMEOUT" | undefined;

  const onSigint = () => {
    signalReason = "SIGINT";
    controller.abort();
  };
  const onSigterm = () => {
    signalReason = "SIGTERM";
    controller.abort();
  };

  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  timeoutHandle = setTimeout(() => {
    signalReason = "RUN_TIMEOUT";
    controller.abort();
  }, timeoutMs);

  try {
    const result = await fn(controller.signal);
    return { result };
  } catch (err) {
    if (signalReason === "SIGINT") {
      const msg = "Execution interrupted by SIGINT.";
      if (options.output === "json") {
        console.error(JSON.stringify({ status: "cancelled", error: { code: "SIGINT", message: msg } }));
      } else {
        console.error(msg);
      }
      return { exitCode: 130 };
    }
    if (signalReason === "SIGTERM") {
      const msg = "Execution terminated by SIGTERM.";
      if (options.output === "json") {
        console.error(JSON.stringify({ status: "cancelled", error: { code: "SIGTERM", message: msg } }));
      } else {
        console.error(msg);
      }
      return { exitCode: 143 };
    }
    if (signalReason === "RUN_TIMEOUT") {
      const msg = `The run exceeded its ${timeoutMs}ms execution limit.`;
      if (options.output === "json") {
        console.error(JSON.stringify({ status: "error", error: { code: "RUN_TIMEOUT", message: `Run timed out after ${timeoutMs}ms. ${msg}` } }));
      } else {
        console.error(`Run timed out: ${msg}`);
      }
      return { exitCode: 1 };
    }
    // Not a signal/timeout abort — propagate the original error.
    throw err;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Artifact file writing (#59)
// ─────────────────────────────────────────────────────────────────────────────

async function writeArtifactFile(
  filePath: string,
  content: string,
  overwrite: boolean,
  label: string,
): Promise<void> {
  if (!overwrite) {
    try {
      await accessFile(filePath);
      const cap = label.charAt(0).toUpperCase() + label.slice(1);
      throw new Error(`${cap} file "${filePath}" already exists. Use --overwrite to replace it.`);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("already exists")) throw err;
      // ENOENT means the file does not exist — proceed.
    }
  }

  const dir = dirname(filePath);
  const base = basename(filePath);
  const tmpPath = join(dir, `.${base}.tmp${Date.now()}`);

  try {
    await writeFilePromises(tmpPath, content, "utf-8");
    await renameFile(tmpPath, filePath);
  } catch (err: unknown) {
    try { await unlinkFile(tmpPath); } catch { /* ignore */ }
    throw new Error(`Error writing ${label} file: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JUnit XML generation (#60) with skipped support
// ─────────────────────────────────────────────────────────────────────────────

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface JunitRun {
  scenarioId: string;
  execution?: {
    scenarioId: string;
    scenarioVersion: number;
    steps: Array<{ id: string; type: string; status: string; message: string }>;
    assertions: Array<{ type: string; status: string; message: string; expected: unknown; actual: unknown }>;
  };
  error?: { message: string };
  skipped?: boolean;
}

function junitStepType(run: JunitRun): NonNullable<JunitRun["execution"]>["steps"] {
  return run.execution!.steps;
}

export function generateJunitXml(runs: JunitRun[]): string {
  let totalTests = 0;
  let totalFailures = 0;
  let totalErrors = 0;
  let totalSkipped = 0;

  const suites: string[] = [];

  for (const run of runs) {
    const name = escapeXml(run.scenarioId);

    if (run.skipped) {
      totalTests += 1;
      totalSkipped += 1;
      suites.push(
        `  <testsuite name="${name}" tests="1" failures="0" errors="0" skipped="1">\n` +
        `    <testcase classname="${name}" name="execution" time="0"><skipped/></testcase>\n` +
        `  </testsuite>`,
      );
      continue;
    }

    if (!run.execution) {
      totalTests += 1;
      totalErrors += 1;
      const msg = escapeXml(run.error?.message ?? "Unknown error");
      suites.push(
        `  <testsuite name="${name}" tests="1" failures="0" errors="1">\n` +
        `    <testcase classname="${name}" name="execution" time="0">\n` +
        `      <error message="${msg}" type="ExecutionError">${msg}</error>\n` +
        `    </testcase>\n` +
        `  </testsuite>`,
      );
      continue;
    }

    const { steps, assertions } = run.execution;
    const cases = steps.length + assertions.length;
    let suiteFail = 0;
    const caseLines: string[] = [];

    for (const step of steps) {
      const caseName = escapeXml(`step ${step.id}: ${step.message}`);
      if (step.status === "failed") {
        suiteFail++;
        const msg = escapeXml(step.message);
        caseLines.push(
          `    <testcase classname="${name}" name="${caseName}" time="0">\n` +
          `      <failure message="${msg}" type="${escapeXml(step.type)}">${msg}</failure>\n` +
          `    </testcase>`,
        );
      } else {
        caseLines.push(`    <testcase classname="${name}" name="${caseName}" time="0"/>`);
      }
    }

    for (const assertion of assertions) {
      const caseName = escapeXml(`assertion ${assertion.type}: ${assertion.message}`);
      if (assertion.status === "failed") {
        suiteFail++;
        const msg = escapeXml(assertion.message);
        caseLines.push(
          `    <testcase classname="${name}" name="${caseName}" time="0">\n` +
          `      <failure message="${msg}" type="${escapeXml(assertion.type)}">${msg}</failure>\n` +
          `    </testcase>`,
        );
      } else {
        caseLines.push(`    <testcase classname="${name}" name="${caseName}" time="0"/>`);
      }
    }

    totalTests += cases;
    totalFailures += suiteFail;

    suites.push(
      `  <testsuite name="${name}" tests="${cases}" failures="${suiteFail}" errors="0">\n` +
      caseLines.join("\n") + "\n" +
      `  </testsuite>`,
    );
  }

  const skippedAttr = totalSkipped > 0 ? ` skipped="${totalSkipped}"` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuites name="esure" tests="${totalTests}" failures="${totalFailures}" errors="${totalErrors}"${skippedAttr}>\n` +
    suites.join("\n") + "\n" +
    `</testsuites>\n`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// init command (#62)
// ─────────────────────────────────────────────────────────────────────────────

async function initCommand(filePath: string, options: CliOptions): Promise<number> {
  const ext = extname(filePath).toLowerCase();
  if (ext !== ".json" && ext !== ".yaml" && ext !== ".yml") {
    console.error(`Error: Unsupported file extension "${ext}". Supported: .json, .yaml, and .yml`);
    return 1;
  }

  const stem = basename(filePath, ext);
  const scenarioId = stem.replace(/[^a-z0-9-]/gi, "-").toLowerCase();

  const template = {
    schemaVersion: 1,
    id: scenarioId,
    version: 1,
    name: `${scenarioId} scenario`,
    description: `Scenario for ${scenarioId}`,
    network: "testnet",
    accounts: [
      { id: "alice", generate: true, fund: true },
      { id: "bob", generate: true, fund: true },
    ],
    assets: [{ id: "xlm", type: "native" }],
    steps: [
      { id: "send-xlm", type: "payment", from: "alice", to: "bob", asset: "xlm", amount: "5" },
    ],
    assertions: [
      { type: "accountExists", account: "alice" },
      { type: "accountExists", account: "bob" },
      { type: "stepSucceeded", step: "send-xlm" },
    ],
  };

  if (!options.overwrite) {
    try {
      await accessFile(filePath);
      console.error(`Error: Scenario file "${filePath}" already exists. Use --overwrite to replace it.`);
      return 1;
    } catch { /* file doesn't exist — proceed */ }
  }

  const content = ext === ".json"
    ? JSON.stringify(template, null, 2) + "\n"
    : yamlStringify(template, { lineWidth: 0 });

  try {
    await writeFilePromises(filePath, content, "utf-8");
  } catch (err: unknown) {
    console.error(`Error creating scenario file: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  if (options.output === "json") {
    console.log(JSON.stringify({ created: true, scenarioId, file: filePath }, null, 2));
  } else {
    console.log(`Scenario scaffolded: ${filePath}`);
    console.log(`  Validate: esure validate ${filePath}`);
    console.log(`  Run:      esure run ${filePath}`);
  }

  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// report validate command (#156)
// ─────────────────────────────────────────────────────────────────────────────

async function reportValidateCommand(filePath: string, options: CliOptions): Promise<number> {
  if (extname(filePath).toLowerCase() !== ".json") {
    console.error(`Error: Report file must have a .json extension`);
    return 1;
  }

  try {
    const stats = await statFile(filePath);
    if (stats.size > MAX_REPORT_FILE_BYTES) {
      console.error(`Error: Report file exceeds the maximum size of ${MAX_REPORT_FILE_BYTES} bytes`);
      return 1;
    }
  } catch (err: unknown) {
    console.error(`Error reading report file: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  let content: string;
  try {
    content = await readFilePromises(filePath, "utf-8");
  } catch (err: unknown) {
    console.error(`Error reading report file: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    console.error(`Error: invalid JSON in report file`);
    return 1;
  }

  try {
    const report = validateRunReport(parsed);
    if (options.output === "json") {
      console.log(JSON.stringify({
        valid: true,
        reportId: report.id,
        scenarioId: report.scenarioId,
        status: report.status,
      }, null, 2));
    } else {
      console.log(`✓ Report is valid`);
    }
    return 0;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const issues = (err as { issues?: string[] }).issues ?? [];
    const detail = issues.length > 0 ? "\n" + issues.join("\n") : "";
    console.error(`Error: ${msg}${detail}`);
    return 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// run command
// ─────────────────────────────────────────────────────────────────────────────

async function runCommand(target: string, options: CliOptions, isExplicitFile = false): Promise<number> {
  let scenario: ValidatedScenario;

  try {
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
    const err = error instanceof Error ? error : new Error(String(error));
    if (options.output === "json") {
      console.error(JSON.stringify({ status: "error", error: { message: err.message } }, null, 2));
    } else {
      const m = markers(options.ascii ?? false);
      console.error(`\n${m.fail} Run failed: ${err.message}`);
      if (error && typeof error === "object" && "issues" in error && Array.isArray((error as { issues: unknown[] }).issues)) {
        for (const issue of (error as { issues: string[] }).issues) {
          console.error(`  - ${issue}`);
        }
      }
    }

    // Write error artifacts when requested (#59, #60)
    if (options.reportFile) {
      try {
        const payload = { status: "error", error: { message: err.message }, target };
        await writeArtifactFile(options.reportFile, JSON.stringify(payload, null, 2) + "\n", options.overwrite ?? false, "report");
      } catch (writeErr: unknown) {
        console.error(writeErr instanceof Error ? writeErr.message : String(writeErr));
      }
    }
    if (options.junit) {
      try {
        const xml = generateJunitXml([{ scenarioId: target, error: { message: err.message } }]);
        await writeArtifactFile(options.junit, xml, options.overwrite ?? false, "JUnit");
      } catch (writeErr: unknown) {
        console.error(writeErr instanceof Error ? writeErr.message : String(writeErr));
      }
    }
    return 1;
  }

  const effectiveTimeout = options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;

  let execution: LedgerExecution;
  try {
    const executionResult = await runWithSignalsAndTimeout(
      effectiveTimeout,
      options,
      async (signal) => {
        const gateway = new StellarTestnetGateway(
          "https://horizon-testnet.stellar.org",
          "https://friendbot.stellar.org",
        );

        if (options.output !== "json") {
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
    execution = executionResult.result!;
  } catch (error) {
    // Execution-level error (gateway threw after the scenario loaded)
    const execErr = error instanceof Error ? error : new Error(String(error));
    if (options.output === "json") {
      const errObj: { message: string; report?: unknown } = { message: execErr.message };
      const rawReport = (error as { report?: unknown }).report;
      if (rawReport !== undefined) errObj.report = rawReport;
      console.error(JSON.stringify({ status: "error", error: errObj }, null, 2));
    } else {
      const m = markers(options.ascii ?? false);
      console.error(`\n${m.fail} Run failed: ${execErr.message}`);
    }

    // Write error artifacts when requested
    if (options.reportFile) {
      try {
        const payload = { status: "error", error: { message: execErr.message }, scenarioId: scenario.id };
        await writeArtifactFile(options.reportFile, JSON.stringify(payload, null, 2) + "\n", options.overwrite ?? false, "report");
      } catch (writeErr: unknown) {
        console.error(writeErr instanceof Error ? writeErr.message : String(writeErr));
      }
    }
    if (options.junit) {
      try {
        const xml = generateJunitXml([{ scenarioId: scenario.id, error: { message: execErr.message } }]);
        await writeArtifactFile(options.junit, xml, options.overwrite ?? false, "JUnit");
      } catch (writeErr: unknown) {
        console.error(writeErr instanceof Error ? writeErr.message : String(writeErr));
      }
    }
    return 1;
  }

  const report = buildRunReport(scenario, execution);

  if (options.reportFile) {
    try {
      await writeArtifactFile(
        options.reportFile,
        JSON.stringify(report, null, 2) + "\n",
        options.overwrite ?? false,
        "report",
      );
    } catch (err: unknown) {
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }

  if (options.junit) {
    try {
      const exec: NonNullable<JunitRun["execution"]> = {
        scenarioId: report.scenarioId,
        scenarioVersion: report.scenarioVersion,
        steps: report.steps as NonNullable<JunitRun["execution"]>["steps"],
        assertions: report.assertions as NonNullable<JunitRun["execution"]>["assertions"],
      };
      const xml = generateJunitXml([{ scenarioId: report.scenarioId, execution: exec }]);
      await writeArtifactFile(options.junit, xml, options.overwrite ?? false, "JUnit");
    } catch (err: unknown) {
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }

  if (options.output === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const m = markers(options.ascii ?? false);
    const passed = report.status === "passed";
    console.log(`\nResult: ${passed ? "PASSED" : "FAILED"}`);
    console.log(`  Steps: ${report.summary.stepsPassed}/${execution.steps.length} passed`);
    console.log(`  Assertions: ${report.summary.assertionsPassed}/${execution.assertions.length} passed`);
    if (!passed) {
      console.log(`\n${m.fail} One or more checks failed.`);
    }
  }

  return report.status === "passed" ? 0 : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// #67 — run-suite command (bundled IDs + explicit file targets)
// ─────────────────────────────────────────────────────────────────────────────

interface SuiteScenarioResult {
  scenarioId: string;
  status: "passed" | "failed" | "error" | "skipped";
  summary?: {
    stepsPassed: number;
    stepsFailed: number;
    assertionsPassed: number;
    assertionsFailed: number;
  };
  error?: { message: string };
}

function looksLikeFilePath(token: string): boolean {
  return (
    token.startsWith("./") ||
    token.startsWith("../") ||
    token.startsWith("/") ||
    token.startsWith(".\\") ||
    token.startsWith("..\\") ||
    /^[A-Za-z]:\\/.test(token) ||
    token.includes("/") ||
    token.includes("\\") ||
    /\.(json|ya?ml)$/i.test(token)
  );
}

async function runSuiteCommand(
  targets: string[],
  options: CliOptions,
  failFast: boolean,
): Promise<number> {
  // 0. Max suite size guard
  if (targets.length > MAX_SUITE_SIZE) {
    const msg = `Suite size ${targets.length} exceeds the maximum of ${MAX_SUITE_SIZE} scenarios.`;
    if (options.output === "json") {
      console.error(JSON.stringify({ error: { code: "SUITE_TOO_LARGE", message: msg } }));
    } else {
      console.error(`Error: ${msg}`);
    }
    return 1;
  }

  // 1. Classify targets
  type Target = { kind: "file"; path: string } | { kind: "id"; id: string };
  const classified: Target[] = targets.map((t) =>
    looksLikeFilePath(t) ? { kind: "file", path: t } : { kind: "id", id: t },
  );

  // 2. Duplicate check
  const seenKeys = new Set<string>();
  const duplicates: string[] = [];
  for (const t of classified) {
    const key = t.kind === "file" ? `file:${t.path}` : `id:${t.id}`;
    if (seenKeys.has(key)) duplicates.push(t.kind === "file" ? t.path : t.id);
    seenKeys.add(key);
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

  // 3. Pre-execution validation — all targets resolved before any network call
  let registry: ReturnType<typeof createScenarioRegistry>;
  try {
    registry = createScenarioRegistry();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (options.output === "json") {
      console.error(JSON.stringify({ error: { message: msg } }));
    } else {
      console.error(`Error: ${msg}`);
    }
    return 1;
  }

  const scenarios: ValidatedScenario[] = [];
  const validationErrors: Array<{ target: string; message: string }> = [];

  for (const t of classified) {
    if (t.kind === "id") {
      const found = registry.find(t.id);
      if (!found) {
        validationErrors.push({
          target: t.id,
          message: `Unknown bundled scenario ID "${t.id}". Run "esure list" to see available scenarios.`,
        });
      } else {
        scenarios.push(found);
      }
    } else {
      try {
        scenarios.push(await loadScenarioFile(t.path));
      } catch (err: unknown) {
        validationErrors.push({
          target: t.path,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  if (validationErrors.length > 0) {
    if (options.output === "json") {
      console.error(
        JSON.stringify({
          error: {
            code: "VALIDATION_FAILED",
            message: `${validationErrors.length} target(s) failed validation before execution.`,
            targets: validationErrors,
          },
        }),
      );
    } else {
      console.error(`Error: ${validationErrors.length} target(s) failed validation:`);
      for (const e of validationErrors) {
        console.error(`  - ${e.target}: ${e.message}`);
      }
    }
    return 1;
  }

  // 4. Execute sequentially
  const effectiveTimeout = options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;

  const suiteRun = await runWithSignalsAndTimeout(
    effectiveTimeout,
    options,
    async (signal) => {
      const results: SuiteScenarioResult[] = [];
      const junitRuns: JunitRun[] = [];
      let suitePassed = true;

      if (options.output !== "json") {
        console.log(`\nRun suite: ${scenarios.length} scenario(s)\n`);
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

        if (options.output !== "json") {
          console.log(`Running: ${scenario.id} — ${scenario.name}`);
        }

        let result: SuiteScenarioResult;
        try {
          const gateway = new StellarTestnetGateway(
            "https://horizon-testnet.stellar.org",
            "https://friendbot.stellar.org",
          );
          const execOptions = buildExecutionOptions(options, signal);
          const execution = await gateway.execute(scenario, execOptions);
          const report = buildRunReport(scenario, execution);
          result = { scenarioId: scenario.id, status: report.status, summary: report.summary };
          junitRuns.push({
            scenarioId: scenario.id,
            execution: {
              scenarioId: scenario.id,
              scenarioVersion: scenario.version,
              steps: report.steps as NonNullable<JunitRun["execution"]>["steps"],
              assertions: report.assertions as NonNullable<JunitRun["execution"]>["assertions"],
            },
          });
        } catch (error) {
          if (signal.aborted) throw error;
          const errMsg = error instanceof Error ? error.message : String(error);
          result = { scenarioId: scenario.id, status: "error", error: { message: errMsg } };
          junitRuns.push({ scenarioId: scenario.id, error: { message: errMsg } });
        }

        results.push(result);
        if (result.status !== "passed") suitePassed = false;

        if (options.output !== "json") {
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

      return { results, junitRuns, suitePassed };
    },
  );

  if (suiteRun.exitCode !== undefined) {
    return suiteRun.exitCode;
  }

  const { results, junitRuns, suitePassed } = suiteRun.result!;

  // 5. Append skipped records for fail-fast unexecuted scenarios
  const executedCount = results.length;
  if (failFast && !suitePassed && executedCount < scenarios.length) {
    for (const scenario of scenarios.slice(executedCount)) {
      results.push({ scenarioId: scenario.id, status: "skipped" });
      junitRuns.push({ scenarioId: scenario.id, skipped: true });
    }
  }

  // 6. Output final summary
  const passedCount = results.filter((r) => r.status === "passed").length;
  const skippedCount = results.filter((r) => r.status === "skipped").length;
  const failedCount = results.length - passedCount - skippedCount;

  if (options.output === "json") {
    console.log(JSON.stringify({
      status: suitePassed ? "passed" : "failed",
      planned: scenarios.length,
      executed: executedCount,
      total: results.length,
      passed: passedCount,
      failed: failedCount,
      skipped: skippedCount,
      scenarios: results,
    }, null, 2));
  } else {
    console.log(`Suite result: ${suitePassed ? "PASSED" : "FAILED"}`);
    console.log(`  ${passedCount}/${scenarios.length} scenarios passed`);
    if (failFast && !suitePassed && skippedCount > 0) {
      console.log(`  Stopped early (--fail-fast). ${skippedCount} scenario(s) not run.`);
    }
  }

  // 7. Artifacts
  let artifactError = false;

  if (options.reportFile) {
    try {
      const payload = {
        status: suitePassed ? "passed" : "failed",
        planned: scenarios.length,
        executed: executedCount,
        total: results.length,
        passed: passedCount,
        failed: failedCount,
        skipped: skippedCount,
        scenarios: results,
      };
      await writeArtifactFile(options.reportFile, JSON.stringify(payload, null, 2) + "\n", options.overwrite ?? false, "Report");
    } catch (err: unknown) {
      artifactError = true;
      const msg = err instanceof Error ? err.message : String(err);
      if (options.output === "json") {
        console.error(JSON.stringify({ error: { message: msg } }));
      } else {
        console.error(msg);
      }
    }
  }

  if (options.junit) {
    try {
      const xml = generateJunitXml(junitRuns);
      await writeArtifactFile(options.junit, xml, options.overwrite ?? false, "JUnit");
    } catch (err: unknown) {
      artifactError = true;
      const msg = err instanceof Error ? err.message : String(err);
      if (options.output === "json") {
        console.error(JSON.stringify({ error: { message: msg } }));
      } else {
        console.error(msg);
      }
    }
  }

  if (artifactError) return 1;
  return suitePassed ? 0 : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// doctor command
// ─────────────────────────────────────────────────────────────────────────────

async function doctorCommand(options: CliOptions): Promise<number> {
  const checks: Array<{ label: string; ok: boolean; detail?: string }> = [];

  const nodeVer = process.versions.node;
  const major = parseInt(nodeVer.split(".")[0], 10);
  checks.push({ label: "Node.js >= 20", ok: major >= 20, detail: `v${nodeVer}` });

  let distOk = false;
  try {
    const url = import.meta.url;
    if (url) {
      const thisFile = fileURLToPath(url);
      distOk = existsSync(thisFile);
    }
  } catch { distOk = false; }
  checks.push({ label: "Compiled CLI artifact (dist/cli.js)", ok: distOk });

  const backendOk = typeof createScenarioRegistry === "function";
  checks.push({ label: "@esure/backend package", ok: backendOk });

  const allOk = checks.every((c) => c.ok);

  if (options.output === "json") {
    console.log(JSON.stringify({
      ok: allOk,
      checks: checks.map((c) => ({ label: c.label, ok: c.ok, ...(c.detail ? { detail: c.detail } : {}) })),
    }, null, 2));
  } else {
    console.log("\nDoctor report:\n");
    for (const c of checks) {
      const icon = c.ok ? "✓" : "✗";
      console.log(`  ${icon} ${c.label}${c.detail ? ` (${c.detail})` : ""}`);
    }
    console.log(`\nResult: ${allOk ? "OK" : "Issues found"}`);
  }

  return allOk ? 0 : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// #158 — shell completions (bash, zsh, fish, powershell)
// ─────────────────────────────────────────────────────────────────────────────

const COMPLETION_COMMANDS = [
  "list", "validate", "init", "run", "run-suite", "completions", "doctor",
];

const COMPLETION_OPTIONS = [
  "--help", "--version", "--output", "--ascii",
  "--report-file", "--junit", "--overwrite", "--fail-fast",
];

export type SupportedShell = "bash" | "zsh" | "fish" | "powershell";
export const SUPPORTED_SHELLS: SupportedShell[] = ["bash", "zsh", "fish", "powershell"];

export function generateCompletions(shell: SupportedShell): string {
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

  if (shell === "fish") {
    const commandLines = COMPLETION_COMMANDS.map(
      (cmd) => `complete -c esure -f -n '__fish_use_subcommand' -a '${cmd}'`,
    ).join("\n");
    const optionLines = COMPLETION_OPTIONS.map(
      (opt) => `complete -c esure -f -l '${opt.replace(/^--/, "")}'`,
    ).join("\n");
    const fileSubcmds = ["run", "validate", "init"];
    const fileLines = fileSubcmds.map(
      (cmd) => `complete -c esure -F -n '__fish_seen_subcommand_from ${cmd}'`,
    ).join("\n");
    return `# Esure CLI shell completion for fish.
# Save to ~/.config/fish/completions/esure.fish  or run:
#   esure completions fish | source

${commandLines}

${optionLines}

${fileLines}
`;
  }

  if (shell === "powershell") {
    const psCommands = COMPLETION_COMMANDS.map((c) => `'${c}'`).join(", ");
    const psOptions = COMPLETION_OPTIONS.map((o) => `'${o}'`).join(", ");
    return `# Esure CLI shell completion for PowerShell.
# Add this to your $PROFILE, or run once per session:
#   esure completions powershell | Invoke-Expression
#
# Windows usage example:
#   esure completions powershell | Out-File -Encoding UTF8 "$HOME\\Documents\\PowerShell\\esure_completions.ps1"
#   . "$HOME\\Documents\\PowerShell\\esure_completions.ps1"

Register-ArgumentCompleter -Native -CommandName @('esure') -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $commands = @(${psCommands})
    $options  = @(${psOptions})

    $tokens = $commandAst.CommandElements
    $subCmd = if ($tokens.Count -gt 1) { $tokens[1].Value } else { $null }

    # Completing the sub-command position
    if ($tokens.Count -le 2 -and -not $wordToComplete.StartsWith('-')) {
        $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
        return
    }

    # File path completion for sub-commands that accept a file argument
    if ($subCmd -in @('run', 'validate', 'init') -and -not $wordToComplete.StartsWith('-')) {
        $pattern = if ($wordToComplete) { "$wordToComplete*" } else { '*' }
        Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue |
            Where-Object { $_.Extension -in @('.json', '.yaml', '.yml') -or $_.PSIsContainer } |
            ForEach-Object {
                $completion = if ($_.PSIsContainer) { "$($_.Name)\\" } else { $_.Name }
                $display = if ($completion -match ' ') { "'$completion'" } else { $completion }
                [System.Management.Automation.CompletionResult]::new($display, $_.Name, 'ParameterValue', $_.Name)
            }
        return
    }

    # Option completion
    $options | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
}
`;
  }

  // bash (default)
  return `_esure_complete() {
  local cur prev opts cmds
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  cmds="${cmdList}"
  opts="${optList}"

  if [[ \${cur} == -* ]] ; then
    COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") 2>/dev/null )
    return 0
  fi

  case "\${prev}" in
    esure)
      COMPREPLY=( $(compgen -W "\${cmds}" -- "\${cur}") 2>/dev/null )
      ;;
    run|validate|init)
      COMPREPLY=( $(compgen -f -- "\${cur}") 2>/dev/null )
      ;;
    *)
      COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") 2>/dev/null )
      ;;
  esac
}

complete -F _esure_complete esure
complete -F _esure_complete ./esure 2>/dev/null || true
`;
}

async function completionsCommand(shell: string): Promise<number> {
  const normalized = shell.toLowerCase();
  if (!SUPPORTED_SHELLS.includes(normalized as SupportedShell)) {
    console.error(`Error: Unsupported shell "${shell}". Supported shells: ${SUPPORTED_SHELLS.join(", ")}.`);
    console.error(`Usage: esure completions <${SUPPORTED_SHELLS.join("|")}>`);
    return 1;
  }
  console.log(generateCompletions(normalized as SupportedShell));
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

export async function main(): Promise<number> {
  const { command, args, options, failFast, rawOutput, unknownOption } = parseCliArgs();

  // Validate output format
  if (rawOutput !== undefined && rawOutput !== "human" && rawOutput !== "json") {
    console.error(`Error: Invalid output format "${rawOutput}". Use "human" or "json".`);
    return 1;
  }

  // Reject unknown options in JSON mode
  if (unknownOption !== undefined && options.output === "json") {
    console.error(JSON.stringify({ error: { code: "INVALID_ARGUMENT", message: `Unknown option: ${unknownOption}` } }));
    return 1;
  }

  // Validate --timeout-ms
  if (options.timeoutMs !== undefined) {
    const n = options.timeoutMs;
    if (!Number.isInteger(n) || n < MIN_CLI_TIMEOUT_MS || n > MAX_CLI_TIMEOUT_MS) {
      reportArgumentError(
        `--timeout-ms must be an integer between ${MIN_CLI_TIMEOUT_MS} and ${MAX_CLI_TIMEOUT_MS}`,
        undefined,
        options.output,
      );
      return 1;
    }
  }

  if (options.version) {
    showVersion();
    return 0;
  }

  if (options.help || !command) {
    showHelp(command);
    return 0;
  }

  if ((options.stdin || options.format !== undefined) && command !== "validate") {
    console.error("Error: --stdin and --format are only supported by validate");
    return 1;
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
        console.error("Usage: esure show <scenario-id>");
        return 1;
      }
      return showCommand(args[0], options);

    case "validate":
      if (options.stdin) {
        if (args.length > 0) {
          console.error("Error: Do not provide a file path when using --stdin");
          console.error("Usage: esure validate --stdin --format <json|yaml>");
          return 1;
        }
        const format = options.format;
        if (format !== "json" && format !== "yaml") {
          console.error("Error: --stdin requires --format json or --format yaml");
          return 1;
        }
        return validateCommand(() => loadScenarioStdin(format), options);
      }
      if (options.format !== undefined) {
        console.error("Error: --format can only be used with --stdin");
        return 1;
      }
      if (args.length === 0) {
        reportArgumentError(
          "Missing file path argument",
          "Usage: esure validate <file> or esure validate --stdin --format <json|yaml>",
          options.output,
        );
        return 1;
      }
      if (args.length > 1) {
        console.error("Error: Unexpected argument(s) for validate command");
        console.error("Usage: esure validate <file>");
        return 1;
      }
      return validateFileCommand(args[0], options);

    case "validate-directory":
      if (args.length === 0) {
        console.error("Error: Missing directory path");
        console.error("Usage: esure validate-directory <directory>");
        return 1;
      }
      return validateDirectoryCommand(args[0], options);

    case "init":
      if (args.length === 0) {
        console.error("Error: Missing file path argument");
        console.error("Usage: esure init <file>");
        return 1;
      }
      return initCommand(args[0], options);

    case "report":
      if (args[0] === "validate") {
        if (args.length < 2) {
          console.error("Error: Missing file path argument");
          console.error("Usage: esure report validate <file>");
          return 1;
        }
        return reportValidateCommand(args[1], options);
      }
      reportArgumentError(
        `Unknown report sub-command "${args[0] ?? ""}"`,
        "Usage: esure report validate <file>",
        options.output,
      );
      return 1;

    case "run": {
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
    }

    case "run-suite":
      if (args.length === 0) {
        reportArgumentError(
          "Missing scenario IDs",
          "Usage: esure run-suite <id|file> [<id|file>...]",
          options.output,
        );
        return 1;
      }
      return runSuiteCommand(args, options, failFast);

    case "completions":
      if (args.length === 0) {
        console.error("Error: Missing shell argument");
        console.error(`Usage: esure completions <${SUPPORTED_SHELLS.join("|")}>`);
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
