import { useState } from "react";
import { useUsers, trpc } from "@wanshitong/hooks";

export function Users() {
  const { users, isLoading, error, createUser, isCreating } = useUsers();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<{ userId: string; sent: number; skipped: number; failed: number } | null>(null);
  const sendTestPush = trpc.notification.sendTestPush.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email) return;
    await createUser({ name, email });
    setName("");
    setEmail("");
  };

  return (
    <div className="max-w-[700px] mx-auto">
      <h1 className="text-2xl font-bold mb-1">Users</h1>
      <p className="text-gray-500 mb-8">
        This page demonstrates tRPC with end-to-end type safety.
      </p>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded mb-4">{error}</div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Create User</h2>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            required
            className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="Email"
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
        <h2 className="text-lg font-semibold mb-4">All Users</h2>
        {isLoading ? (
          <p className="text-gray-400 text-center p-8">Loading...</p>
        ) : users.length ? (
          <table className="w-full border-collapse bg-white border border-gray-200 rounded-lg overflow-hidden">
            <thead>
              <tr>
                <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                  Name
                </th>
                <th className="px-4 py-3 text-left bg-gray-50 font-semibold text-xs uppercase text-gray-400">
                  Email
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
              {users.map((user) => (
                <tr key={user.id} className="border-t border-gray-100">
                  <td className="px-4 py-3 text-sm">{user.name}</td>
                  <td className="px-4 py-3 text-sm">{user.email}</td>
                  <td className="px-4 py-3 text-sm">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    <div className="flex items-center justify-end gap-2">
                      {pushResult?.userId === user.id && (
                        <span className={`text-xs ${pushResult.sent > 0 ? "text-green-600" : "text-amber-600"}`}>
                          {pushResult.sent > 0
                            ? `Sent ${pushResult.sent}`
                            : pushResult.skipped > 0
                              ? "Skipped (opted out)"
                              : "No push token"}
                        </span>
                      )}
                      <button
                        onClick={async () => {
                          setSendingTo(user.id);
                          setPushResult(null);
                          try {
                            const result = await sendTestPush.mutateAsync({ userId: user.id });
                            setPushResult({ userId: user.id, ...result.pushResults });
                          } finally {
                            setSendingTo(null);
                          }
                        }}
                        disabled={sendingTo === user.id}
                        className="px-3 py-1 bg-indigo-600 text-white rounded text-xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed hover:bg-indigo-700"
                      >
                        {sendingTo === user.id ? "Sending..." : "Test Push"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-gray-400 text-center p-8">No users yet.</p>
        )}
      </div>
    </div>
  );
}
