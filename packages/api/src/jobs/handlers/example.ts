import type PgBoss from "pg-boss";
import { getLogger } from "../../lib/logger.js";

export const EXAMPLE_JOB = "example-job";

export async function registerExampleHandler(boss: PgBoss): Promise<void> {
  await boss.work(EXAMPLE_JOB, async ([job]) => {
    getLogger().info({ jobId: job.id, data: job.data }, "Processing example job");
  });
  getLogger().info(`Registered handler for ${EXAMPLE_JOB}`);
}
