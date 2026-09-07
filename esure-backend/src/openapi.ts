import { scenarioSchemaV1 } from "./scenario-schema.js";

const runRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["scenarioId"],
  properties: { scenarioId: { type: "string" }, inputs: { type: "object", additionalProperties: false } },
} as const;

export function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: { title: "Esure API", version: "1.0.0", description: "Bounded declarative Stellar Testnet scenario execution." },
    servers: [{ url: "/" }],
    paths: {
      "/health": { get: { operationId: "getHealth", responses: { "200": { description: "Healthy" } } } },
      "/ready": { get: { operationId: "getReadiness", responses: { "200": { description: "Ready" }, "503": { description: "Database unavailable" } } } },
      "/api/v1/scenarios": { get: { operationId: "listScenarios", responses: { "200": { description: "Scenario catalogue" } } } },
      "/api/v1/scenarios/{scenarioId}": { get: { operationId: "getScenario", parameters: [{ name: "scenarioId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Scenario definition", content: { "application/json": { schema: { $ref: "#/components/schemas/ScenarioV1" } } } }, "404": { description: "Not found" } } } },
      "/api/v1/scenarios/validate": { post: { operationId: "validateScenario", requestBody: definitionBody(), responses: { "200": { description: "Validated scenario and content hash" }, "400": { description: "Invalid scenario" } } } },
      "/api/v1/scenarios/{scenarioId}/versions": { get: { operationId: "listScenarioVersions", parameters: [scenarioIdParameter, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } }, { name: "cursor", in: "query", schema: { type: "integer", minimum: 1 } }], responses: { "200": { description: "Bounded immutable version history" }, "503": { description: "Persistence not enabled or unavailable" } } } },
      "/api/v1/scenarios/{scenarioId}/versions/{version}": { get: { operationId: "getScenarioVersion", parameters: [scenarioIdParameter, versionParameter], responses: { "200": { description: "Exact immutable scenario version", content: { "application/json": { schema: { $ref: "#/components/schemas/ScenarioV1" } } } }, "404": { description: "Not found" } } } },
      "/api/v1/scenarios/{scenarioId}/versions/{version}/export": { get: { operationId: "exportScenarioVersion", parameters: [scenarioIdParameter, versionParameter, { name: "format", in: "query", schema: { type: "string", enum: ["json", "yaml"], default: "json" } }], responses: { "200": { description: "Canonical version export", content: { "application/json": { schema: { $ref: "#/components/schemas/ScenarioV1" } }, "application/yaml": { schema: { type: "string" } } } }, "404": { description: "Not found" } } } },
      "/api/v1/runs": { post: { operationId: "startCataloguedRun", requestBody: { required: true, content: { "application/json": { schema: runRequestSchema } } }, responses: { "202": { description: "Run accepted" } } } },
      "/api/v1/runs/definitions": { post: { operationId: "startDefinitionRun", requestBody: definitionBody(), responses: { "202": { description: "Declarative run accepted" }, "400": { description: "Invalid scenario" } } } },
      "/api/v1/runs/{runId}": { get: { operationId: "getRun", parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Run report" }, "404": { description: "Not found" } } } },
      "/api/v1/runs/{runId}/report": { get: { operationId: "downloadRunReport", parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Final JSON report" }, "409": { description: "Run incomplete" } } } },
    },
    components: { schemas: { ScenarioV1: scenarioSchemaV1, CataloguedRunRequest: runRequestSchema } },
  } as const;
}

const scenarioIdParameter = { name: "scenarioId", in: "path", required: true, schema: { type: "string", pattern: "^[a-z0-9-]+$" } } as const;
const versionParameter = { name: "version", in: "path", required: true, schema: { type: "integer", minimum: 1 } } as const;

function definitionBody() {
  return {
    required: true,
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/ScenarioV1" } },
      "application/yaml": { schema: { type: "string" } },
      "text/yaml": { schema: { type: "string" } },
    },
  } as const;
}
