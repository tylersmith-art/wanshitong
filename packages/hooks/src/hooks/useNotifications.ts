import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedNotification = {
  id: string;
  userId: string;
  title: string;
  body: string;
  actionUrl: string | null;
  read: boolean;
  createdAt: string;
};

export function useNotifications() {
  const utils = trpc.useUtils();

  const listQuery = trpc.notification.list.useQuery({ limit: 20 });
  const unreadQuery = trpc.notification.unreadCount.useQuery();

  useSyncSubscription<SerializedNotification>(trpc.notification.onSync, {
    onCreated: (data) => {
      utils.notification.list.setData({ limit: 20 }, (old) =>
        old
          ? { notifications: [data, ...old.notifications], nextCursor: old.nextCursor }
          : { notifications: [data], nextCursor: null },
      );
      utils.notification.unreadCount.invalidate();
    },
    onUpdated: (data) => {
      utils.notification.list.setData({ limit: 20 }, (old) =>
        old
          ? {
              notifications: old.notifications.map((n) =>
                n.id === data.id ? data : n,
              ),
              nextCursor: old.nextCursor,
            }
          : old,
      );
      utils.notification.unreadCount.invalidate();
    },
    onDeleted: () => {
      utils.notification.list.invalidate();
      utils.notification.unreadCount.invalidate();
    },
  });

  const markReadMutation = trpc.notification.markRead.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate();
      utils.notification.unreadCount.invalidate();
    },
  });

  const markUnreadMutation = trpc.notification.markUnread.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate();
      utils.notification.unreadCount.invalidate();
    },
  });

  const markAllReadMutation = trpc.notification.markAllRead.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate();
      utils.notification.unreadCount.invalidate();
    },
  });

  return {
    notifications: listQuery.data?.notifications ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    hasNextPage: listQuery.data?.nextCursor != null,
    fetchNextPage: () => {
      if (listQuery.data?.nextCursor) {
        utils.notification.list.fetch({
          cursor: listQuery.data.nextCursor,
          limit: 20,
        });
      }
    },
    unreadCount: unreadQuery.data?.count ?? 0,
    markRead: markReadMutation.mutateAsync,
    markUnread: markUnreadMutation.mutateAsync,
    markAllRead: markAllReadMutation.mutateAsync,
  };
}
