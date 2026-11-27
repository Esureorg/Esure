import { afterEach, describe, expect, it } from "vitest";
import { FAVORITES_STORAGE_KEY, readFavorites, writeFavorites } from "./favorites";

describe("browser favorites storage", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("accepts bounded scenario IDs, removes duplicates, and ignores invalid entries", () => {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([
      "xlm-payment",
      "xlm-payment",
      "invalid id",
      42,
      null,
      "a".repeat(65),
      "issued-asset-payment",
    ]));
    expect(readFavorites()).toEqual(["xlm-payment", "issued-asset-payment"]);
  });

  it.each(["null", "{}", '"xlm-payment"', "invalid json"])("returns no favorites for malformed stored value %s", (value) => {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, value);
    expect(readFavorites()).toEqual([]);
  });

  it("writes favorites as a JSON array under the versioned origin-local key", () => {
    writeFavorites(["xlm-payment"]);
    expect(window.localStorage.getItem(FAVORITES_STORAGE_KEY)).toBe('["xlm-payment"]');
  });

  it("bounds and validates favorites written to browser storage", () => {
    writeFavorites(["valid-id", "invalid id", ...Array.from({ length: 105 }, (_, index) => `scenario-${index}`)]);
    const stored = JSON.parse(window.localStorage.getItem(FAVORITES_STORAGE_KEY) ?? "null") as unknown[];
    expect(stored).toHaveLength(100);
    expect(stored).not.toContain("invalid id");
  });
});
