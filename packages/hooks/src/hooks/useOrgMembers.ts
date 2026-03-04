import { trpc } from "../trpc.js";

export function useOrgMembers(orgId: string) {
  const utils = trpc.useUtils();
  const listQuery = trpc.org.listMembers.useQuery(
    { orgId },
    { enabled: !!orgId },
  );

  const addMemberMutation = trpc.org.addMember.useMutation({
    onSuccess: () => {
      utils.org.listMembers.invalidate({ orgId });
    },
  });
  const removeMemberMutation = trpc.org.removeMember.useMutation({
    onSuccess: () => {
      utils.org.listMembers.invalidate({ orgId });
    },
  });
  const updateRoleMutation = trpc.org.updateMemberRole.useMutation({
    onSuccess: () => {
      utils.org.listMembers.invalidate({ orgId });
    },
  });

  return {
    members: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    addMember: addMemberMutation.mutateAsync,
    removeMember: removeMemberMutation.mutateAsync,
    updateRole: updateRoleMutation.mutateAsync,
    isAdding: addMemberMutation.isPending,
  };
}
