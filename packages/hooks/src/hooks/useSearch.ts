import { trpc } from "../trpc.js";

export function useSearch() {
  const searchMutation = trpc.search.search.useMutation();

  return {
    search: searchMutation.mutateAsync,
    results: searchMutation.data?.results ?? [],
    durationMs: searchMutation.data?.durationMs ?? 0,
    isSearching: searchMutation.isPending,
    error: searchMutation.error?.message ?? null,
    reset: searchMutation.reset,
  };
}
