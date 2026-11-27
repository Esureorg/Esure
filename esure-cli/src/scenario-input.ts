import { TextDecoder } from "node:util";
import { parse as parseYaml } from "yaml";
import { SCENARIO_LIMITS, validateScenarioDefinition } from "@esure/backend/src/scenario-schema.js";
import { prepareScenario } from "@esure/backend/src/scenario-loader.js";
import type { ValidatedScenario } from "@esure/backend/src/domain.js";

export type ScenarioInputFormat = "json" | "yaml";

export function parseScenarioContent(content: string, format: ScenarioInputFormat): ValidatedScenario {
  if (Buffer.byteLength(content, "utf8") > SCENARIO_LIMITS.definitionBytes) {
    throw new Error(`Scenario definition must not exceed ${SCENARIO_LIMITS.definitionBytes} bytes`);
  }
  const parsed: unknown = format === "json" ? JSON.parse(content) : parseYaml(content);
  return prepareScenario(validateScenarioDefinition(parsed));
}

export async function loadScenarioStdin(
  format: ScenarioInputFormat,
  input: AsyncIterable<Uint8Array | string> = process.stdin,
): Promise<ValidatedScenario> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of input) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
    totalBytes += bytes.byteLength;
    if (totalBytes > SCENARIO_LIMITS.definitionBytes) {
      throw new Error(`Scenario definition must not exceed ${SCENARIO_LIMITS.definitionBytes} bytes`);
    }
    chunks.push(bytes);
  }

  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new Error("Standard input must contain valid UTF-8");
  }
  return parseScenarioContent(content, format);
}
