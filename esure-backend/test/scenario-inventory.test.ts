import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { checkScenarioInventory, declaredScenarioCounts, documentedScenarioIds } from "../scripts/scenario-inventory.js";
import { createScenarioRegistry } from "../src/scenarios.js";

const inventory = (rows: string[], count = rows.length, extra = "") => [
  "# Schema",
  "",
  "## Bundled Scenarios",
  "",
  `ESURE includes ${count} bundled scenarios for Testnet integration testing:`,
  "",
  "| Scenario ID | Purpose | Expected Result |",
  "| --- | --- | --- |",
  ...rows.map((id) => `| \`${id}\` | Purpose text | Pass |`),
  "",
  extra,
  "## Loading and running",
  "",
  "Bundled definitions also mention `not-a-row` in prose and should be ignored.",
].join("\n");

const readme = (count: number) => `- **${count} Bundled Scenarios**: summary\n\nEsure includes ${count} bundled scenarios.\n`;

describe("scenario inventory comparison", () => {
  it("passes when IDs and every stated count match the validated scenarios", () => {
    const result = checkScenarioInventory({
      actualIds: ["xlm-payment", "account-missing"],
      inventory: { path: "SCENARIOS.md", markdown: inventory(["account-missing", "xlm-payment"]) },
      countDocuments: [{ path: "README.md", markdown: readme(2) }],
    });
    expect(result.findings).toEqual([]);
    expect(result.count).toBe(2);
    expect(result.ids).toEqual(["account-missing", "xlm-payment"]);
  });

  it("reports a missing row, an unknown row, a duplicate row, and a stale count", () => {
    const result = checkScenarioInventory({
      actualIds: ["alpha", "beta", "gamma"],
      inventory: { path: "SCENARIOS.md", markdown: inventory(["alpha", "alpha", "removed-id"], 2) },
      countDocuments: [{ path: "README.md", markdown: readme(13) }],
    });
    expect(result.findings).toEqual([
      "SCENARIOS.md: alpha is listed more than once",
      "SCENARIOS.md: beta is missing from the table",
      "SCENARIOS.md: gamma is missing from the table",
      "SCENARIOS.md: removed-id is listed but has no bundled definition",
      "SCENARIOS.md: states 2 bundled scenarios, found 3",
      "README.md: states 13 bundled scenarios, found 3",
      "README.md: states 13 bundled scenarios, found 3",
    ]);
  });

  it("fails when the inventory document has no Bundled Scenarios section", () => {
    const result = checkScenarioInventory({
      actualIds: ["alpha"],
      inventory: { path: "SCENARIOS.md", markdown: "# Schema\n\nNo table here.\n" },
      countDocuments: [],
    });
    expect(result.findings).toEqual([
      'SCENARIOS.md: no "Bundled Scenarios" section',
      'SCENARIOS.md: no "N bundled scenarios" count',
    ]);
  });

  it("parses only first-column scenario IDs inside the bundled section", () => {
    const markdown = inventory(["one", "two"]);
    expect(documentedScenarioIds(markdown)).toEqual(["one", "two"]);
    expect(declaredScenarioCounts(markdown)).toEqual([2]);
  });

  it("keeps the documented inventory and README count in step with bundled definitions", async () => {
    const registry = createScenarioRegistry();
    const actualIds = registry.list().map((scenario) => scenario.id);
    const result = checkScenarioInventory({
      actualIds,
      inventory: { path: "esure-docs/SCENARIOS.md", markdown: await readFile("../esure-docs/SCENARIOS.md", "utf8") },
      countDocuments: [{ path: "README.md", markdown: await readFile("../README.md", "utf8") }],
    });
    expect(result.findings).toEqual([]);
    expect(result.count).toBeGreaterThan(0);
  });
});
