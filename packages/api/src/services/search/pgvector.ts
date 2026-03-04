import { getLogger } from "../../lib/logger.js";
import { sql } from "drizzle-orm";
import type {
  ConfidenceTier,
  SearchAdapter,
  SearchParams,
  SearchResult,
  SearchResultItem,
} from "./types.js";

/** Similarity thresholds for graded descent (Voyage asymmetric embeddings). */
const TIER_HIGH = 0.5;
const TIER_MODERATE = 0.3;
const TIER_FLOOR = 0.1;

function assignConfidence(similarity: number): ConfidenceTier {
  if (similarity >= TIER_HIGH) return "high";
  if (similarity >= TIER_MODERATE) return "moderate";
  return "low";
}

/**
 * Graded descent: return the best non-empty tier.
 *   1. If any results >= 0.5 → return only those (high confidence)
 *   2. Else if any results >= 0.3 → return those (moderate confidence)
 *   3. Else return everything above the floor (low confidence)
 */
function applyGradedDescent(
  rows: SearchResultItem[],
): SearchResultItem[] {
  const high = rows.filter((r) => r.similarity >= TIER_HIGH);
  if (high.length > 0) return high;

  const moderate = rows.filter((r) => r.similarity >= TIER_MODERATE);
  if (moderate.length > 0) return moderate;

  return rows;
}

export function createPgVectorSearchAdapter(config: {
  db: { execute: (query: any) => Promise<unknown> };
}): SearchAdapter {
  return {
    async search(params: SearchParams): Promise<SearchResult> {
      try {
        const limit = params.limit ?? 10;
        const floor = params.threshold ?? TIER_FLOOR;
        const embeddingLiteral = JSON.stringify(params.embedding);

        let query = sql`
          SELECT
            s.id as "specId",
            s.name,
            s.description,
            s.content,
            1 - (s.embedding <=> ${embeddingLiteral}::vector) as similarity
          FROM architecture_specs s
          WHERE s.embedding IS NOT NULL
            AND s.embedding_status = 'complete'
            AND 1 - (s.embedding <=> ${embeddingLiteral}::vector) >= ${floor}
        `;

        if (params.projectId) {
          query = sql`${query} AND EXISTS (
            SELECT 1 FROM project_specs ps WHERE ps.spec_id = s.id AND ps.project_id = ${params.projectId}
          )`;
        }

        query = sql`${query} ORDER BY s.embedding <=> ${embeddingLiteral}::vector LIMIT ${limit}`;

        const results = await config.db.execute(query);
        const rawRows = (
          (results as { rows?: unknown[] }).rows ?? results
        ) as Omit<SearchResultItem, "confidence">[];

        const tagged = rawRows.map((row) => ({
          ...row,
          confidence: assignConfidence(row.similarity),
        }));

        return {
          success: true,
          results: applyGradedDescent(tagged),
        };
      } catch (err) {
        getLogger().error({ err }, "pgvector search failed");
        return { success: false, error: (err as Error).message };
      }
    },
  };
}

export { TIER_HIGH, TIER_MODERATE, TIER_FLOOR };
