import type PgBoss from "pg-boss";
import { eq } from "drizzle-orm";
import { getLogger } from "../../lib/logger.js";
import { getDb } from "../../db/index.js";
import { architectureSpecs } from "../../db/schema.js";
import { getSummarizationAdapter } from "../../services/summarization/index.js";
import { enqueueJob } from "../index.js";

export const GENERATE_SUMMARY = "generate-summary";

type GenerateSummaryPayload = {
  specId: string;
};

export async function registerGenerateSummaryHandler(
  boss: PgBoss,
): Promise<void> {
  await boss.work(GENERATE_SUMMARY, async ([job]) => {
    const { specId } = job.data as GenerateSummaryPayload;
    const db = getDb();
    const logger = getLogger();

    logger.info({ jobId: job.id, specId }, "Generating summary");

    const [spec] = await db
      .select()
      .from(architectureSpecs)
      .where(eq(architectureSpecs.id, specId))
      .limit(1);

    if (!spec) {
      logger.warn({ specId }, "Spec not found, skipping summary generation");
      return;
    }

    await db
      .update(architectureSpecs)
      .set({ embeddingStatus: "processing" })
      .where(eq(architectureSpecs.id, specId));

    const adapter = getSummarizationAdapter();
    const result = await adapter.summarize({ content: spec.content });

    if (!result.success) {
      logger.error({ specId, error: result.error }, "Summary generation failed");
      await db
        .update(architectureSpecs)
        .set({ embeddingStatus: "failed" })
        .where(eq(architectureSpecs.id, specId));
      throw new Error(result.error);
    }

    await db
      .update(architectureSpecs)
      .set({ summary: result.summary })
      .where(eq(architectureSpecs.id, specId));

    logger.info({ specId }, "Summary generated, enqueuing embedding job");

    await enqueueJob("generate-embedding", { specId });
  });

  getLogger().info(`Registered handler for ${GENERATE_SUMMARY}`);
}
