import { trpc } from "@wanshitong/hooks";
import { useState } from "react";

const ROLES = ["user", "admin"] as const;

export function Admin() {
  const utils = trpc.useUtils();
  const { data: users, isLoading, error } = trpc.admin.listUsers.useQuery();
  const updateRole = trpc.admin.updateRole.useMutation({
    onSuccess: () => utils.admin.listUsers.invalidate(),
  });

  const [claimError, setClaimError] = useState<string | null>(null);
  const claimAdmin = trpc.admin.claimAdmin.useMutation({
    onSuccess: () => {
      utils.admin.listUsers.invalidate();
      setClaimError(null);
    },
    onError: (err) => setClaimError(err.message),
  });

  if (isLoading) return <div className="text-center p-8 text-gray-500">Loading...</div>;

  if (error?.data?.code === "FORBIDDEN") {
    return (
      <div className="text-center p-8">
        <h1 className="text-2xl font-bold mb-4">Admin Access Required</h1>
        <p className="text-gray-600 mb-4">You don't have admin permissions.</p>
        <button
          onClick={() => claimAdmin.mutate()}
          disabled={claimAdmin.isPending}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {claimAdmin.isPending ? "Claiming..." : "Claim Admin (first user only)"}
        </button>
        {claimError && <p className="text-red-500 mt-2">{claimError}</p>}
      </div>
    );
  }

  if (error) return <div className="text-red-500 p-8">Error: {error.message}</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Admin: User Management</h1>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 font-medium text-gray-600">Name</th>
            <th className="text-left py-2 font-medium text-gray-600">Email</th>
            <th className="text-left py-2 font-medium text-gray-600">Role</th>
            <th className="text-left py-2 font-medium text-gray-600">Created</th>
          </tr>
        </thead>
        <tbody>
          {users?.map((user) => (
            <tr key={user.id} className="border-b border-gray-100">
              <td className="py-2">{user.name}</td>
              <td className="py-2 text-gray-500">{user.email}</td>
              <td className="py-2">
                <select
                  value={user.role}
                  onChange={(e) =>
                    updateRole.mutate({
                      email: user.email,
                      role: e.target.value as "user" | "admin",
                    })
                  }
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-2 text-gray-500 text-sm">
                {new Date(user.createdAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
