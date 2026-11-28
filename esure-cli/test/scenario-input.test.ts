import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { SCENARIO_LIMITS } from "@esure/backend/src/scenario-schema.js";
import { loadScenarioStdin, parseScenarioContent } from "../src/scenario-input.js";

const scenario = {
  schemaVersion: 1,
  id: "stdin-scenario",
  version: 1,
  name: "Standard input scenario",
  description: "Validates scenario data from stdin",
  network: "testnet",
  accounts: [{ id: "alice", generate: true, fund: true }],
  assets: [{ id: "xlm", type: "native" }],
  steps: [],
  assertions: [{ type: "accountExists", account: "alice" }],
};

describe("scenario input", () => {
  it("parses bounded JSON and YAML content", () => {
    expect(parseScenarioContent(JSON.stringify(scenario), "json").id).toBe("stdin-scenario");
    const yaml = [
      "schemaVersion: 1",
      "id: stdin-scenario",
      "version: 1",
      "name: Standard input scenario",
      "description: Validates scenario data from stdin",
      "network: testnet",
      "accounts:",
      "  - id: alice",
      "    generate: true",
      "    fund: true",
      "assets:",
      "  - id: xlm",
      "    type: native",
      "steps: []",
      "assertions:",
      "  - type: accountExists",
      "    account: alice",
    ].join("\n");
    expect(parseScenarioContent(yaml, "yaml").id).toBe("stdin-scenario");
  });

  it("reads UTF-8 input from an asynchronous stream", async () => {
    const input = Readable.from([Buffer.from(JSON.stringify(scenario), "utf8")]);
    await expect(loadScenarioStdin("json", input)).resolves.toMatchObject({ id: "stdin-scenario" });
  });

  it("rejects invalid UTF-8 input", async () => {
    const input = Readable.from([Buffer.from([0xc3, 0x28])]);
    await expect(loadScenarioStdin("json", input)).rejects.toThrow("valid UTF-8");
  });

  it("rejects input larger than the scenario definition byte limit", async () => {
    const input = Readable.from([Buffer.alloc(SCENARIO_LIMITS.definitionBytes + 1, 0x20)]);
    await expect(loadScenarioStdin("json", input)).rejects.toThrow("must not exceed 16384 bytes");
  });
});
