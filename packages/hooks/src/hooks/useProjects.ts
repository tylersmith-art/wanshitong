import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedProject = {
  id: string;
  name: string;
  description: string | null;
  orgId: string;
  createdAt: string;
  updatedAt: string;
};

export function useProjects(orgId: string) {
  const utils = trpc.useUtils();
  const listQuery = trpc.project.list.useQuery(
    { orgId },
    { enabled: !!orgId },
  );

  useSyncSubscription<SerializedProject>(trpc.project.onSync, {
    onCreated: () => {
      utils.project.list.invalidate({ orgId });
    },
    onUpdated: () => {
      utils.project.list.invalidate({ orgId });
    },
    onDeleted: () => {
      utils.project.list.invalidate({ orgId });
    },
  });

  const createMutation = trpc.project.create.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate({ orgId });
    },
  });
  const updateMutation = trpc.project.update.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate({ orgId });
    },
  });
  const deleteMutation = trpc.project.delete.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate({ orgId });
    },
  });

  return {
    projects: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    createProject: createMutation.mutateAsync,
    updateProject: updateMutation.mutateAsync,
    deleteProject: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
  };
}
