export const FAVORITES_STORAGE_KEY = "esure:favorites:v1";
const MAX_FAVORITES = 100;
const MAX_STORED_FAVORITES_LENGTH = 8_192;
const SCENARIO_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

function validFavorites(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(
    (id): id is string => typeof id === "string" && SCENARIO_ID_PATTERN.test(id),
  ))].slice(0, MAX_FAVORITES);
}

export function readFavorites(): string[] {
  try {
    const stored = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!stored || stored.length > MAX_STORED_FAVORITES_LENGTH) return [];
    const parsed: unknown = JSON.parse(stored);
    return validFavorites(parsed);
  } catch {
    return [];
  }
}

export function writeFavorites(favorites: string[]): void {
  try {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(validFavorites(favorites)));
  } catch {
    // Favorites remain available for the current page session.
  }
}
