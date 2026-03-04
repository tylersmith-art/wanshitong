import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedApiKey = {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
};

export function useApiKeys() {
  const utils = trpc.useUtils();
  const listQuery = trpc.apiKey.list.useQuery();

  useSyncSubscription<SerializedApiKey>(trpc.apiKey.onSync, {
    onCreated: (data) =>
      utils.apiKey.list.setData(undefined, (old) =>
        old ? [...old, data] : [data],
      ),
    onUpdated: (data) =>
      utils.apiKey.list.setData(undefined, (old) =>
        old ? old.map((k) => (k.id === data.id ? data : k)) : old,
      ),
    onDeleted: () => {
      utils.apiKey.list.invalidate();
    },
  });

  const generateMutation = trpc.apiKey.generate.useMutation({
    onSuccess: () => {
      utils.apiKey.list.invalidate();
    },
  });

  const revokeMutation = trpc.apiKey.revoke.useMutation({
    onSuccess: () => {
      utils.apiKey.list.invalidate();
    },
  });

  return {
    apiKeys: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    generateKey: generateMutation.mutateAsync,
    revokeKey: revokeMutation.mutateAsync,
    isGenerating: generateMutation.isPending,
    isRevoking: revokeMutation.isPending,
  };
}
