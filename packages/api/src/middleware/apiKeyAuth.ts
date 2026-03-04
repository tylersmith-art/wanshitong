import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { publicProcedure } from "../trpc.js";
import { apiKeys, users } from "../db/schema.js";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Authenticates via API key only (for CLI/programmatic access).
 * Expects a Bearer token starting with "wst_" in the Authorization header.
 */
export const apiKeyProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const token = ctx.rawToken;
  if (!token || !token.startsWith("wst_")) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Valid API key required",
    });
  }

  const keyHash = hashApiKey(token);
  const [keyRow] = await ctx.db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  if (!keyRow) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid API key",
    });
  }

  // Update lastUsedAt (fire-and-forget is fine here)
  await ctx.db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, keyRow.id));

  // Resolve the owning user
  const [dbUser] = await ctx.db
    .select()
    .from(users)
    .where(eq(users.id, keyRow.userId))
    .limit(1);

  if (!dbUser) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "API key owner not found",
    });
  }

  const user = { sub: dbUser.sub ?? dbUser.id, email: dbUser.email };

  return next({ ctx: { ...ctx, user, dbUser, apiKeyId: keyRow.id } });
});

/**
 * Accepts EITHER an Auth0 JWT OR an API key.
 * - If a JWT already resolved a user (ctx.user is set), use that.
 * - Otherwise, try to authenticate via API key.
 */
export const flexibleAuthProcedure = publicProcedure.use(
  async ({ ctx, next }) => {
    // Path 1: JWT already resolved
    if (ctx.user) {
      const sub = ctx.user.sub as string | undefined;
      let dbUser = null;
      if (sub) {
        const rows = await ctx.db
          .select()
          .from(users)
          .where(eq(users.sub, sub))
          .limit(1);
        dbUser = rows[0] ?? null;
      }
      return next({ ctx: { ...ctx, dbUser, apiKeyId: null } });
    }

    // Path 2: Try API key
    const token = ctx.rawToken;
    if (token?.startsWith("wst_")) {
      const keyHash = hashApiKey(token);
      const [keyRow] = await ctx.db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.keyHash, keyHash))
        .limit(1);

      if (keyRow) {
        await ctx.db
          .update(apiKeys)
          .set({ lastUsedAt: new Date() })
          .where(eq(apiKeys.id, keyRow.id));

        const [dbUser] = await ctx.db
          .select()
          .from(users)
          .where(eq(users.id, keyRow.userId))
          .limit(1);

        if (dbUser) {
          const user = {
            sub: dbUser.sub ?? dbUser.id,
            email: dbUser.email,
          };
          return next({
            ctx: { ...ctx, user, dbUser, apiKeyId: keyRow.id },
          });
        }
      }
    }

    throw new TRPCError({ code: "UNAUTHORIZED" });
  },
);
