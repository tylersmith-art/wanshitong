import { useState } from "react";
import { Link } from "react-router-dom";
import { useOrgs, useProjects } from "@wanshitong/hooks";

export function Projects() {
  const { orgs, isLoading: orgsLoading } = useOrgs();
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const {
    projects,
    isLoading,
    error,
    createProject,
    isCreating,
  } = useProjects(selectedOrgId);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !selectedOrgId) return;
    await createProject({
      name,
      description: description || undefined,
      orgId: selectedOrgId,
    });
    setName("");
    setDescription("");
  };

  return (
    <div className="max-w-[700px] mx-auto">
      <h1 className="text-2xl font-bold mb-1">Projects</h1>
      <p className="text-gray-500 mb-8">
        Manage projects within your organizations.
      </p>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded mb-4">{error}</div>
      )}

      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Organization
        </label>
        {orgsLoading ? (
          <p className="text-gray-400 text-sm">Loading organizations...</p>
        ) : (
          <select
            value={selectedOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
          >
            <option value="">Select an organization</option>
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {selectedOrgId && (
        <>
          <div className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
            <h2 className="text-lg font-semibold mb-4">Create Project</h2>
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project name"
                required
                className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
              />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (optional)"
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
            <h2 className="text-lg font-semibold mb-4">Projects</h2>
            {isLoading ? (
              <p className="text-gray-400 text-center p-8">Loading...</p>
            ) : projects.length ? (
              <table className="w-full border-collapse bg-white border border-gray-200 rounded-lg overflow-hidden">
                <thead>
                  <tr>
                    <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                      Description
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
                  {projects.map((project) => (
                    <tr key={project.id} className="border-t border-gray-100">
                      <td className="px-4 py-3 text-sm">{project.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {project.description ?? "\u2014"}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {new Date(project.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        <Link
                          to={`/projects/${project.id}`}
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
                No projects yet.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
