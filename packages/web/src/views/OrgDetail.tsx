import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { trpc, useOrgMembers } from "@wanshitong/hooks";

export function OrgDetail() {
  const { id } = useParams<{ id: string }>();
  const orgQuery = trpc.org.getById.useQuery(
    { id: id! },
    { enabled: !!id },
  );
  const { members, isLoading, error, addMember, removeMember, updateRole, isAdding } =
    useOrgMembers(id ?? "");

  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("member");

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !id) return;
    await addMember({ orgId: id, userId, role });
    setUserId("");
    setRole("member");
  };

  const org = orgQuery.data;

  if (orgQuery.isLoading) {
    return <p className="text-gray-400 text-center p-8">Loading...</p>;
  }

  if (!org) {
    return (
      <div className="max-w-[700px] mx-auto">
        <p className="text-gray-400 text-center p-8">Organization not found.</p>
        <Link to="/orgs" className="text-indigo-600 no-underline">
          Back to organizations
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-[700px] mx-auto">
      <Link
        to="/orgs"
        className="text-indigo-600 no-underline text-sm mb-4 inline-block"
      >
        &larr; Back to organizations
      </Link>

      <h1 className="text-2xl font-bold mb-1">{org.name}</h1>
      <p className="text-gray-500 mb-8">Slug: {org.slug}</p>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded mb-4">{error}</div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Add Member</h2>
        <form onSubmit={handleAddMember} className="flex gap-2">
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="User ID"
            required
            className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded text-sm"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
          </select>
          <button
            type="submit"
            disabled={isAdding}
            className="px-5 py-2 bg-indigo-600 text-white rounded text-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isAdding ? "Adding..." : "Add"}
          </button>
        </form>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Members</h2>
        {isLoading ? (
          <p className="text-gray-400 text-center p-8">Loading...</p>
        ) : members.length ? (
          <table className="w-full border-collapse bg-white border border-gray-200 rounded-lg overflow-hidden">
            <thead>
              <tr>
                <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                  User ID
                </th>
                <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                  Role
                </th>
                <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                  Joined
                </th>
                <th className="px-4 py-3 text-right bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.userId} className="border-t border-gray-100">
                  <td className="px-4 py-3 text-sm font-mono text-xs">
                    {member.userId}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <select
                      value={member.role}
                      onChange={(e) =>
                        updateRole({
                          orgId: id!,
                          userId: member.userId,
                          role: e.target.value,
                        })
                      }
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                      <option value="owner">Owner</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {new Date(member.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    <button
                      onClick={() =>
                        removeMember({ orgId: id!, userId: member.userId })
                      }
                      className="px-3 py-1 bg-red-600 text-white rounded text-xs cursor-pointer hover:bg-red-700"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-gray-400 text-center p-8">No members yet.</p>
        )}
      </div>
    </div>
  );
}
