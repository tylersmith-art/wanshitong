import { useNavigate } from "react-router-dom";
import { useNotifications } from "@template/hooks";

function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000,
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NotificationList() {
  const navigate = useNavigate();
  const {
    notifications,
    isLoading,
    hasNextPage,
    fetchNextPage,
    unreadCount,
    markRead,
    markUnread,
    markAllRead,
  } = useNotifications();

  if (isLoading) {
    return <p className="text-gray-400 text-center p-8">Loading notifications...</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Notifications</h2>
        {unreadCount > 0 && (
          <button
            onClick={() => markAllRead()}
            className="text-sm text-indigo-600 hover:text-indigo-800 cursor-pointer"
          >
            Mark all read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <p className="text-gray-400 text-center p-8">No notifications yet.</p>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`bg-white border border-gray-200 rounded-lg p-4 border-l-4 ${
                n.read ? "border-l-transparent" : "border-l-indigo-500"
              } ${n.actionUrl ? "cursor-pointer" : ""}`}
              onClick={() => {
                if (n.actionUrl) navigate(n.actionUrl);
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={n.read ? "font-normal" : "font-bold"}>
                    {n.title}
                  </p>
                  <p className="text-gray-600 text-sm mt-0.5">{n.body}</p>
                  <p className="text-gray-400 text-xs mt-1">
                    {timeAgo(n.createdAt)}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (n.read) {
                      markUnread({ id: n.id });
                    } else {
                      markRead({ id: n.id });
                    }
                  }}
                  className="text-xs text-gray-500 hover:text-gray-700 whitespace-nowrap cursor-pointer"
                >
                  {n.read ? "Mark unread" : "Mark read"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {hasNextPage && (
        <button
          onClick={fetchNextPage}
          className="mt-4 w-full py-2 text-sm text-indigo-600 hover:text-indigo-800 cursor-pointer"
        >
          Load more
        </button>
      )}
    </div>
  );
}
