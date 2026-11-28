"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { listScenarios, type ScenarioSummary } from "@/lib/api";
import {
  filterScenario,
  searchScenario,
  sortScenarios,
  type ScenarioFilter,
  type SortOrder,
  FILTER_OPTIONS,
} from "@/components/dashboard";

const FAVORITES_STORAGE_KEY = "esure:favorite-scenarios";

function getFavorites(): Set<string> {
  try {
    const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
    return new Set(stored ? (JSON.parse(stored) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveFavorites(favorites: Set<string>): void {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(Array.from(favorites)));
  } catch {
    // ignore storage errors
  }
}

const VALID_CATEGORIES = new Set<string>(FILTER_OPTIONS.map((o) => o.key));

function parseCategory(value: string | null): ScenarioFilter {
  if (value && VALID_CATEGORIES.has(value)) return value as ScenarioFilter;
  return "all";
}

export interface UseCatalogueResult {
  scenarios: ScenarioSummary[];
  filteredScenarios: ScenarioSummary[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  filter: ScenarioFilter;
  setFilter: (f: ScenarioFilter) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  sortOrder: SortOrder;
  setSortOrder: (o: SortOrder) => void;
  favorites: Set<string>;
  toggleFavorite: (scenarioId: string) => void;
  loading: boolean;
  catalogueError: string | null;
  loadScenarios: () => () => void;
  categoryTabRefs: React.MutableRefObject<Partial<Record<ScenarioFilter, HTMLButtonElement>>>;
}

/**
 * Encapsulates catalogue fetch, filter, search, sort, favorites, and URL
 * synchronisation (issues #29, #30, #31, #153, #154).
 *
 * Extracted from Dashboard (issue #203) so the component can focus on
 * layout and run-state coordination.
 */
export function useCatalogue(): UseCatalogueResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");

  const [filter, setFilter] = useState<ScenarioFilter>(() =>
    parseCategory(searchParams?.get("category") ?? null),
  );
  const [searchQuery, setSearchQuery] = useState<string>(() => searchParams?.get("search") ?? "");
  const [sortOrder, setSortOrder] = useState<SortOrder>(
    () => (searchParams?.get("sort") as SortOrder | null) ?? "name-asc",
  );
  const [favorites, setFavorites] = useState<Set<string>>(() => getFavorites());

  const categoryTabRefs = useRef<Partial<Record<ScenarioFilter, HTMLButtonElement>>>({});

  // --- URL write-back ---
  const prevStateRef = useRef<{ filter: ScenarioFilter; search: string; sort: SortOrder }>({
    filter,
    search: searchQuery,
    sort: sortOrder,
  });

  useEffect(() => {
    if (
      prevStateRef.current.filter === filter &&
      prevStateRef.current.search === searchQuery &&
      prevStateRef.current.sort === sortOrder
    ) {
      return;
    }
    prevStateRef.current = { filter, search: searchQuery, sort: sortOrder };

    const newParams = new URLSearchParams(searchParams?.toString() ?? "");
    if (filter === "all") {
      newParams.delete("category");
    } else {
      newParams.set("category", filter);
    }
    if (searchQuery.trim()) {
      newParams.set("search", searchQuery.trim());
    } else {
      newParams.delete("search");
    }
    if (sortOrder !== "name-asc") {
      newParams.set("sort", sortOrder);
    } else {
      newParams.delete("sort");
    }
    router.replace(pathname + (newParams.toString() ? "?" + newParams.toString() : ""), {
      scroll: false,
    });
  }, [filter, searchQuery, sortOrder, pathname, router, searchParams]);

  // --- URL read-back (back/forward navigation) ---
  useEffect(() => {
    const urlCategory = parseCategory(searchParams?.get("category") ?? null);
    const urlSearch = searchParams?.get("search") ?? "";
    const urlSort = (searchParams?.get("sort") as SortOrder | null) ?? "name-asc";
    setFilter((prev) => (prev !== urlCategory ? urlCategory : prev));
    setSearchQuery((prev) => (prev !== urlSearch ? urlSearch : prev));
    setSortOrder((prev) => (prev !== urlSort ? urlSort : prev));
  }, [searchParams]);

  // --- Fetch ---
  const loadScenarios = useCallback(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setCatalogueError(null);
    listScenarios(controller.signal)
      .then((items) => {
        if (!active) return;
        setScenarios(items);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setCatalogueError(
          reason instanceof Error ? reason.message : "An unexpected error occurred.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    return loadScenarios();
  }, [loadScenarios]);

  // --- Derived list ---
  const filteredScenarios = useMemo(() => {
    const filtered = scenarios.filter(
      (s) => filterScenario(s, filter) && searchScenario(s, searchQuery),
    );
    return sortScenarios(filtered, sortOrder);
  }, [scenarios, filter, searchQuery, sortOrder]);

  // Keep selectedId pointing at a valid entry
  useEffect(() => {
    if (filteredScenarios.length > 0) {
      if (!filteredScenarios.some((s) => s.id === selectedId)) {
        setSelectedId(filteredScenarios[0].id);
      }
    } else {
      setSelectedId("");
    }
  }, [filteredScenarios, selectedId]);

  const toggleFavorite = useCallback((scenarioId: string) => {
    setFavorites((prev) => {
      const updated = new Set(prev);
      if (updated.has(scenarioId)) {
        updated.delete(scenarioId);
      } else {
        updated.add(scenarioId);
      }
      saveFavorites(updated);
      return updated;
    });
  }, []);

  return {
    scenarios,
    filteredScenarios,
    selectedId,
    setSelectedId,
    filter,
    setFilter,
    searchQuery,
    setSearchQuery,
    sortOrder,
    setSortOrder,
    favorites,
    toggleFavorite,
    loading,
    catalogueError,
    loadScenarios,
    categoryTabRefs,
  };
}
