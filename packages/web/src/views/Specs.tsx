import { useState } from "react";
import { Link } from "react-router-dom";
import { useSpecs } from "@wanshitong/hooks";

type VisibilityFilter = "all" | "global" | "org" | "user";

const FILTER_TABS: { label: string; value: VisibilityFilter }[] = [
  { label: "All", value: "all" },
  { label: "Global", value: "global" },
  { label: "Org", value: "org" },
  { label: "My Specs", value: "user" },
];

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

export function Specs() {
  const [activeFilter, setActiveFilter] = useState<VisibilityFilter>("all");
  const filters =
    activeFilter === "all" ? undefined : { visibility: activeFilter };
  const { specs, isLoading, error } = useSpecs(filters);

  return (
    <div className="max-w-[700px] mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold">Specs</h1>
        <Link
          to="/specs/new"
          className="px-5 py-2 bg-indigo-600 text-white rounded text-sm no-underline hover:bg-indigo-700"
        >
          New Spec
        </Link>
      </div>
      <p className="text-gray-500 mb-6">
        Browse and manage architecture specifications.
      </p>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded mb-4">{error}</div>
      )}

      <div className="flex gap-1 mb-6">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveFilter(tab.value)}
            className={`px-4 py-2 rounded text-sm cursor-pointer ${
              activeFilter === tab.value
                ? "bg-indigo-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-gray-400 text-center p-8">Loading...</p>
      ) : specs.length ? (
        <table className="w-full border-collapse bg-white border border-gray-200 rounded-lg overflow-hidden">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                Name
              </th>
              <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                Visibility
              </th>
              <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                Embedding
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
            {specs.map((spec) => (
              <tr key={spec.id} className="border-t border-gray-100">
                <td className="px-4 py-3 text-sm">{spec.name}</td>
                <td className="px-4 py-3 text-sm">
                  <VisibilityBadge visibility={spec.visibility} />
                </td>
                <td className="px-4 py-3 text-sm">
                  <EmbeddingBadge status={spec.embeddingStatus} />
                </td>
                <td className="px-4 py-3 text-sm">
                  {new Date(spec.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-sm text-right">
                  <Link
                    to={`/specs/${spec.id}`}
                    className="px-3 py-1 bg-indigo-600 text-white rounded text-xs no-underline hover:bg-indigo-700"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-gray-400 text-center p-8">No specs found.</p>
      )}
    </div>
  );
}
