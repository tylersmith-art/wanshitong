import { useState } from "react";
import { useApiKeys } from "@wanshitong/hooks";

export function ApiKeys() {
  const { apiKeys, isLoading, error, generateKey, revokeKey, isGenerating, isRevoking } = useApiKeys();
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<{ plaintextKey: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    const result = await generateKey({ name });
    setNewKey({ plaintextKey: result.plaintextKey, name: result.name });
    setName("");
  };

  const handleRevoke = async (id: string, keyName: string) => {
    const confirmed = window.confirm(`Revoke API key "${keyName}"? This action cannot be undone.`);
    if (!confirmed) return;
    await revokeKey({ id });
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-[700px] mx-auto">
      <h1 className="text-2xl font-bold mb-1">API Keys</h1>
      <p className="text-gray-500 mb-8">
        Manage API keys for programmatic access.
      </p>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded mb-4">{error}</div>
      )}

      {newKey && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-8">
          <p className="text-sm font-semibold text-amber-800 mb-2">
            Key generated for "{newKey.name}" -- copy it now. This key won't be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border border-amber-200 rounded px-3 py-2 text-sm font-mono break-all select-all">
              {newKey.plaintextKey}
            </code>
            <button
              onClick={() => handleCopy(newKey.plaintextKey)}
              className="px-3 py-2 bg-amber-600 text-white rounded text-sm cursor-pointer hover:bg-amber-700"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <button
            onClick={() => setNewKey(null)}
            className="mt-2 text-xs text-amber-700 underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Generate New Key</h2>
        <form onSubmit={handleGenerate} className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Key name (e.g. CI/CD, Mobile App)"
            required
            className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
          />
          <button
            type="submit"
            disabled={isGenerating}
            className="px-5 py-2 bg-indigo-600 text-white rounded text-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isGenerating ? "Generating..." : "Generate"}
          </button>
        </form>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Your API Keys</h2>
        {isLoading ? (
          <p className="text-gray-400 text-center p-8">Loading...</p>
        ) : apiKeys.length ? (
          <table className="w-full border-collapse bg-white border border-gray-200 rounded-lg overflow-hidden">
            <thead>
              <tr>
                <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                  Name
                </th>
                <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                  Key Prefix
                </th>
                <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                  Last Used
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
              {apiKeys.map((key) => (
                <tr key={key.id} className="border-t border-gray-100">
                  <td className="px-4 py-3 text-sm">{key.name}</td>
                  <td className="px-4 py-3 text-sm">
                    <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">
                      {key.keyPrefix}...
                    </code>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {key.lastUsedAt
                      ? new Date(key.lastUsedAt).toLocaleDateString()
                      : "Never"}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {new Date(key.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    <button
                      onClick={() => handleRevoke(key.id, key.name)}
                      disabled={isRevoking}
                      className="px-3 py-1 bg-red-600 text-white rounded text-xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed hover:bg-red-700"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-gray-400 text-center p-8">No API keys yet.</p>
        )}
      </div>
    </div>
  );
}
