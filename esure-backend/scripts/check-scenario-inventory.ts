/**
 * Compares the validated bundled scenarios with the documented inventory.
 *
 *   npm run check:scenarios
 *   npm run check:scenarios -- --inventory <path-to-markdown>
 *
 * Exits 1 with one finding per line when IDs or counts drift. Output is sorted,
 * so repeated runs over the same files print identical bytes.
 */
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createScenarioRegistry } from "../src/scenarios.js";
import { checkScenarioInventory, type InventoryDocument } from "./scenario-inventory.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..");
const defaultInventory = resolve(repositoryRoot, "esure-docs", "SCENARIOS.md");
const defaultReadme = resolve(repositoryRoot, "README.md");

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a path`);
  return resolve(process.cwd(), value);
}

function display(path: string): string {
  return relative(repositoryRoot, path).split("\\").join("/") || path;
}

async function readDocument(path: string): Promise<InventoryDocument> {
  return { path: display(path), markdown: await readFile(path, "utf8") };
}

try {
  const inventoryPath = optionValue("--inventory") ?? defaultInventory;
  // Loading the registry validates every bundled definition; an invalid file throws here.
  const registry = createScenarioRegistry();
  const result = checkScenarioInventory({
    actualIds: registry.list().map((scenario) => scenario.id),
    inventory: await readDocument(inventoryPath),
    countDocuments: [await readDocument(defaultReadme)],
  });

  if (result.findings.length > 0) {
    for (const finding of result.findings) console.error(`inventory drift: ${finding}`);
    console.error(`Scenario inventory check failed with ${result.findings.length} finding(s).`);
    process.exit(1);
  }

  for (const id of result.ids) console.log(id);
  console.log(`Scenario inventory OK: ${result.count} bundled scenarios match ${display(inventoryPath)} and README.md.`);
} catch (error) {
  console.error(`Scenario inventory check could not run: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
