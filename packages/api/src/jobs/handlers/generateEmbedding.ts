import type PgBoss from "pg-boss";
import { eq } from "drizzle-orm";
import { getLogger } from "../../lib/logger.js";
import { getDb } from "../../db/index.js";
import { architectureSpecs } from "../../db/schema.js";
import { getEmbeddingAdapter } from "../../services/embedding/index.js";

export const GENERATE_EMBEDDING = "generate-embedding";

type GenerateEmbeddingPayload = {
  specId: string;
};

export async function registerGenerateEmbeddingHandler(
  boss: PgBoss,
): Promise<void> {
  await boss.work(GENERATE_EMBEDDING, async ([job]) => {
    const { specId } = job.data as GenerateEmbeddingPayload;
    const db = getDb();
    const logger = getLogger();

    logger.info({ jobId: job.id, specId }, "Generating embedding");

    // Load spec
    const [spec] = await db
      .select()
      .from(architectureSpecs)
      .where(eq(architectureSpecs.id, specId))
      .limit(1);

    if (!spec) {
      logger.warn({ specId }, "Spec not found, skipping embedding generation");
      return;
    }

    // Must have a summary to embed
    if (!spec.summary) {
      logger.warn(
        { specId },
        "Spec has no summary, skipping embedding generation",
      );
      return;
    }

    // Generate embedding from summary
    const adapter = getEmbeddingAdapter();
    const result = await adapter.embed({ text: spec.summary });

    if (!result.success) {
      logger.error(
        { specId, error: result.error },
        "Embedding generation failed",
      );
      await db
        .update(architectureSpecs)
        .set({ embeddingStatus: "failed" })
        .where(eq(architectureSpecs.id, specId));
      throw new Error(result.error); // pg-boss will retry
    }

    // Save embedding and mark complete
    await db
      .update(architectureSpecs)
      .set({
        embedding: result.embedding!,
        embeddingStatus: "complete",
      })
      .where(eq(architectureSpecs.id, specId));

    logger.info(
      { specId, dimensions: result.dimensions },
      "Embedding generated and stored",
    );
  });

  getLogger().info(`Registered handler for ${GENERATE_EMBEDDING}`);
}
