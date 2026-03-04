import { useRef, useEffect } from "react";
import type { SyncEvent } from "@wanshitong/shared";
import { trpc } from "../trpc.js";

type ToastNotification = {
  id: string;
  userId: string;
  title: string;
  body: string;
  actionUrl: string | null;
};

export function useNotificationToast(
  currentUserId: string | null | undefined,
  onNotification: (notification: ToastNotification) => void,
) {
  const callbackRef = useRef(onNotification);

  useEffect(() => {
    callbackRef.current = onNotification;
  });

  trpc.notification.onSync.useSubscription(undefined, {
    onData(event: { data: SyncEvent }) {
      const { action, data } = event.data as unknown as SyncEvent<ToastNotification>;
      if (action === "created" && currentUserId && data.userId === currentUserId) {
        callbackRef.current({
          id: data.id,
          userId: data.userId,
          title: data.title,
          body: data.body,
          actionUrl: data.actionUrl,
        });
      }
    },
  });
}
