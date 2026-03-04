import { getLogger } from "../../lib/logger.js";
import { sql } from "drizzle-orm";
import type { SearchAdapter, SearchParams, SearchResult } from "./types.js";

export function createPgVectorSearchAdapter(config: {
  db: { execute: (query: any) => Promise<unknown> };
}): SearchAdapter {
  return {
    async search(params: SearchParams): Promise<SearchResult> {
      try {
        const limit = params.limit ?? 10;
        const threshold = params.threshold ?? 0.5;
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
            AND 1 - (s.embedding <=> ${embeddingLiteral}::vector) >= ${threshold}
        `;

        if (params.projectId) {
          query = sql`${query} AND EXISTS (
            SELECT 1 FROM project_specs ps WHERE ps.spec_id = s.id AND ps.project_id = ${params.projectId}
          )`;
        }

        query = sql`${query} ORDER BY s.embedding <=> ${embeddingLiteral}::vector LIMIT ${limit}`;

        const results = await config.db.execute(query);
        const rows = (results as { rows?: unknown[] }).rows ?? results;

        return {
          success: true,
          results: rows as SearchResult["results"],
        };
      } catch (err) {
        getLogger().error({ err }, "pgvector search failed");
        return { success: false, error: (err as Error).message };
      }
    },
  };
}
