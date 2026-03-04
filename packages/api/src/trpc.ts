import { initTRPC, TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { Context } from "./context.js";
import { users } from "./db/schema.js";

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  let dbUser: typeof users.$inferSelect | null = null;
  const sub = ctx.user.sub as string | undefined;
  if (sub) {
    const rows = await ctx.db
      .select()
      .from(users)
      .where(eq(users.sub, sub))
      .limit(1);
    dbUser = rows[0] ?? null;
  }

  return next({ ctx: { ...ctx, user: ctx.user, dbUser } });
});
