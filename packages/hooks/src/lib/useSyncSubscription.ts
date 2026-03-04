import type { SyncEvent } from "@template/shared";

type CacheUpdater<T> = {
  onCreated?: (data: T) => void;
  onUpdated?: (data: T) => void;
  onDeleted?: (data: T) => void;
};

/** The subset of a tRPC subscription procedure needed by useSyncSubscription. */
type SyncSubscriptionHook = {
  useSubscription: (
    input: undefined,
    opts: { onData: (event: { data: SyncEvent }) => void },
  ) => unknown;
};

/**
 * Generic hook for subscribing to entity sync events.
 * Pass the tRPC subscription procedure object (e.g. `trpc.user.onSync`) and
 * cache-update callbacks for each action type.
 *
 * Usage:
 *   useSyncSubscription(trpc.user.onSync, {
 *     onCreated: (user) => utils.user.list.setData(undefined, old => [...old, user]),
 *     onDeleted: () => utils.user.list.invalidate(),
 *   });
 */
export function useSyncSubscription<T>(
  subscription: SyncSubscriptionHook,
  updaters: CacheUpdater<T>,
) {
  subscription.useSubscription(undefined, {
    onData(event: { data: SyncEvent }) {
      const { action, data } = event.data as unknown as SyncEvent<T>;
      switch (action) {
        case "created":
          updaters.onCreated?.(data);
          break;
        case "updated":
          updaters.onUpdated?.(data);
          break;
        case "deleted":
          updaters.onDeleted?.(data);
          break;
      }
    },
  });
}
