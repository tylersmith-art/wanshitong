import { z } from "zod";

export const SyncActionSchema = z.enum(["created", "updated", "deleted"]);
export type SyncAction = z.infer<typeof SyncActionSchema>;

export const SyncEventSchema = z.object({
  action: SyncActionSchema,
  data: z.unknown(),
  timestamp: z.number(),
});
type BaseSyncEvent = z.infer<typeof SyncEventSchema>;
export type SyncEvent<T = unknown> = Omit<BaseSyncEvent, "data"> & { data: T };

export function syncChannel(entity: string): string {
  return `sync:${entity}`;
}
