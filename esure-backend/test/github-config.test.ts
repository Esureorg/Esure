import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

interface WorkflowDocument {
  concurrency?: { group?: string; "cancel-in-progress"?: string };
}

interface DependabotDocument {
  version: number;
  updates: { "package-ecosystem": string; directory: string; schedule?: { interval?: string }; "open-pull-requests-limit"?: number; groups?: Record<string, { "update-types"?: string[] }> }[];
}

describe("Monorepo CI concurrency", () => {
  it("groups runs per workflow and ref and cancels only superseded pull request runs", async () => {
    const workflow = parse(await readFile("../.github/workflows/ci.yml", "utf8")) as WorkflowDocument;
    expect(workflow.concurrency?.group).toBe("${{ github.workflow }}-${{ github.ref }}");
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe("${{ github.event_name == 'pull_request' }}");
  });
});

describe("Dependabot configuration", () => {
  it("covers all three npm packages and GitHub Actions with bounded, grouped minor and patch updates", async () => {
    const config = parse(await readFile("../.github/dependabot.yml", "utf8")) as DependabotDocument;
    expect(config.version).toBe(2);
    const entries = config.updates.map((update) => `${update["package-ecosystem"]}:${update.directory}`).sort();
    expect(entries).toEqual([
      "github-actions:/",
      "npm:/esure-backend",
      "npm:/esure-cli",
      "npm:/esure-frontend",
    ]);
    for (const update of config.updates) {
      expect(update.schedule?.interval).toBe("weekly");
      expect(update["open-pull-requests-limit"]).toBeGreaterThan(0);
      expect(update["open-pull-requests-limit"]).toBeLessThanOrEqual(5);
      const groups = Object.values(update.groups ?? {});
      expect(groups).toHaveLength(1);
      expect(groups[0]?.["update-types"]).toEqual(["minor", "patch"]);
    }
  });
});
