import { z } from "zod";
import { eq, and, or, inArray } from "drizzle-orm";
import { tracked, TRPCError } from "@trpc/server";
import {
  CreateSpecSchema,
  UpdateSpecSchema,
  syncChannel,
  type SyncEvent,
  type Spec,
} from "@wanshitong/shared";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import { architectureSpecs, orgMembers } from "../db/schema.js";
import { iterateEvents } from "../lib/iterateEvents.js";

let eventId = 0;

function requireDbUser(ctx: { dbUser: { id: string; role: string } | null | undefined }) {
  if (!ctx.dbUser) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  }
  return ctx.dbUser;
}

async function requireMembership(
  db: any,
  orgId: string,
  userId: string,
): Promise<{ role: string }> {
  const [member] = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);

  if (!member) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
  }
  return member;
}

async function checkSpecAccess(
  db: any,
  spec: { visibility: string; orgId: string | null; userId: string },
  callerId: string,
): Promise<void> {
  if (spec.visibility === "global") return;

  if (spec.visibility === "org" && spec.orgId) {
    await requireMembership(db, spec.orgId, callerId);
    return;
  }

  if (spec.visibility === "user" && spec.userId !== callerId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  }
}

export const specRouter = router({
  create: protectedProcedure
    .input(CreateSpecSchema)
    .mutation(async ({ ctx, input }) => {
      const dbUser = requireDbUser(ctx);

      if (input.visibility === "global" && dbUser.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }

      if (input.visibility === "org" && input.orgId) {
        await requireMembership(ctx.db, input.orgId, dbUser.id);
      }

      const [spec] = await ctx.db
        .insert(architectureSpecs)
        .values({ ...input, userId: dbUser.id })
        .returning();

      await ctx.pubsub.publish(syncChannel("spec"), {
        action: "created",
        data: spec,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof spec>);

      return spec;
    }),

  list: protectedProcedure
    .input(
      z.object({
        visibility: z.enum(["global", "org", "user"]).optional(),
        orgId: z.string().uuid().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const dbUser = requireDbUser(ctx);
      const userId = dbUser.id;

      const memberships = await ctx.db
        .select({ orgId: orgMembers.orgId })
        .from(orgMembers)
        .where(eq(orgMembers.userId, userId));
      const orgIds = memberships.map((m: { orgId: string }) => m.orgId);

      const conditions: ReturnType<typeof eq>[] = [
        eq(architectureSpecs.visibility, "global"),
      ];

      if (orgIds.length > 0) {
        conditions.push(
          and(
            eq(architectureSpecs.visibility, "org"),
            inArray(architectureSpecs.orgId, orgIds),
          )!,
        );
      }

      conditions.push(
        and(
          eq(architectureSpecs.visibility, "user"),
          eq(architectureSpecs.userId, userId),
        )!,
      );

      let query = ctx.db
        .select()
        .from(architectureSpecs)
        .where(or(...conditions));

      // Apply optional filters
      if (input?.visibility) {
        query = ctx.db
          .select()
          .from(architectureSpecs)
          .where(
            and(
              or(...conditions),
              eq(architectureSpecs.visibility, input.visibility),
            ),
          );
      }

      if (input?.orgId) {
        query = ctx.db
          .select()
          .from(architectureSpecs)
          .where(
            and(
              or(...conditions),
              eq(architectureSpecs.orgId, input.orgId),
            ),
          );
      }

      return query.orderBy(architectureSpecs.createdAt);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const dbUser = requireDbUser(ctx);

      const [spec] = await ctx.db
        .select()
        .from(architectureSpecs)
        .where(eq(architectureSpecs.id, input.id))
        .limit(1);

      if (!spec) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Spec not found" });
      }

      await checkSpecAccess(ctx.db, spec, dbUser.id);

      return spec;
    }),

  update: protectedProcedure
    .input(z.object({ id: z.string().uuid() }).merge(UpdateSpecSchema))
    .mutation(async ({ ctx, input }) => {
      const dbUser = requireDbUser(ctx);

      const [existing] = await ctx.db
        .select()
        .from(architectureSpecs)
        .where(eq(architectureSpecs.id, input.id))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Spec not found" });
      }

      if (existing.userId !== dbUser.id && dbUser.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized to update this spec" });
      }

      const { id, ...updates } = input;
      const [updated] = await ctx.db
        .update(architectureSpecs)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(architectureSpecs.id, id))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Spec not found" });
      }

      await ctx.pubsub.publish(syncChannel("spec"), {
        action: "updated",
        data: updated,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof updated>);

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const dbUser = requireDbUser(ctx);

      const [existing] = await ctx.db
        .select()
        .from(architectureSpecs)
        .where(eq(architectureSpecs.id, input.id))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Spec not found" });
      }

      if (existing.userId !== dbUser.id && dbUser.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized to delete this spec" });
      }

      const [deleted] = await ctx.db
        .delete(architectureSpecs)
        .where(eq(architectureSpecs.id, input.id))
        .returning();

      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Spec not found" });
      }

      await ctx.pubsub.publish(syncChannel("spec"), {
        action: "deleted",
        data: deleted,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof deleted>);

      return { success: true };
    }),

  onSync: publicProcedure.subscription(async function* ({ ctx, signal }) {
    for await (const event of iterateEvents<SyncEvent<Spec>>(
      ctx.pubsub,
      syncChannel("spec"),
      signal!,
    )) {
      yield tracked(String(++eventId), event);
    }
  }),
});
