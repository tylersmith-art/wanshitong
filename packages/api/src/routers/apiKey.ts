import { randomBytes } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import {
  CreateApiKeySchema,
  syncChannel,
  type SyncEvent,
  type ApiKey,
} from "@wanshitong/shared";
import { tracked, TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc.js";
import { apiKeys } from "../db/schema.js";
import { hashApiKey } from "../middleware/apiKeyAuth.js";
import { iterateEvents } from "../lib/iterateEvents.js";

let eventId = 0;

export const apiKeyRouter = router({
  /**
   * Generate a new API key.
   * Returns the plaintext key exactly once; only the hash is persisted.
   */
  generate: protectedProcedure
    .input(CreateApiKeySchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.dbUser) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "User not found in database" });
      }

      const raw = randomBytes(32).toString("hex");
      const plaintextKey = `wst_${raw}`;
      const keyHash = hashApiKey(plaintextKey);
      const keyPrefix = plaintextKey.slice(0, 8);

      const [row] = await ctx.db
        .insert(apiKeys)
        .values({
          userId: ctx.dbUser.id,
          name: input.name,
          keyHash,
          keyPrefix,
        })
        .returning();

      await ctx.pubsub.publish(syncChannel("apiKey"), {
        action: "created",
        data: {
          id: row.id,
          userId: row.userId,
          name: row.name,
          keyPrefix: row.keyPrefix,
          lastUsedAt: row.lastUsedAt,
          createdAt: row.createdAt,
        },
        timestamp: Date.now(),
      } satisfies SyncEvent<ApiKey>);

      return {
        id: row.id,
        userId: row.userId,
        name: row.name,
        keyPrefix: row.keyPrefix,
        lastUsedAt: row.lastUsedAt,
        createdAt: row.createdAt,
        plaintextKey,
      };
    }),

  /**
   * List the caller's API keys.
   * Never exposes the hash or plaintext key.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.dbUser) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "User not found in database" });
    }

    const rows = await ctx.db
      .select({
        id: apiKeys.id,
        userId: apiKeys.userId,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, ctx.dbUser.id));

    return rows;
  }),

  /**
   * Revoke (delete) an API key. Only the owning user may delete it.
   */
  revoke: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.dbUser) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "User not found in database" });
      }

      // Fetch the key first to verify ownership
      const [existing] = await ctx.db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, input.id))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "API key not found" });
      }

      if (existing.userId !== ctx.dbUser.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot revoke another user's API key" });
      }

      const [deleted] = await ctx.db
        .delete(apiKeys)
        .where(and(eq(apiKeys.id, input.id), eq(apiKeys.userId, ctx.dbUser.id)))
        .returning();

      await ctx.pubsub.publish(syncChannel("apiKey"), {
        action: "deleted",
        data: {
          id: deleted.id,
          userId: deleted.userId,
          name: deleted.name,
          keyPrefix: deleted.keyPrefix,
          lastUsedAt: deleted.lastUsedAt,
          createdAt: deleted.createdAt,
        },
        timestamp: Date.now(),
      } satisfies SyncEvent<ApiKey>);

      return { success: true };
    }),

  /**
   * Real-time subscription for API key sync events.
   */
  onSync: protectedProcedure.subscription(async function* ({ ctx, signal }) {
    for await (const event of iterateEvents<SyncEvent<ApiKey>>(
      ctx.pubsub,
      syncChannel("apiKey"),
      signal!,
    )) {
      yield tracked(String(++eventId), event);
    }
  }),
});
