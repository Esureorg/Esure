#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { validateScenarioDefinition } from "@esure/backend/src/scenario-schema.js";
import { prepareScenario } from "@esure/backend/src/scenario-loader.js";
import { createScenarioRegistry } from "@esure/backend/src/scenarios.js";
import { StellarTestnetGateway } from "@esure/backend/src/stellar-gateway.js";
import { parse as parseYaml } from "yaml";
import type { ValidatedScenario } from "@esure/backend/src/domain.js";

const VERSION = "0.1.0";

interface CliOptions {
  output?: "human" | "json";
  help?: boolean;
  version?: boolean;
}

function showHelp(): void {
  console.log(`
esure - Stellar Testnet scenario testing toolkit

Usage:
  esure list                              List bundled scenarios
  esure validate <file>                   Validate a scenario file
  esure run <scenario-id>                 Run a bundled scenario
  esure run <file>                        Run a scenario from file

Options:
  --output <format>   Output format: human (default) or json
  --help              Show this help message
  --version           Show version information

Examples:
  esure list
  esure validate ./my-scenario.yaml
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
    },
  };
}

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

async function listCommand(options: CliOptions): Promise<number> {
  try {
    const registry = createScenarioRegistry();
    const scenarios = registry.list();

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
      console.error(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }));
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
    return 0;
  } catch (error) {
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

async function main(): Promise<number> {
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
    case "validate":
      if (args.length === 0) {
        console.error("Error: Missing file path argument");
        console.error("Usage: esure validate <file>");
        return 1;
      }
      return validateCommand(args[0], options);
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
