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

export interface GoldenScenarioCase {
  name: string;
  description: string;
  scenario: ScenarioDefinition;
  expectedHash: string;
}

/**
 * Small reviewed scenario definitions with their expected canonical hashes.
 *
 * The hashes are the persistence integrity boundary for stored scenarios, so
 * they are pinned here and re-verified on every CI runtime. Each case isolates
 * one property of canonicalization:
 * - `unicode-description`: non-ASCII text must hash by its UTF-8 content.
 * - `reordered-keys`: object key order must not affect the hash.
 * - `decimal-strings`: amounts stay strings, so "1.50" and "1.5" differ.
 *
 * To regenerate after an intentional canonicalization change, run the golden
 * corpus test with `UPDATE_GOLDEN_HASHES=1` and review the diff.
 */
export function goldenScenarioCases(): GoldenScenarioCase[] {
  return [
    {
      name: "unicode-description",
      description: "Unicode descriptions hash by their UTF-8 content.",
      scenario: {
        schemaVersion: 1,
        id: "golden-unicode",
        version: 1,
        name: "Unicode scenario",
        description: "Transfert de démonstration — 日本語の説明 — emoji 🚀",
        network: "testnet",
        accounts: [{ id: "issuer", generate: true, fund: true }],
        assets: [{ id: "xlm", type: "native" }],
        steps: [
          { id: "pay", type: "payment", from: "issuer", to: "issuer", asset: "xlm", amount: "1" },
        ],
        assertions: [{ type: "accountExists", account: "issuer" }],
      },
      expectedHash: "GOLDEN_UNICODE_DESCRIPTION_HASH",
    },
    {
      name: "reordered-keys",
      description: "Reordering object keys must not change the canonical hash.",
      scenario: {
        schemaVersion: 1,
        id: "golden-reordered",
        version: 1,
        name: "Reordered keys scenario",
        description: "Same content, different key order.",
        network: "testnet",
        accounts: [{ id: "issuer", generate: true, fund: true }],
        assets: [{ id: "xlm", type: "native" }],
        steps: [
          { id: "pay", type: "payment", from: "issuer", to: "issuer", asset: "xlm", amount: "1" },
        ],
        assertions: [{ type: "accountExists", account: "issuer" }],
      },
      expectedHash: "GOLDEN_REORDERED_KEYS_HASH",
    },
    {
      name: "decimal-strings",
      description: "Decimal amounts are hashed as strings, preserving trailing zeros.",
      scenario: {
        schemaVersion: 1,
        id: "golden-decimals",
        version: 1,
        name: "Decimal strings scenario",
        description: "Amounts are decimal strings, not numbers.",
        network: "testnet",
        accounts: [{ id: "issuer", generate: true, fund: true }],
        assets: [{ id: "xlm", type: "native" }],
        steps: [
          { id: "pay", type: "payment", from: "issuer", to: "issuer", asset: "xlm", amount: "1.50" },
        ],
        assertions: [{ type: "accountExists", account: "issuer" }],
      },
      expectedHash: "GOLDEN_DECIMAL_STRINGS_HASH",
    },
  ];
}
