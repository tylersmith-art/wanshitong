import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router } from "../trpc.js";
import { flexibleAuthProcedure } from "../middleware/apiKeyAuth.js";
import { getEmbeddingAdapter } from "../services/embedding/index.js";
import { getSearchAdapter } from "../services/search/index.js";
import { queryLogs, projects, orgMembers } from "../db/schema.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SearchInputSchema = z.object({
  query: z.string().min(1).max(2000),
  projectId: z.string().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export const searchRouter = router({
  search: flexibleAuthProcedure
    .input(SearchInputSchema)
    .query(async ({ ctx, input }) => {
      const startTime = Date.now();

      // 1. If projectId provided, resolve it (UUID or name) and verify access
      let resolvedProjectId: string | undefined;

      if (input.projectId) {
        const condition = UUID_RE.test(input.projectId)
          ? eq(projects.id, input.projectId)
          : eq(projects.name, input.projectId);

        const [project] = await ctx.db
          .select()
          .from(projects)
          .where(condition)
          .limit(1);

        if (!project) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Project not found",
          });
        }

        resolvedProjectId = project.id;

        if (!ctx.dbUser) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found",
          });
        }

        const [member] = await ctx.db
          .select()
          .from(orgMembers)
          .where(
            and(
              eq(orgMembers.orgId, project.orgId),
              eq(orgMembers.userId, ctx.dbUser.id),
            ),
          )
          .limit(1);

        if (!member) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not a member of this organization",
          });
        }
      }

      // 2. Embed the query text (use "query" input_type for asymmetric retrieval)
      const embedResult = await getEmbeddingAdapter().embed({
        text: input.query,
        inputType: "query",
      });

      if (!embedResult.success || !embedResult.embedding) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate embedding",
        });
      }

      // 3. Search with the embedding vector (always pass the resolved UUID)
      const searchResult = await getSearchAdapter().search({
        embedding: embedResult.embedding,
        projectId: resolvedProjectId,
        limit: input.limit,
      });

      if (!searchResult.success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Search failed",
        });
      }

      const results = searchResult.results ?? [];
      const durationMs = Date.now() - startTime;

      // 4. Log query for API key auth only (apiKeyId is NOT NULL in schema)
      if (ctx.apiKeyId) {
        await ctx.db.insert(queryLogs).values({
          apiKeyId: ctx.apiKeyId,
          query: input.query,
          resultCount: results.length,
          durationMs,
        });
      }

      // 5. Return ranked results with timing
      return { results, durationMs };
    }),
});
