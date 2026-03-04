import { useState } from "react";
import { trpc } from "../trpc.js";

export function useQueryLogs(options?: { apiKeyId?: string }) {
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const listQuery = trpc.queryLog.list.useQuery({
    cursor,
    limit: 20,
    apiKeyId: options?.apiKeyId,
  });

  const getById = trpc.queryLog.getById.useQuery;

  const goToNextPage = () => {
    if (listQuery.data?.nextCursor) {
      setCursor(listQuery.data.nextCursor);
    }
  };

  const resetPagination = () => {
    setCursor(undefined);
  };

  return {
    logs: listQuery.data?.items ?? [],
    nextCursor: listQuery.data?.nextCursor ?? null,
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    goToNextPage,
    resetPagination,
    hasMore: !!listQuery.data?.nextCursor,
    getById,
  };
}
