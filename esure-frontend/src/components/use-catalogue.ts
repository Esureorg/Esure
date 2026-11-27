"use client";

/**
 * useCatalogue — catalogue state management extracted from Dashboard (#203).
 *
 * Encapsulates: scenario list loading, error state, search query, filter,
 * sort order, favorites persistence, and the filtered/sorted derived list.
 * The Dashboard component composes this hook and passes its outputs to the
 * catalogue sub-panel, keeping the two concerns separate.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { listScenarios, type ScenarioSummary } from "@/lib/api";
import type { ScenarioFilter, SortOrder } from "./dashboard";

const FAVORITES_STORAGE_KEY = "esure:favorite-scenarios";

function readFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed as string[]);
  } catch {
    // ignore
  }
  return new Set();
}

function writeFavorites(ids: Set<string>): void {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore
  }
}

function filterScenario(s: ScenarioSummary, filter: ScenarioFilter): boolean {
  if (filter === "all") return true;
  if (filter === "xlm") return s.tags?.includes("xlm") ?? false;
  if (filter === "issued-asset") return s.tags?.includes("issued-asset") ?? false;
  if (filter === "expected-failure") return s.tags?.includes("expected-failure") ?? false;
  return true;
}

function searchScenario(s: ScenarioSummary, q: string): boolean {
  if (!q.trim()) return true;
  const lower = q.toLowerCase();
  return (
    s.id.toLowerCase().includes(lower) ||
    s.name.toLowerCase().includes(lower) ||
    (s.description ?? "").toLowerCase().includes(lower)
  );
}

function sortScenarios(list: ScenarioSummary[], order: SortOrder): ScenarioSummary[] {
  const copy = [...list];
  if (order === "name-asc") return copy.sort((a, b) => a.name.localeCompare(b.name));
  if (order === "name-desc") return copy.sort((a, b) => b.name.localeCompare(a.name));
  if (order === "id-asc") return copy.sort((a, b) => a.id.localeCompare(b.id));
  return copy;
}

export interface UseCatalogueResult {
  scenarios: ScenarioSummary[];
  filteredScenarios: ScenarioSummary[];
  loading: boolean;
  catalogueError: string | null;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  filter: ScenarioFilter;
  setFilter: (f: ScenarioFilter) => void;
  sortOrder: SortOrder;
  setSortOrder: (o: SortOrder) => void;
  favorites: Set<string>;
  toggleFavorite: (id: string) => void;
  reload: () => void;
}

export function useCatalogue(): UseCatalogueResult {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<ScenarioFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("name-asc");
  const [favorites, setFavorites] = useState<Set<string>>(() => readFavorites());

  const load = useCallback(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setCatalogueError(null);
    listScenarios(controller.signal)
      .then((items) => { if (active) setScenarios(items); })
      .catch((reason: unknown) => {
        if (!active) return;
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setCatalogueError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, []);

  useEffect(() => load(), [load]);

  const filteredScenarios = useMemo(
    () => sortScenarios(scenarios.filter((s) => filterScenario(s, filter) && searchScenario(s, searchQuery)), sortOrder),
    [scenarios, filter, searchQuery, sortOrder],
  );

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeFavorites(next);
      return next;
    });
  }, []);

  return { scenarios, filteredScenarios, loading, catalogueError, searchQuery, setSearchQuery, filter, setFilter, sortOrder, setSortOrder, favorites, toggleFavorite, reload: load };
}
