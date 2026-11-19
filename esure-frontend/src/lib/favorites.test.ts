import { describe, expect, it } from "vitest";
import { MAX_FAVORITES, isScenarioId, parseFavorites } from "./favorites";

describe("parseFavorites", () => {
  it("returns an empty set for missing or empty storage", () => {
    expect(parseFavorites(null).size).toBe(0);
    expect(parseFavorites("").size).toBe(0);
  });

  it("returns an empty set for malformed JSON", () => {
    expect(parseFavorites("{not json").size).toBe(0);
  });

  it("rejects valid JSON that is not an array", () => {
    // A JSON string would otherwise be split into a set of its characters.
    expect(parseFavorites(JSON.stringify("xlm-payment")).size).toBe(0);
    expect(parseFavorites(JSON.stringify({ "xlm-payment": true })).size).toBe(0);
    expect(parseFavorites("null").size).toBe(0);
    expect(parseFavorites("42").size).toBe(0);
  });

  it("keeps only valid scenario IDs from a mixed array", () => {
    const raw = JSON.stringify(["xlm-payment", 1, null, { id: "x" }, ["nested"], "", "Bad ID", "a".repeat(65), "missing-trustline"]);
    expect([...parseFavorites(raw)]).toEqual(["xlm-payment", "missing-trustline"]);
  });

  it("deduplicates entries", () => {
    expect([...parseFavorites(JSON.stringify(["xlm-payment", "xlm-payment"]))]).toEqual(["xlm-payment"]);
  });

  it("caps the number of favorites", () => {
    const ids = Array.from({ length: MAX_FAVORITES + 50 }, (_, i) => `scenario-${i}`);
    expect(parseFavorites(JSON.stringify(ids)).size).toBe(MAX_FAVORITES);
  });
});

describe("isScenarioId", () => {
  it("matches the backend scenarioId rule", () => {
    expect(isScenarioId("issued-asset-payment")).toBe(true);
    expect(isScenarioId("a".repeat(64))).toBe(true);
    expect(isScenarioId("a".repeat(65))).toBe(false);
    expect(isScenarioId("UPPER")).toBe(false);
    expect(isScenarioId("../etc")).toBe(false);
    expect(isScenarioId(7)).toBe(false);
  });
});
