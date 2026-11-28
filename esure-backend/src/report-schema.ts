import { Ajv } from "ajv";
import type { RunReport } from "./domain.js";
import { describe, expect, it } from "vitest";

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

// Shared sanitized versioned report fixtures. These are consumed by the backend,
// CLI, and frontend test suites so all three surfaces agree on the report shape.
export const reportFixturesV1 = {
  // Minimal legacy report: only required fields, no optional timing/fee/subject data.
  minimalLegacy: {
    id: "run-minimal-1",
    scenarioId: "scenario-minimal",
    scenarioVersion: 1,
    scenarioSchemaVersion: 1,
    scenarioContentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    network: "testnet",
    status: "passed",
    createdAt: "2024-01-01T00:00:00.000Z",
    steps: [
      {
        id: "step-1",
        type: "payment",
        status: "passed",
        message: "Payment submitted.",
      },
    ],
    assertions: [
      {
        type: "stepSucceeded",
        status: "passed",
        expected: true,
        actual: true,
        message: "Step succeeded.",
      },
    ],
    summary: {
      stepsPassed: 1,
      stepsFailed: 0,
      assertionsPassed: 1,
      assertionsFailed: 0,
    },
  },
  // Complete report: every additive optional field populated.
  completeAdditive: {
    id: "run-complete-1",
    scenarioId: "scenario-complete",
    scenarioVersion: 2,
    scenarioSchemaVersion: 1,
    scenarioContentHash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    network: "testnet",
    status: "failed",
    createdAt: "2024-02-01T10:00:00.000Z",
    completedAt: "2024-02-01T10:00:05.500Z",
    expiresAt: "2024-02-01T11:00:00.000Z",
    steps: [
      {
        id: "step-1",
        type: "payment",
        status: "passed",
        transactionHash: "a".repeat(64),
        ledger: 12345,
        feeCharged: "100",
        stellarTransactionCode: "tx_success",
        stellarOperationCodes: ["op_success"],
        message: "Payment submitted.",
        startedAt: "2024-02-01T10:00:00.000Z",
        completedAt: "2024-02-01T10:00:02.000Z",
        durationMs: 2000,
      },
      {
        id: "step-2",
        type: "trustline",
        status: "failed",
        message: "Trustline missing.",
        startedAt: "2024-02-01T10:00:02.000Z",
        completedAt: "2024-02-01T10:00:05.500Z",
        durationMs: 3500,
      },
    ],
    assertions: [
      {
        type: "feeAwareNativeBalanceDelta",
        status: "passed",
        expected: { delta: "-100" },
        actual: { delta: "-100" },
        message: "Fee-aware delta matched.",
      },
      {
        type: "trustlineExists",
        status: "failed",
        expected: true,
        actual: false,
        message: "Trustline was not found.",
      },
    ],
    summary: {
      stepsPassed: 1,
      stepsFailed: 1,
      assertionsPassed: 1,
      assertionsFailed: 1,
    },
    error: {
      code: "trustline_missing",
      message: "Expected trustline was not found.",
      category: "validation",
      retryable: false,
      failedStepId: "step-2",
      stellarTransactionCode: "tx_failed",
      stellarOperationCodes: ["op_no_trust"],
    },
  },
} as const;

describe("shared report fixtures v1", () => {
  it("accepts the minimal legacy report", () => {
    const report = validateRunReport(reportFixturesV1.minimalLegacy);
    expect(report.id).toBe("run-minimal-1");
    expect(report.completedAt).toBeUndefined();
    expect(report.expiresAt).toBeUndefined();
    expect(report.error).toBeUndefined();
    expect(report.steps[0]?.startedAt).toBeUndefined();
    expect(report.steps[0]?.feeCharged).toBeUndefined();
  });

  it("accepts the complete additive-field report", () => {
    const report = validateRunReport(reportFixturesV1.completeAdditive);
    expect(report.completedAt).toBe("2024-02-01T10:00:05.500Z");
    expect(report.expiresAt).toBe("2024-02-01T11:00:00.000Z");
    expect(report.steps[0]?.feeCharged).toBe("100");
    expect(report.steps[0]?.durationMs).toBe(2000);
    expect(report.steps[0]?.stellarOperationCodes).toEqual(["op_success"]);
    expect(report.error?.failedStepId).toBe("step-2");
  });

  it("rejects a report with an invalid optional timestamp", () => {
    const invalid = {
      ...reportFixturesV1.completeAdditive,
      steps: [
        { ...reportFixturesV1.completeAdditive.steps[0], startedAt: "not-a-date" },
        reportFixturesV1.completeAdditive.steps[1],
      ],
    };
    expect(() => validateRunReport(invalid)).toThrow(RunReportValidationError);
  });

  it("rejects a report with a non-canonical fee", () => {
    const invalid = {
      ...reportFixturesV1.completeAdditive,
      steps: [
        { ...reportFixturesV1.completeAdditive.steps[0], feeCharged: "0100" },
        reportFixturesV1.completeAdditive.steps[1],
      ],
    };
    expect(() => validateRunReport(invalid)).toThrow(RunReportValidationError);
  });
});
