export interface ScenarioSummary {
  id: string;
  version: number;
  name: string;
  description: string;
  contentHash: string;
}

export type RunStatus = "requested" | "validating" | "running" | "passed" | "failed";

export interface StepResult {
  id: string;
  type: string;
  status: "passed" | "failed";
  transactionHash?: string;
  ledger?: number;
  stellarTransactionCode?: string;
  stellarOperationCodes?: string[];
  message: string;
}

export interface AssertionResult {
  type: string;
  status: "passed" | "failed";
  expected: JsonValue;
  actual: JsonValue;
  message: string;
}

export interface RunReport {
  id: string;
  scenarioId: string;
  scenarioVersion: number;
  scenarioSchemaVersion: 1;
  scenarioContentHash: string;
  network: "testnet";
  status: RunStatus;
  createdAt: string;
  completedAt?: string;
  steps: StepResult[];
  assertions: AssertionResult[];
  summary: {
    stepsPassed: number;
    stepsFailed: number;
    assertionsPassed: number;
    assertionsFailed: number;
  };
  error?: {
    code: string;
    message: string;
    category: "stellar" | "network" | "timeout" | "capacity" | "validation" | "internal";
    retryable: boolean;
    failedStepId?: string;
    stellarTransactionCode?: string;
    stellarOperationCodes?: string[];
  };
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function listScenarios(signal?: AbortSignal): Promise<ScenarioSummary[]> {
  const data = await request<{ items: ScenarioSummary[] }>("/api/backend/api/v1/scenarios", { signal });
  return data.items;
}

export function startRun(scenarioId: string): Promise<RunReport> {
  return request<RunReport>("/api/backend/api/v1/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenarioId, inputs: {} }),
  });
}

export function getRun(runId: string, signal?: AbortSignal): Promise<RunReport> {
  return request<RunReport>(`/api/backend/api/v1/runs/${encodeURIComponent(runId)}`, { signal });
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { accept: "application/json", ...init?.headers } });
  const data = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!response.ok) {
    throw new ApiError(data.error?.message ?? "The request failed.", data.error?.code ?? "UNKNOWN_ERROR", response.status);
  }
  return data;
}
