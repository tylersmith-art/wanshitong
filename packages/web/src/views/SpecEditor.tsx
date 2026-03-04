import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { trpc, useSpecs, useOrgs } from "@wanshitong/hooks";

export function SpecEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEditMode = !!id;

  const { createSpec, updateSpec, isCreating } = useSpecs();
  const { orgs } = useOrgs();

  const specQuery = trpc.spec.getById.useQuery(
    { id: id! },
    { enabled: isEditMode },
  );

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState<"global" | "org" | "user">(
    "user",
  );
  const [orgId, setOrgId] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (specQuery.data) {
      setName(specQuery.data.name);
      setDescription(specQuery.data.description ?? "");
      setContent(specQuery.data.content);
      setVisibility(specQuery.data.visibility as "global" | "org" | "user");
      setOrgId(specQuery.data.orgId ?? "");
    }
  }, [specQuery.data]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    try {
      if (isEditMode) {
        await updateSpec({
          id: id!,
          name,
          description: description || undefined,
          content,
          visibility,
          orgId: visibility === "org" ? orgId || undefined : undefined,
        });
        navigate(`/specs/${id}`);
      } else {
        const spec = await createSpec({
          name,
          description: description || undefined,
          content,
          visibility,
          orgId: visibility === "org" ? orgId || undefined : undefined,
        });
        navigate(`/specs/${spec.id}`);
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "An error occurred",
      );
    }
  };

  if (isEditMode && specQuery.isLoading) {
    return <p className="text-gray-400 text-center p-8">Loading...</p>;
  }

  if (isEditMode && !specQuery.data && !specQuery.isLoading) {
    return (
      <div className="max-w-[700px] mx-auto">
        <p className="text-gray-400 text-center p-8">Spec not found.</p>
        <Link to="/specs" className="text-indigo-600 no-underline">
          Back to specs
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-[700px] mx-auto">
      <Link
        to={isEditMode ? `/specs/${id}` : "/specs"}
        className="text-indigo-600 no-underline text-sm mb-4 inline-block"
      >
        &larr; {isEditMode ? "Back to spec" : "Back to specs"}
      </Link>

      <h1 className="text-2xl font-bold mb-1">
        {isEditMode ? "Edit Spec" : "New Spec"}
      </h1>
      <p className="text-gray-500 mb-8">
        {isEditMode
          ? "Update the specification details below."
          : "Create a new architecture specification."}
      </p>

      {submitError && (
        <div className="bg-red-50 text-red-600 p-3 rounded mb-4">
          {submitError}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Spec name"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description (optional)"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
            />
          </div>

          <div className="flex gap-4 mb-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Visibility
              </label>
              <select
                value={visibility}
                onChange={(e) =>
                  setVisibility(e.target.value as "global" | "org" | "user")
                }
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              >
                <option value="user">User (private)</option>
                <option value="org">Organization</option>
                <option value="global">Global</option>
              </select>
            </div>

            {visibility === "org" && (
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Organization
                </label>
                <select
                  value={orgId}
                  onChange={(e) => setOrgId(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                >
                  <option value="">Select organization...</option>
                  {orgs.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Content (Markdown)
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write your spec content in markdown..."
              required
              rows={16}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono resize-y"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Link
            to={isEditMode ? `/specs/${id}` : "/specs"}
            className="px-5 py-2 bg-gray-100 text-gray-600 rounded text-sm no-underline hover:bg-gray-200"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isCreating}
            className="px-5 py-2 bg-indigo-600 text-white rounded text-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isCreating
              ? "Saving..."
              : isEditMode
                ? "Update Spec"
                : "Create Spec"}
          </button>
        </div>
      </form>
    </div>
  );
}
