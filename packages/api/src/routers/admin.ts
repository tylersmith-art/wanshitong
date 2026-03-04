import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { UpdateUserRoleSchema } from "@wanshitong/shared";
import { router, protectedProcedure } from "../trpc.js";
import { adminProcedure } from "../middleware/requireRole.js";
import { users } from "../db/schema.js";

export const adminRouter = router({
  claimAdmin: protectedProcedure.mutation(async ({ ctx }) => {
    if (!ctx.dbUser) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found. Create your account first." });
    }

    const admins = await ctx.db
      .select()
      .from(users)
      .where(eq(users.role, "admin"))
      .limit(1);

    if (admins.length > 0) {
      throw new TRPCError({ code: "FORBIDDEN", message: "An admin already exists" });
    }

    const [updated] = await ctx.db
      .update(users)
      .set({ role: "admin" })
      .where(eq(users.id, ctx.dbUser.id))
      .returning();

    return updated;
  }),

  listUsers: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(users).orderBy(users.createdAt);
  }),

  updateRole: adminProcedure
    .input(UpdateUserRoleSchema)
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(users)
        .set({ role: input.role })
        .where(eq(users.email, input.email))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      return updated;
    }),
});
