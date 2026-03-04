import { eq, inArray } from "drizzle-orm";
import { syncChannel, type SyncEvent, type Notification } from "@wanshitong/shared";
import { notifications, pushTokens, users } from "../../db/schema.js";
import { getPushAdapter } from "../push/index.js";
import { getLogger } from "../../lib/logger.js";
import type { Context } from "../../context.js";
import type { PgPubSub } from "../../pubsub.js";

type Db = Context["db"];

type NotificationTarget = { userId: string } | { userIds: string[] };

type NotificationPayload = {
  title: string;
  body: string;
  actionUrl?: string | null;
};

type SendNotificationResult = {
  notificationIds: string[];
  pushResults: { sent: number; skipped: number; failed: number };
};

function normalizeUserIds(target: NotificationTarget): string[] {
  if ("userId" in target) return [target.userId];
  return target.userIds;
}

export async function sendNotification(
  db: Db,
  pubsub: PgPubSub,
  target: NotificationTarget,
  payload: NotificationPayload,
): Promise<SendNotificationResult> {
  const userIds = normalizeUserIds(target);

  const rows = userIds.map((userId) => ({
    userId,
    title: payload.title,
    body: payload.body,
    actionUrl: payload.actionUrl ?? null,
  }));

  const inserted = await db.insert(notifications).values(rows).returning();

  for (const notification of inserted) {
    await pubsub.publish(syncChannel("notification"), {
      action: "created",
      data: notification,
      timestamp: Date.now(),
    } satisfies SyncEvent<typeof notification>);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const optOutRows = await db
      .select({ id: users.id, pushOptOut: users.pushOptOut })
      .from(users)
      .where(inArray(users.id, userIds));

    const optedOutIds = new Set(
      optOutRows.filter((u) => u.pushOptOut).map((u) => u.id),
    );

    const eligibleUserIds = userIds.filter((id) => !optedOutIds.has(id));
    skipped = userIds.length - eligibleUserIds.length;

    if (eligibleUserIds.length > 0) {
      const tokens = await db
        .select()
        .from(pushTokens)
        .where(inArray(pushTokens.userId, eligibleUserIds));

      if (tokens.length > 0) {
        const pushParams = tokens.map((t) => ({
          token: t.token,
          title: payload.title,
          body: payload.body,
          ...(payload.actionUrl && { data: { actionUrl: payload.actionUrl } }),
        }));

        const results = await getPushAdapter().sendBatch(pushParams);

        const staleTokenIds: string[] = [];
        for (let i = 0; i < results.length; i++) {
          if (results[i].success) {
            sent++;
          } else if (results[i].deviceNotRegistered) {
            failed++;
            staleTokenIds.push(tokens[i].id);
          } else {
            failed++;
          }
        }

        if (staleTokenIds.length > 0) {
          await db
            .delete(pushTokens)
            .where(inArray(pushTokens.id, staleTokenIds));

          getLogger().info(
            { count: staleTokenIds.length },
            "Deleted stale push tokens (DeviceNotRegistered)",
          );
        }
      }
    }
  } catch (err) {
    getLogger().error({ err }, "Push delivery failed (notifications still persisted)");
  }

  return {
    notificationIds: inserted.map((n) => n.id),
    pushResults: { sent, skipped, failed },
  };
}

export async function broadcastNotification(
  db: Db,
  pubsub: PgPubSub,
  payload: NotificationPayload,
): Promise<SendNotificationResult> {
  const allUsers = await db.select({ id: users.id }).from(users);
  const userIds = allUsers.map((u) => u.id);
  return sendNotification(db, pubsub, { userIds }, payload);
}
