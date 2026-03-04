import PgBoss from "pg-boss";
import { getLogger } from "../lib/logger.js";
import { registerExampleHandler, EXAMPLE_JOB } from "./handlers/example.js";
import {
  registerWelcomeNotificationHandler,
  WELCOME_NOTIFICATION,
} from "./handlers/sendWelcomeNotification.js";
import {
  registerGenerateSummaryHandler,
  GENERATE_SUMMARY,
} from "./handlers/generateSummary.js";
import {
  registerGenerateEmbeddingHandler,
  GENERATE_EMBEDDING,
} from "./handlers/generateEmbedding.js";

let boss: PgBoss | null = null;

export async function initJobs(connectionString: string): Promise<void> {
  boss = new PgBoss(connectionString);

  boss.on("error", (error) => {
    getLogger().error({ err: error }, "pg-boss error");
  });

  await boss.start();
  getLogger().info("pg-boss started");

  // pg-boss v10 requires explicit queue creation before work()/send()
  await boss.createQueue(EXAMPLE_JOB);
  await boss.createQueue(WELCOME_NOTIFICATION);
  await boss.createQueue(GENERATE_SUMMARY);
  await boss.createQueue(GENERATE_EMBEDDING);

  await registerExampleHandler(boss);
  await registerWelcomeNotificationHandler(boss);
  await registerGenerateSummaryHandler(boss);
  await registerGenerateEmbeddingHandler(boss);
}

export async function closeJobs(): Promise<void> {
  if (boss) {
    await boss.stop();
    getLogger().info("pg-boss stopped");
  }
}

export async function enqueueJob<T extends object>(
  name: string,
  data: T,
): Promise<string | null> {
  if (!boss) throw new Error("pg-boss not initialized");
  return boss.send(name, data);
}
