import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { trpc, useNotificationToast } from "@template/hooks";

type Toast = {
  id: string;
  title: string;
  body: string;
  actionUrl: string | null;
};

export function NotificationToast() {
  const navigate = useNavigate();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { data: me } = trpc.user.me.useQuery();

  useNotificationToast(me?.id, (notification) => {
    setToasts((prev) => [notification, ...prev].slice(0, 3));
  });

  useEffect(() => {
    if (toasts.length === 0) return;

    const timers = toasts.map((toast) =>
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, 5000),
    );

    return () => timers.forEach(clearTimeout);
  }, [toasts]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleClick = useCallback(
    (toast: Toast) => {
      dismiss(toast.id);
      if (toast.actionUrl) navigate(toast.actionUrl);
    },
    [dismiss, navigate],
  );

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          onClick={() => handleClick(toast)}
          className="relative w-80 bg-white shadow-lg rounded-lg border-l-4 border-indigo-500 p-4 cursor-pointer transition-opacity duration-300"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              dismiss(toast.id);
            }}
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 bg-transparent border-none cursor-pointer text-sm leading-none"
          >
            &times;
          </button>
          <p className="font-semibold text-sm text-gray-900 pr-4">
            {toast.title}
          </p>
          <p className="text-gray-600 text-xs mt-1 line-clamp-2">
            {toast.body}
          </p>
        </div>
      ))}
    </div>
  );
}
