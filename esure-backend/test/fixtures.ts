import type { ScenarioDefinition } from "../src/domain.js";
import type { Report } from "../src/report-schema.js";

/**
 * Shared, sanitized, versioned report fixtures.
 *
 * These fixtures are intentionally free of any real network data (no real
 * account IDs, hashes, or signatures) so they can be reused across the
 * backend, CLI, and frontend consumers to keep report parsing in sync.
 *
 * - `minimalLegacy`: a report produced before optional timing, fee, and
 *   subject fields were added. Only required fields are present.
 * - `completeAdditive`: a report that exercises every optional additive
 *   field (timing, fee, subject) alongside the required ones.
 */
export const reportFixturesV1 = {
  schemaVersion: 1,
  minimalLegacy: {
    schemaVersion: 1,
    id: "report-minimal-legacy",
    scenarioId: "complete-scenario",
    scenarioVersion: 1,
    network: "testnet",
    status: "succeeded",
    startedAt: "2024-01-01T00:00:00.000Z",
    finishedAt: "2024-01-01T00:00:05.000Z",
    steps: [
      {
        id: "pay-xlm",
        type: "payment",
        status: "succeeded",
        transactionHash: "0".repeat(64),
      },
    ],
    assertions: [
      { type: "accountExists", account: "recipient", status: "passed" },
    ],
  } satisfies Report,
  completeAdditive: {
    schemaVersion: 1,
    id: "report-complete-additive",
    scenarioId: "complete-scenario",
    scenarioVersion: 1,
    network: "testnet",
    status: "succeeded",
    startedAt: "2024-01-01T00:00:00.000Z",
    finishedAt: "2024-01-01T00:00:05.000Z",
    durationMs: 5000,
    fee: {
      totalCharged: "0.0005000",
      totalMax: "0.0010000",
      asset: "xlm",
    },
    subject: {
      account: "recipient",
      asset: "demo",
    },
    steps: [
      {
        id: "pay-xlm",
        type: "payment",
        status: "succeeded",
        transactionHash: "0".repeat(64),
        startedAt: "2024-01-01T00:00:01.000Z",
        finishedAt: "2024-01-01T00:00:02.000Z",
        durationMs: 1000,
        feeCharged: "0.0001000",
        subject: { account: "recipient", asset: "xlm" },
      },
    ],
    assertions: [
      {
        type: "accountExists",
        account: "recipient",
        status: "passed",
        subject: { account: "recipient" },
      },
    ],
  } satisfies Report,
} as const;

export function pathPaymentSendMaxExceededScenario(): ScenarioDefinition {
  return {
    schemaVersion: 1, id: "path-payment-send-max-exceeded", version: 1,
    name: "Path payment strict receive exceeds sendMax",
    description: "Strict-receive path payment whose sendMax is below the required source amount.",
    network: "testnet",
    accounts: [
      { id: "issuer", generate: true, fund: true },
      { id: "source", generate: true, fund: true },
      { id: "recipient", generate: true, fund: true },
    ],
    assets: [
      { id: "xlm", type: "native" },
      { id: "usdc", type: "issued", code: "USDC", issuer: "issuer" },
    ],
    steps: [
      { id: "trust-source", type: "changeTrust", account: "source", asset: "usdc", limit: "1000" },
      { id: "trust-recipient", type: "changeTrust", account: "recipient", asset: "usdc", limit: "1000" },
      { id: "fund-source", type: "payment", from: "issuer", to: "source", asset: "usdc", amount: "100" },
      { id: "offer", type: "manageSellOffer", account: "source", selling: "usdc", buying: "xlm", amount: "100", price: "1" },
      {
        id: "strict-receive", type: "pathPaymentStrictReceive", from: "source", to: "recipient",
        sendAsset: "xlm", sendMax: "0.5", destinationAsset: "usdc", destinationAmount: "10",
        path: ["usdc"],
      },
    ],
    assertions: [
      { type: "stepFailedWith", step: "strict-receive", transactionCode: "tx_failed", operationCodes: ["op_too_few_offers"] },
      { type: "balanceEquals", account: "recipient", asset: "usdc", amount: "0" },
    ],
  };
}

export function completeScenario(): ScenarioDefinition {
  return {
    schemaVersion: 1, id: "complete-scenario", version: 1, name: "Complete scenario",
    description: "Exercises all declarative operations and assertions.", network: "testnet",
    accounts: [
      { id: "issuer", generate: true, fund: true },
      { id: "recipient", generate: true, fund: true },
      { id: "without-trust", generate: true, fund: true },
    ],
    assets: [
      { id: "xlm", type: "native" },
      { id: "demo", type: "issued", code: "DEMO", issuer: "issuer" },
    ],
    steps: [
      { id: "trust", type: "changeTrust", account: "recipient", asset: "demo", limit: "1000" },
      { id: "pay-xlm", type: "payment", from: "issuer", to: "recipient", asset: "xlm", amount: "1.5" },
      { id: "pay-demo", type: "payment", from: "issuer", to: "recipient", asset: "demo", amount: "7" },
      { id: "reject-demo", type: "payment", from: "issuer", to: "without-trust", asset: "demo", amount: "1" },
    ],
    assertions: [
      { type: "balanceEquals", account: "recipient", asset: "demo", amount: "7" },
      { type: "balanceChangedBy", account: "recipient", asset: "xlm", amount: "1.49999" },
      { type: "stepSucceeded", step: "pay-demo" },
      { type: "stepFailedWith", step: "reject-demo", transactionCode: "tx_failed", operationCodes: ["op_no_trust"] },
      { type: "trustlineExists", account: "recipient", asset: "demo" },
      { type: "trustlineMissing", account: "without-trust", asset: "demo" },
      { type: "trustlineLimitEquals", account: "recipient", asset: "demo", limit: "1000" },
      { type: "transactionConfirmed", step: "pay-demo" },
      { type: "accountExists", account: "recipient" },
      { type: "accountMissing", account: "without-trust" },
      { type: "feeAwareNativeBalanceDelta", account: "recipient", asset: "xlm", amount: "1.5", step: "pay-xlm" },
    ],
  };
}
