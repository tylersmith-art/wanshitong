import { z } from "zod";
import { eq, desc, lt, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router } from "../trpc.js";
import { adminProcedure } from "../middleware/requireRole.js";
import { queryLogs, apiKeys, users } from "../db/schema.js";
import { QueryLogListInputSchema } from "@wanshitong/shared";

export const queryLogRouter = router({
  list: adminProcedure
    .input(QueryLogListInputSchema)
    .query(async ({ ctx, input }) => {
      const { cursor, limit = 20, apiKeyId } = input;

      const conditions = [];
      if (cursor) {
        conditions.push(lt(queryLogs.id, cursor));
      }
      if (apiKeyId) {
        conditions.push(eq(queryLogs.apiKeyId, apiKeyId));
      }

      const baseQuery = ctx.db
        .select({
          id: queryLogs.id,
          apiKeyId: queryLogs.apiKeyId,
          apiKeyName: apiKeys.name,
          userEmail: users.email,
          query: queryLogs.query,
          resultCount: queryLogs.resultCount,
          durationMs: queryLogs.durationMs,
          createdAt: queryLogs.createdAt,
        })
        .from(queryLogs)
        .innerJoin(apiKeys, eq(queryLogs.apiKeyId, apiKeys.id))
        .innerJoin(users, eq(apiKeys.userId, users.id))
        .orderBy(desc(queryLogs.createdAt));

      const rows =
        conditions.length > 0
          ? await baseQuery.where(and(...conditions)).limit(limit + 1)
          : await baseQuery.limit(limit + 1);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? items[items.length - 1]!.id : undefined;

      return { items, nextCursor };
    }),

  getById: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: queryLogs.id,
          apiKeyId: queryLogs.apiKeyId,
          apiKeyName: apiKeys.name,
          userEmail: users.email,
          query: queryLogs.query,
          resultCount: queryLogs.resultCount,
          durationMs: queryLogs.durationMs,
          createdAt: queryLogs.createdAt,
        })
        .from(queryLogs)
        .innerJoin(apiKeys, eq(queryLogs.apiKeyId, apiKeys.id))
        .innerJoin(users, eq(apiKeys.userId, users.id))
        .where(eq(queryLogs.id, input.id))
        .limit(1);

      if (rows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Query log not found",
        });
      }

      return rows[0]!;
    }),
});
