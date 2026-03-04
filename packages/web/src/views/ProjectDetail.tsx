import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { trpc, useProjectSpecs } from "@wanshitong/hooks";

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const projectQuery = trpc.project.getById.useQuery(
    { id: id! },
    { enabled: !!id },
  );
  const { projectSpecs, isLoading: specsLoading, error: specsError, attachSpec, detachSpec, isAttaching } =
    useProjectSpecs(id ?? "");
  const allSpecsQuery = trpc.spec.list.useQuery();

  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  const updateMutation = trpc.project.update.useMutation({
    onSuccess: () => {
      utils.project.getById.invalidate({ id: id! });
      utils.project.list.invalidate();
      setIsEditing(false);
    },
  });
  const deleteMutation = trpc.project.delete.useMutation({
    onSuccess: () => {
      navigate("/projects");
    },
  });

  const project = projectQuery.data;

  const handleStartEdit = () => {
    if (!project) return;
    setEditName(project.name);
    setEditDescription(project.description ?? "");
    setIsEditing(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !editName) return;
    await updateMutation.mutateAsync({
      id,
      name: editName,
      description: editDescription || undefined,
    });
  };

  const handleDelete = async () => {
    if (!id) return;
    const confirmed = window.confirm(
      "Are you sure you want to delete this project? This action cannot be undone.",
    );
    if (!confirmed) return;
    await deleteMutation.mutateAsync({ id });
  };

  const attachedSpecIds = new Set(projectSpecs.map((ps) => ps.specId));
  const availableSpecs = (allSpecsQuery.data ?? []).filter(
    (s) => !attachedSpecIds.has(s.id),
  );

  if (projectQuery.isLoading) {
    return <p className="text-gray-400 text-center p-8">Loading...</p>;
  }

  if (!project) {
    return (
      <div className="max-w-[700px] mx-auto">
        <p className="text-gray-400 text-center p-8">Project not found.</p>
        <Link to="/projects" className="text-indigo-600 no-underline">
          Back to projects
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-[700px] mx-auto">
      <Link
        to="/projects"
        className="text-indigo-600 no-underline text-sm mb-4 inline-block"
      >
        &larr; Back to projects
      </Link>

      <div className="flex items-start justify-between mb-1">
        <h1 className="text-2xl font-bold">{project.name}</h1>
        <div className="flex gap-2">
          {!isEditing && (
            <button
              onClick={handleStartEdit}
              className="px-3 py-1 bg-gray-100 text-gray-700 rounded text-xs cursor-pointer hover:bg-gray-200"
            >
              Edit
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="px-3 py-1 bg-red-600 text-white rounded text-xs cursor-pointer hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
      <p className="text-gray-500 mb-2">
        {project.description ?? "No description"}
      </p>
      <p className="text-gray-400 text-sm mb-8">
        Specs attached: {project.specCount}
      </p>

      {(specsError) && (
        <div className="bg-red-50 text-red-600 p-3 rounded mb-4">
          {specsError}
        </div>
      )}

      {isEditing && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Edit Project</h2>
          <form onSubmit={handleSaveEdit} className="flex gap-2">
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Project name"
              required
              className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
            />
            <input
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Description (optional)"
              className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
            />
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="px-5 py-2 bg-indigo-600 text-white rounded text-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {updateMutation.isPending ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="px-5 py-2 bg-gray-100 text-gray-700 rounded text-sm cursor-pointer hover:bg-gray-200"
            >
              Cancel
            </button>
          </form>
        </div>
      )}

      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Attached Specs</h2>
        {specsLoading ? (
          <p className="text-gray-400 text-center p-8">Loading...</p>
        ) : projectSpecs.length ? (
          <table className="w-full border-collapse bg-white border border-gray-200 rounded-lg overflow-hidden">
            <thead>
              <tr>
                <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                  Spec ID
                </th>
                <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                  Attached
                </th>
                <th className="px-4 py-3 text-right bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {projectSpecs.map((ps) => (
                <tr key={ps.specId} className="border-t border-gray-100">
                  <td className="px-4 py-3 text-sm font-mono text-xs">
                    {ps.specId}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {new Date(ps.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    <button
                      onClick={() =>
                        detachSpec({ projectId: id!, specId: ps.specId })
                      }
                      className="px-3 py-1 bg-red-600 text-white rounded text-xs cursor-pointer hover:bg-red-700"
                    >
                      Detach
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-gray-400 text-center p-8">
            No specs attached yet.
          </p>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Attach Spec</h2>
        {allSpecsQuery.isLoading ? (
          <p className="text-gray-400 text-center p-8">Loading specs...</p>
        ) : availableSpecs.length ? (
          <table className="w-full border-collapse bg-white border border-gray-200 rounded-lg overflow-hidden">
            <thead>
              <tr>
                <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                  Name
                </th>
                <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                  Visibility
                </th>
                <th className="px-4 py-3 text-right bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {availableSpecs.map((spec) => (
                <tr key={spec.id} className="border-t border-gray-100">
                  <td className="px-4 py-3 text-sm">{spec.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {spec.visibility}
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    <button
                      onClick={() =>
                        attachSpec({ projectId: id!, specId: spec.id })
                      }
                      disabled={isAttaching}
                      className="px-3 py-1 bg-indigo-600 text-white rounded text-xs cursor-pointer hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isAttaching ? "Attaching..." : "Attach"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-gray-400 text-center p-8">
            No specs available to attach.
          </p>
        )}
      </div>
    </div>
  );
}
