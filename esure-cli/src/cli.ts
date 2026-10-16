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
import { parse as parseYaml } from "yaml";
import type { ValidatedScenario } from "@esure/backend/src/domain.js";

const VERSION = "0.1.0";

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
      output: values.output === "json" ? "json" : "human",
      help: Boolean(values.help),
      version: Boolean(values.version),
      search: typeof values.search === "string" ? values.search : undefined,
      sort: typeof values.sort === "string" ? values.sort : undefined,
      stdin: Boolean(values.stdin),
      format: values.format === "json" || values.format === "yaml" ? values.format : undefined,
    },
  };
}

async function loadScenarioFile(filePath: string): Promise<ValidatedScenario> {
  const absolutePath = resolve(filePath);
  const content = await readFilePromises(absolutePath, "utf-8");

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
      console.log(JSON.stringify({ scenarios: scenarios.map(s => ({ id: s.id, version: s.version, name: s.name, description: s.description })) }, null, 2));
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
  try {
    let scenario: ValidatedScenario;

    // Determine if target is a bundled scenario ID or file path
    if (target.includes("/") || target.includes("\\") || target.includes(".")) {
      scenario = await loadScenarioFile(target);
    } else {
      const registry = createScenarioRegistry();
      const found = registry.find(target);
      if (!found) {
        throw new Error(`Bundled scenario "${target}" not found. Run "esure list" to see available scenarios.`);
      }
      scenario = found;
    }

    // Execute scenario on Stellar Testnet
    const gateway = new StellarTestnetGateway(
      "https://horizon-testnet.stellar.org",
      "https://friendbot.stellar.org"
    );

    if (options.output === "human") {
      console.log(`Running scenario: ${scenario.name}`);
      console.log(`ID: ${scenario.id} (v${scenario.version})\n`);
    }

    const execution = await gateway.execute(scenario, {
      stepTimeoutMs: 30000,
    });

    const passed = execution.steps.every(s => s.status === "passed") && execution.assertions.every(a => a.status === "passed");
    const stepsPassed = execution.steps.filter(s => s.status === "passed").length;
    const assertionsPassed = execution.assertions.filter(a => a.status === "passed").length;

    if (options.output === "json") {
      console.log(JSON.stringify({
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
      }, null, 2));
    } else {
      console.log(`Steps:`);
      for (const step of execution.steps) {
        const icon = step.status === "passed" ? "✓" : "✗";
        console.log(`  ${icon} ${step.id}: ${step.message}`);
        if (step.transactionHash) {
          console.log(`    Tx: ${step.transactionHash}`);
        }
      }

      console.log(`\nAssertions:`);
      for (const assertion of execution.assertions) {
        const icon = assertion.status === "passed" ? "✓" : "✗";
        console.log(`  ${icon} ${assertion.type}: ${assertion.message}`);
      }

      console.log(`\nResult: ${passed ? "PASSED" : "FAILED"}`);
      console.log(`  Steps: ${stepsPassed}/${execution.steps.length} passed`);
      console.log(`  Assertions: ${assertionsPassed}/${execution.assertions.length} passed`);
    }

    return passed ? 0 : 1;
  } catch (error) {
    if (options.output === "json") {
      const errorObj: { message: string; report?: unknown } = {
        message: error instanceof Error ? error.message : String(error),
      };
      if (error && typeof error === "object" && "report" in error) {
        errorObj.report = (error as { report: unknown }).report;
      }
      console.error(JSON.stringify({
        status: "error",
        error: errorObj,
      }, null, 2));
    } else {
      console.error(`\n✗ Run failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return 1;
  }
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
      if (args.length === 0) {
        console.error("Error: Missing scenario ID or file path");
        console.error("Usage: esure run <scenario-id> or esure run <file>");
        return 1;
      }
      return runCommand(args[0], options);
    default:
      console.error(`Error: Unknown command "${command}"`);
      console.error('Run "esure --help" for usage information');
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
