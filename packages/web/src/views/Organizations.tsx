import { useState } from "react";
import { Link } from "react-router-dom";
import { useOrgs } from "@wanshitong/hooks";

export function Organizations() {
  const { orgs, isLoading, error, createOrg, isCreating } = useOrgs();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !slug) return;
    await createOrg({ name, slug });
    setName("");
    setSlug("");
  };

  return (
    <div className="max-w-[700px] mx-auto">
      <h1 className="text-2xl font-bold mb-1">Organizations</h1>
      <p className="text-gray-500 mb-8">
        Manage your organizations and team memberships.
      </p>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded mb-4">{error}</div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Create Organization</h2>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            required
            className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
          />
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="Slug"
            required
            className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
          />
          <button
            type="submit"
            disabled={isCreating}
            className="px-5 py-2 bg-indigo-600 text-white rounded text-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isCreating ? "Creating..." : "Create"}
          </button>
        </form>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Your Organizations</h2>
        {isLoading ? (
          <p className="text-gray-400 text-center p-8">Loading...</p>
        ) : orgs.length ? (
          <table className="w-full border-collapse bg-white border border-gray-200 rounded-lg overflow-hidden">
            <thead>
              <tr>
                <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                  Name
                </th>
                <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                  Slug
                </th>
                <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                  Created
                </th>
                <th className="px-4 py-3 text-right bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.id} className="border-t border-gray-100">
                  <td className="px-4 py-3 text-sm">{org.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {org.slug}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {new Date(org.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    <Link
                      to={`/orgs/${org.id}`}
                      className="px-3 py-1 bg-indigo-600 text-white rounded text-xs no-underline hover:bg-indigo-700"
                    >
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-gray-400 text-center p-8">
            No organizations yet.
          </p>
        )}
      </div>
    </div>
  );
}
