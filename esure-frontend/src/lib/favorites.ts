/**
 * Favorites are read back from localStorage, which any script or older build
 * can write to. Never trust its shape: accept only an array of scenario IDs
 * that the backend itself would accept (`scenarioId` in esure-backend/src/app.ts:
 * 1–64 chars of `[a-z0-9-]`), drop everything else, and deduplicate.
 */
export const SCENARIO_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

/** Upper bound on stored favorites so a tampered value cannot grow the set without limit. */
export const MAX_FAVORITES = 200;

export function isScenarioId(value: unknown): value is string {
  return typeof value === "string" && SCENARIO_ID_PATTERN.test(value);
}

/** Parses a raw localStorage value into a validated, deduplicated favorites set. */
export function parseFavorites(raw: string | null): Set<string> {
  if (!raw) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Set();
  }
  if (!Array.isArray(parsed)) return new Set();

  const favorites = new Set<string>();
  for (const entry of parsed) {
    if (favorites.size >= MAX_FAVORITES) break;
    if (isScenarioId(entry)) favorites.add(entry);
  }
  return favorites;
}
