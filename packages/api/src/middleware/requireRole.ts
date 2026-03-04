import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "../trpc.js";

export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.dbUser || ctx.dbUser.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }

  return next({ ctx });
});
