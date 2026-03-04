import { useState } from "react";
import { useQueryLogs } from "@wanshitong/hooks";
import { trpc } from "@wanshitong/hooks";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function truncateQuery(query: string, maxLen = 80): string {
  if (query.length <= maxLen) return query;
  return query.slice(0, maxLen) + "...";
}

export function QueryLogs() {
  const { logs, isLoading, error, goToNextPage, hasMore } = useQueryLogs();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const detailQuery = trpc.queryLog.getById.useQuery(
    { id: expandedId! },
    { enabled: !!expandedId },
  );

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="max-w-[900px] mx-auto">
      <h1 className="text-2xl font-bold mb-1">Query Logs</h1>
      <p className="text-gray-500 mb-8">
        View API query history across all keys.
      </p>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded mb-4">{error}</div>
      )}

      <div>
        {isLoading ? (
          <p className="text-gray-400 text-center p-8">Loading...</p>
        ) : logs.length ? (
          <>
            <table className="w-full border-collapse bg-white border border-gray-200 rounded-lg overflow-hidden">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                    Timestamp
                  </th>
                  <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                    API Key
                  </th>
                  <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                    Query
                  </th>
                  <th className="px-4 py-3 text-right bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                    Results
                  </th>
                  <th className="px-4 py-3 text-right bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                    Duration
                  </th>
                  <th className="px-4 py-3 text-right bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <>
                    <tr
                      key={log.id}
                      className="border-t border-gray-100 cursor-pointer hover:bg-gray-50"
                      onClick={() => toggleExpand(log.id)}
                    >
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm">{log.apiKeyName}</td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-700">
                        {truncateQuery(log.query)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        {log.resultCount}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-500">
                        {formatDuration(log.durationMs)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(log.id);
                          }}
                          className="px-3 py-1 bg-indigo-600 text-white rounded text-xs cursor-pointer hover:bg-indigo-700"
                        >
                          {expandedId === log.id ? "Collapse" : "Details"}
                        </button>
                      </td>
                    </tr>
                    {expandedId === log.id && (
                      <tr key={`${log.id}-detail`} className="border-t border-gray-100">
                        <td colSpan={6} className="px-4 py-4 bg-gray-50">
                          {detailQuery.isLoading ? (
                            <p className="text-gray-400 text-sm">Loading details...</p>
                          ) : detailQuery.data ? (
                            <div className="space-y-2 text-sm">
                              <div>
                                <span className="font-semibold text-gray-600">Full Query:</span>
                                <pre className="mt-1 bg-white border border-gray-200 rounded p-3 font-mono text-xs whitespace-pre-wrap break-words">
                                  {detailQuery.data.query}
                                </pre>
                              </div>
                              <div className="flex gap-6">
                                <div>
                                  <span className="font-semibold text-gray-600">User:</span>{" "}
                                  {detailQuery.data.userEmail}
                                </div>
                                <div>
                                  <span className="font-semibold text-gray-600">API Key:</span>{" "}
                                  {detailQuery.data.apiKeyName}
                                </div>
                                <div>
                                  <span className="font-semibold text-gray-600">Results:</span>{" "}
                                  {detailQuery.data.resultCount}
                                </div>
                                <div>
                                  <span className="font-semibold text-gray-600">Duration:</span>{" "}
                                  {formatDuration(detailQuery.data.durationMs)}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <p className="text-gray-400 text-sm">No details available.</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>

            {hasMore && (
              <div className="mt-4 text-center">
                <button
                  onClick={goToNextPage}
                  className="px-5 py-2 bg-indigo-600 text-white rounded text-sm cursor-pointer hover:bg-indigo-700"
                >
                  Load More
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="text-gray-400 text-center p-8">No query logs yet.</p>
        )}
      </div>
    </div>
  );
}
