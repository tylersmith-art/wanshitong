import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { trpc, useSpecs } from "@wanshitong/hooks";

function VisibilityBadge({ visibility }: { visibility: string }) {
  const colors: Record<string, string> = {
    global: "bg-blue-100 text-blue-700",
    org: "bg-green-100 text-green-700",
    user: "bg-gray-100 text-gray-600",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${colors[visibility] ?? "bg-gray-100 text-gray-600"}`}
    >
      {visibility}
    </span>
  );
}

function EmbeddingBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-700",
    processing: "bg-blue-100 text-blue-700",
    completed: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? "bg-gray-100 text-gray-600"}`}
    >
      {status}
    </span>
  );
}

export function SpecDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { deleteSpec } = useSpecs();
  const [isDeleting, setIsDeleting] = useState(false);

  const specQuery = trpc.spec.getById.useQuery(
    { id: id! },
    { enabled: !!id },
  );

  const handleDelete = async () => {
    if (!id) return;
    const confirmed = window.confirm(
      "Are you sure you want to delete this spec? This action cannot be undone.",
    );
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await deleteSpec({ id });
      navigate("/specs");
    } catch {
      setIsDeleting(false);
    }
  };

  if (specQuery.isLoading) {
    return <p className="text-gray-400 text-center p-8">Loading...</p>;
  }

  const spec = specQuery.data;

  if (!spec) {
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
        to="/specs"
        className="text-indigo-600 no-underline text-sm mb-4 inline-block"
      >
        &larr; Back to specs
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">{spec.name}</h1>
          {spec.description && (
            <p className="text-gray-500">{spec.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Link
            to={`/specs/${id}/edit`}
            className="px-4 py-2 bg-indigo-600 text-white rounded text-sm no-underline hover:bg-indigo-700"
          >
            Edit
          </Link>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="px-4 py-2 bg-red-600 text-white rounded text-sm cursor-pointer hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <div className="flex gap-6 text-sm text-gray-500 mb-4">
          <div>
            <span className="font-medium text-gray-700">Visibility:</span>{" "}
            <VisibilityBadge visibility={spec.visibility} />
          </div>
          <div>
            <span className="font-medium text-gray-700">Embedding:</span>{" "}
            <EmbeddingBadge status={spec.embeddingStatus} />
          </div>
        </div>
        <div className="flex gap-6 text-sm text-gray-500">
          <div>
            <span className="font-medium text-gray-700">Created:</span>{" "}
            {new Date(spec.createdAt).toLocaleDateString()}
          </div>
          <div>
            <span className="font-medium text-gray-700">Updated:</span>{" "}
            {new Date(spec.updatedAt).toLocaleDateString()}
          </div>
          {spec.orgId && (
            <div>
              <span className="font-medium text-gray-700">Org ID:</span>{" "}
              <span className="font-mono text-xs">{spec.orgId}</span>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Content</h2>
        <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono bg-gray-50 p-4 rounded overflow-auto">
          {spec.content}
        </pre>
      </div>
    </div>
  );
}
