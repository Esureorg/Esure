#!/usr/bin/env node

import { readFile as readFilePromises, writeFile as writeFilePromises } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createScenarioRegistry } from "@esure/backend/src/scenarios.js";
import { StellarTestnetGateway } from "@esure/backend/src/stellar-gateway.js";
import type { ValidatedScenario } from "@esure/backend/src/domain.js";
import { loadScenarioStdin, parseScenarioContent, type ScenarioInputFormat } from "./scenario-input.js";

const supportedExtensions = new Set([".json", ".yaml", ".yml"]);
const maxFilesPerDirectory = 100;

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
  file?: string;
  ascii?: boolean;
  timeoutMs?: number;
  failFast?: boolean;
  targetFormat?: "json" | "yaml";
  outputFile?: string;
  overwrite?: boolean;
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
  esure validate --stdin --format <format> Validate a scenario from standard input
  esure run <scenario-id>                 Run a bundled scenario
  esure run <file>                        Run a scenario from file

Options:
  --output <format>   Output format: human (default) or json
  --stdin             Read a scenario from standard input (validate only)
  --format <format>   Standard input format: json or yaml
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
  esure validate --stdin --format yaml
  esure run xlm-payment
  esure run ./my-scenario.yaml --output json
  esure run --file ./my-scenario.json --timeout-ms 30000`,
  "run-suite": `Usage: esure run-suite <scenario-id> [<scenario-id>...]

Run bundled scenarios sequentially on Stellar Testnet.

Options:
  --fail-fast         Stop after the first failed scenario
  --timeout-ms <ms>   Overall timeout (1–600000; default 120000)
  --ascii             Use ASCII progress markers
  --output <format>   Output format: human (default) or json

Example:
  esure run-suite xlm-payment path-payment --fail-fast`,
  completions: `Usage: esure completions <bash|zsh>

Print shell completions for bash or zsh.

Example:
  esure completions bash`,
  doctor: `Usage: esure doctor

Check local CLI prerequisites and Testnet service availability.

Options:
  --output <format>  Output format: human (default) or json

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

function parseCliArgs(): { command?: string; args: string[]; options: CliOptions } {
  const { values, positionals } = parseArgs({
    options: {
      output: { type: "string" },
      stdin: { type: "boolean" },
      format: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      search: { type: "string" },
      sort: { type: "string" },
      stdin: { type: "boolean" },
      format: { type: "string" },
      file: { type: "string" },
      ascii: { type: "boolean" },
      "timeout-ms": { type: "string" },
      "fail-fast": { type: "boolean" },
      to: { type: "string" },
      "output-file": { type: "string" },
      overwrite: { type: "boolean" },
    },
    allowPositionals: true,
    strict: false,
  });

  return {
    command: positionals[0],
    args: positionals.slice(1),
    options: {
      output: values.output === "json" ? "json" : "human",
      stdin: Boolean(values.stdin),
      format: typeof values.format === "string" ? values.format : undefined,
      help: Boolean(values.help),
      version: Boolean(values.version),
      search: typeof values.search === "string" ? values.search : undefined,
      sort: typeof values.sort === "string" ? values.sort : undefined,
      stdin: Boolean(values.stdin),
      format: values.format === "json" || values.format === "yaml" ? values.format : undefined,
      file: typeof values.file === "string" ? values.file : undefined,
      ascii: Boolean(values.ascii),
      timeoutMs: typeof values["timeout-ms"] === "string" ? Number(values["timeout-ms"]) : undefined,
      failFast: Boolean(values["fail-fast"]),
      targetFormat: values.to === "json" || values.to === "yaml" ? values.to : undefined,
      outputFile: typeof values["output-file"] === "string" ? values["output-file"] : undefined,
      overwrite: Boolean(values.overwrite),
    },
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
  if (statSync(absolutePath).size > SCENARIO_LIMITS.definitionBytes) {
    throw new ScenarioValidationError([
      `definition exceeds ${SCENARIO_LIMITS.definitionBytes} bytes`,
    ]);
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
    console.log(`✓ Scenario is valid`);
    console.log(`  ID: ${scenario.id}`);
    console.log(`  Version: ${scenario.version}`);
    console.log(`  Name: ${scenario.name}`);
    console.log(`  Schema: v${scenario.schemaVersion}`);
    console.log(`  Hash: ${scenario.contentHash}`);
  }
  return parseScenarioContent(content, format);
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
  "format",
  "plan",
  "report",
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
  "--to",
  "--output-file",
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
        console.error('Usage: esure show <scenario-id>');
        return 1;
      }
      return showCommand(args[0], options);
    case "plan":
      if (args.length !== 1) {
        console.error("Error: Expected one bundled scenario ID or file path");
        console.error("Usage: esure plan <scenario-id|file>");
        return 1;
      }
      return planCommand(args[0], options);
    case "format":
      if (args.length !== 1) {
        console.error("Error: Expected one input scenario file");
        console.error("Usage: esure format <input-file> --to <json|yaml> [--output-file <path>] [--overwrite]");
        return 1;
      }
      return formatCommand(args[0], options);
    case "report":
      if (args[0] !== "compare" || args.length !== 3) {
        console.error("Usage: esure report compare <left.json> <right.json> [--output <human|json>]");
        return 1;
      }
      return compareReportsCommand(args[1], args[2], options);
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
        console.error("Error: Missing file path argument");
        console.error("Usage: esure validate <file> or esure validate --stdin --format <json|yaml>");
        return 1;
      }
      if (args.length > 1) {
        console.error("Error: Provide only one scenario file");
        return 1;
      }
      return validateCommand(() => loadScenarioFile(args[0]), options);
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
      return runSuiteCommand(args, options, options.failFast ?? false);
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
