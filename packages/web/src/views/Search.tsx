import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useSearch } from "@wanshitong/hooks";

const CONFIDENCE_STYLES: Record<string, { color: string; label: string }> = {
  high: { color: "bg-green-100 text-green-700", label: "High" },
  moderate: { color: "bg-yellow-100 text-yellow-700", label: "Moderate" },
  low: { color: "bg-gray-100 text-gray-600", label: "Low" },
};

function SimilarityBadge({
  similarity,
  confidence,
}: {
  similarity: number;
  confidence?: string;
}) {
  const pct = Math.round(similarity * 100);
  const tier = CONFIDENCE_STYLES[confidence ?? "low"] ?? CONFIDENCE_STYLES.low;
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${tier.color}`}>
      {tier.label} ({pct}%)
    </span>
  );
}

export function Search() {
  const { projectId } = useParams<{ projectId?: string }>();
  const [query, setQuery] = useState("");
  const { search, results, durationMs, isSearching, error, reset } =
    useSearch();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    await search({ query: query.trim(), projectId, limit: 10 });
  };

  const handleClear = () => {
    setQuery("");
    reset();
  };

  return (
    <div className="max-w-[700px] mx-auto">
      {projectId && (
        <Link
          to={`/projects/${projectId}`}
          className="text-indigo-600 no-underline text-sm mb-4 inline-block"
        >
          &larr; Back to project
        </Link>
      )}

      <h1 className="text-2xl font-bold mb-1">Search</h1>
      <p className="text-gray-500 mb-8">
        Search across specs using semantic similarity.
      </p>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded mb-4">{error}</div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter search query..."
            required
            className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
          />
          <button
            type="submit"
            disabled={isSearching || !query.trim()}
            className="px-5 py-2 bg-indigo-600 text-white rounded text-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed hover:bg-indigo-700"
          >
            {isSearching ? "Searching..." : "Search"}
          </button>
          {results.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              className="px-5 py-2 bg-gray-100 text-gray-700 rounded text-sm cursor-pointer hover:bg-gray-200"
            >
              Clear
            </button>
          )}
        </form>
      </div>

      <div>
        {durationMs > 0 && (
          <p className="text-gray-500 text-sm mb-4">
            Found {results.length} result{results.length !== 1 ? "s" : ""} in{" "}
            {durationMs}ms
          </p>
        )}

        {isSearching ? (
          <p className="text-gray-400 text-center p-8">Searching...</p>
        ) : results.length > 0 ? (
          <div className="flex flex-col gap-4">
            {results.map((result) => (
              <div
                key={result.specId}
                className="bg-white border border-gray-200 rounded-lg p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm">{result.name}</span>
                  <SimilarityBadge
                    similarity={result.similarity}
                    confidence={result.confidence}
                  />
                </div>
                {result.description && (
                  <p className="text-gray-600 text-sm mb-2">
                    {result.description}
                  </p>
                )}
                {result.content && (
                  <p className="text-gray-400 text-xs mb-3">
                    {result.content.length > 200
                      ? result.content.slice(0, 200) + "..."
                      : result.content}
                  </p>
                )}
                <Link
                  to={`/specs/${result.specId}`}
                  className="text-indigo-600 no-underline text-sm hover:underline"
                >
                  View Spec
                </Link>
              </div>
            ))}
          </div>
        ) : durationMs > 0 ? (
          <p className="text-gray-400 text-center p-8">
            No results found. Try a different query.
          </p>
        ) : null}
      </div>
    </div>
  );
}
