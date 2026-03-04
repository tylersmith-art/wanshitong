import { useState } from "react";
import { trpc } from "../trpc.js";

export function useSearch() {
  const [searchInput, setSearchInput] = useState<{
    query: string;
    projectId?: string;
    limit?: number;
  } | null>(null);

  const searchQuery = trpc.search.search.useQuery(searchInput!, {
    enabled: !!searchInput,
  });

  const search = (params: {
    query: string;
    projectId?: string;
    limit?: number;
  }) => {
    setSearchInput(params);
  };

  const reset = () => {
    setSearchInput(null);
  };

  return {
    search,
    results: searchQuery.data?.results ?? [],
    durationMs: searchQuery.data?.durationMs ?? 0,
    isSearching: searchQuery.isLoading && !!searchInput,
    error: searchQuery.error?.message ?? null,
    reset,
  };
}
