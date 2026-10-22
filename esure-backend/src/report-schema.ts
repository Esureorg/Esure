import { Ajv } from "ajv";
import type { RunReport } from "./domain.js";

const jsonValue = {
  anyOf: [
    { type: "string" },
    { type: "number" },
    { type: "boolean" },
    { type: "null" },
    { type: "array", maxItems: 1000, items: { $ref: "#/$defs/jsonValue" } },
    { type: "object", maxProperties: 1000, additionalProperties: { $ref: "#/$defs/jsonValue" } },
  ],
} as const;

export const runReportSchemaV1 = {
  $id: "https://esure.dev/schemas/run-report-v1.json",
  type: "object",
  additionalProperties: false,
  required: [
    "id", "scenarioId", "scenarioVersion", "scenarioSchemaVersion", "scenarioContentHash",
    "network", "status", "createdAt", "steps", "assertions", "summary",
  ],
  properties: {
    id: { type: "string", minLength: 1 },
    scenarioId: { type: "string", minLength: 1, maxLength: 64 },
    scenarioVersion: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
    scenarioSchemaVersion: { const: 1 },
    scenarioContentHash: { type: "string", minLength: 1 },
    network: { const: "testnet" },
    status: { enum: ["requested", "validating", "running", "passed", "failed"] },
    createdAt: { type: "string", minLength: 1 },
    completedAt: { type: "string", minLength: 1 },
    expiresAt: { type: "string", minLength: 1 },
    steps: {
      type: "array",
      maxItems: 1000,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "status", "message"],
        properties: {
          id: { type: "string", minLength: 1 },
          type: { type: "string", minLength: 1 },
          status: { enum: ["passed", "failed"] },
          transactionHash: { type: "string" },
          ledger: { type: "integer", minimum: 1 },
          feeCharged: { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
          stellarTransactionCode: { type: "string" },
          stellarOperationCodes: { type: "array", maxItems: 100, items: { type: "string" } },
          message: { type: "string" },
          startedAt: { type: "string", minLength: 1 },
          completedAt: { type: "string", minLength: 1 },
          durationMs: { type: "number", minimum: 0 },
        },
      },
    },
    assertions: {
      type: "array",
      maxItems: 1000,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "status", "expected", "actual", "message"],
        properties: {
          type: {
            enum: [
              "transactionMemoEquals", "balanceEquals", "balanceChangedBy", "stepSucceeded",
              "transactionConfirmed", "stepFailedWith", "trustlineExists", "trustlineMissing",
              "trustlineLimitEquals", "accountExists", "accountMissing", "feeAwareNativeBalanceDelta",
            ],
          },
          status: { enum: ["passed", "failed"] },
          expected: jsonValue,
          actual: jsonValue,
          message: { type: "string" },
        },
      },
    },
    summary: {
      type: "object",
      additionalProperties: false,
      required: ["stepsPassed", "stepsFailed", "assertionsPassed", "assertionsFailed"],
      properties: {
        stepsPassed: { type: "integer", minimum: 0 },
        stepsFailed: { type: "integer", minimum: 0 },
        assertionsPassed: { type: "integer", minimum: 0 },
        assertionsFailed: { type: "integer", minimum: 0 },
      },
    },
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message", "category", "retryable"],
      properties: {
        code: { type: "string", minLength: 1 },
        message: { type: "string" },
        category: { enum: ["stellar", "network", "timeout", "capacity", "validation", "internal"] },
        retryable: { type: "boolean" },
        failedStepId: { type: "string" },
        stellarTransactionCode: { type: "string" },
        stellarOperationCodes: { type: "array", maxItems: 100, items: { type: "string" } },
      },
    },
  },
  $defs: { jsonValue },
} as const;

const ajv = new Ajv({ allErrors: true, strict: true });
const validateSchema = ajv.compile<RunReport>(runReportSchemaV1);

export class RunReportValidationError extends Error {
  constructor(readonly issues: string[]) {
    super("Run report is invalid.");
    this.name = "RunReportValidationError";
  }
}

export function validateRunReport(value: unknown): RunReport {
  if (!validateSchema(value)) {
    throw new RunReportValidationError(
      (validateSchema.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`),
    );
  }

  const report = value;
  const timestampIssues: string[] = [];
  for (const [field, timestamp] of [
    ["createdAt", report.createdAt],
    ["completedAt", report.completedAt],
    ["expiresAt", report.expiresAt],
  ] as const) {
    if (timestamp !== undefined && !isIsoDateTime(timestamp)) timestampIssues.push(`/${field} must be a valid ISO date-time`);
  }
  for (const [index, step] of report.steps.entries()) {
    for (const field of ["startedAt", "completedAt"] as const) {
      const timestamp = step[field];
      if (timestamp !== undefined && !isIsoDateTime(timestamp)) timestampIssues.push(`/steps/${index}/${field} must be a valid ISO date-time`);
    }
  }
  if (timestampIssues.length) throw new RunReportValidationError(timestampIssues);
  return report;
}

function isIsoDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}
