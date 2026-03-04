import type PgBoss from "pg-boss";
import { getLogger } from "../../lib/logger.js";
import { getDb, getConnectionString } from "../../db/index.js";
import { PgPubSub } from "../../pubsub.js";
import { sendNotification } from "../../services/notifications/index.js";

export const WELCOME_NOTIFICATION = "welcome-notification";

type Payload = {
  userId: string;
};

export async function registerWelcomeNotificationHandler(
  boss: PgBoss,
): Promise<void> {
  await boss.work(WELCOME_NOTIFICATION, async ([job]) => {
    const { userId } = job.data as Payload;
    const logger = getLogger();

    logger.info({ jobId: job.id, userId }, "Sending welcome notification");

    const db = getDb();
    const pubsub = new PgPubSub(getConnectionString());

    try {
      const result = await sendNotification(db, pubsub, { userId }, {
        title: "Thanks for registering!",
        body: "Welcome! Explore the app to get started.",
      });

      logger.info(
        { jobId: job.id, userId, notificationIds: result.notificationIds, pushResults: result.pushResults },
        "Welcome notification sent",
      );
    } finally {
      await pubsub.close();
    }
  });

  getLogger().info(`Registered handler for ${WELCOME_NOTIFICATION}`);
}
