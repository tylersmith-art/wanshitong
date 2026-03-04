import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedOrg = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
};

export function useOrgs() {
  const utils = trpc.useUtils();
  const listQuery = trpc.org.list.useQuery();

  useSyncSubscription<SerializedOrg>(trpc.org.onSync, {
    onCreated: (data) =>
      utils.org.list.setData(undefined, (old) =>
        old ? [...old, data] : [data],
      ),
    onUpdated: (data) =>
      utils.org.list.setData(undefined, (old) =>
        old ? old.map((o) => (o.id === data.id ? data : o)) : old,
      ),
    onDeleted: () => {
      utils.org.list.invalidate();
    },
  });

  const createMutation = trpc.org.create.useMutation({
    onSuccess: () => {
      utils.org.list.invalidate();
    },
  });
  const updateMutation = trpc.org.update.useMutation({
    onSuccess: () => {
      utils.org.list.invalidate();
    },
  });
  const deleteMutation = trpc.org.delete.useMutation({
    onSuccess: () => {
      utils.org.list.invalidate();
    },
  });

  return {
    orgs: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    createOrg: createMutation.mutateAsync,
    updateOrg: updateMutation.mutateAsync,
    deleteOrg: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
  };
}
