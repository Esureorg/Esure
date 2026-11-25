import type { ScenarioDefinition } from "../src/domain.js";

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
