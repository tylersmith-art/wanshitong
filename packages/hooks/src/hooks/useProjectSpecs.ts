import { trpc } from "../trpc.js";

export function useProjectSpecs(projectId: string) {
  const utils = trpc.useUtils();
  const listQuery = trpc.project.listSpecs.useQuery(
    { projectId },
    { enabled: !!projectId },
  );

  const attachMutation = trpc.project.attachSpec.useMutation({
    onSuccess: () => {
      utils.project.listSpecs.invalidate({ projectId });
      utils.project.getById.invalidate({ id: projectId });
    },
  });
  const detachMutation = trpc.project.detachSpec.useMutation({
    onSuccess: () => {
      utils.project.listSpecs.invalidate({ projectId });
      utils.project.getById.invalidate({ id: projectId });
    },
  });

  return {
    projectSpecs: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    attachSpec: attachMutation.mutateAsync,
    detachSpec: detachMutation.mutateAsync,
    isAttaching: attachMutation.isPending,
  };
}
