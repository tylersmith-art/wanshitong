import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedSpec = {
  id: string;
  name: string;
  description: string | null;
  content: string;
  summary: string | null;
  visibility: string;
  orgId: string | null;
  userId: string;
  embeddingStatus: string;
  createdAt: string;
  updatedAt: string;
};

export function useSpecs(filters?: { visibility?: string; orgId?: string }) {
  const utils = trpc.useUtils();
  const listQuery = trpc.spec.list.useQuery(filters);

  useSyncSubscription<SerializedSpec>(trpc.spec.onSync, {
    onCreated: () => {
      utils.spec.list.invalidate();
    },
    onUpdated: () => {
      utils.spec.list.invalidate();
    },
    onDeleted: () => {
      utils.spec.list.invalidate();
    },
  });

  const createMutation = trpc.spec.create.useMutation({
    onSuccess: () => {
      utils.spec.list.invalidate();
    },
  });
  const updateMutation = trpc.spec.update.useMutation({
    onSuccess: () => {
      utils.spec.list.invalidate();
    },
  });
  const deleteMutation = trpc.spec.delete.useMutation({
    onSuccess: () => {
      utils.spec.list.invalidate();
    },
  });

  return {
    specs: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    createSpec: createMutation.mutateAsync,
    updateSpec: updateMutation.mutateAsync,
    deleteSpec: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
  };
}
