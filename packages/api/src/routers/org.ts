import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { tracked, TRPCError } from "@trpc/server";
import {
  CreateOrgSchema,
  UpdateOrgSchema,
  AddMemberSchema,
  UpdateMemberRoleSchema,
  syncChannel,
  type SyncEvent,
  type Org,
} from "@wanshitong/shared";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import { organizations, orgMembers } from "../db/schema.js";
import { iterateEvents } from "../lib/iterateEvents.js";

let eventId = 0;

function requireDbUser(ctx: { dbUser: { id: string } | null | undefined }) {
  if (!ctx.dbUser) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  }
  return ctx.dbUser.id;
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

function requireRole(member: { role: string }, allowed: string[], action: string): void {
  if (!allowed.includes(member.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Only ${allowed.join("/")} can ${action}`,
    });
  }
}

export const orgRouter = router({
  create: protectedProcedure
    .input(CreateOrgSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);

      const [org] = await ctx.db
        .insert(organizations)
        .values(input)
        .returning();

      await ctx.db
        .insert(orgMembers)
        .values({ orgId: org.id, userId, role: "owner" });

      await ctx.pubsub.publish(syncChannel("org"), {
        action: "created",
        data: org,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof org>);

      return org;
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = requireDbUser(ctx);

    const memberships = await ctx.db
      .select({ orgId: orgMembers.orgId })
      .from(orgMembers)
      .where(eq(orgMembers.userId, userId));

    if (memberships.length === 0) return [];

    const orgIds = memberships.map((m: { orgId: string }) => m.orgId);
    const allOrgs = await ctx.db
      .select()
      .from(organizations)
      .orderBy(organizations.createdAt);

    return allOrgs.filter((o: { id: string }) => orgIds.includes(o.id));
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireMembership(ctx.db, input.id, userId);

      const [org] = await ctx.db
        .select()
        .from(organizations)
        .where(eq(organizations.id, input.id))
        .limit(1);

      if (!org) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      return org;
    }),

  update: protectedProcedure
    .input(z.object({ id: z.string().uuid() }).merge(UpdateOrgSchema))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      const member = await requireMembership(ctx.db, input.id, userId);
      requireRole(member, ["owner", "admin"], "update organization");

      const { id, ...updates } = input;
      const [updated] = await ctx.db
        .update(organizations)
        .set(updates)
        .where(eq(organizations.id, id))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      await ctx.pubsub.publish(syncChannel("org"), {
        action: "updated",
        data: updated,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof updated>);

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      const member = await requireMembership(ctx.db, input.id, userId);
      requireRole(member, ["owner"], "delete organization");

      const [deleted] = await ctx.db
        .delete(organizations)
        .where(eq(organizations.id, input.id))
        .returning();

      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      await ctx.pubsub.publish(syncChannel("org"), {
        action: "deleted",
        data: deleted,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof deleted>);

      return { success: true };
    }),

  addMember: protectedProcedure
    .input(AddMemberSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      const member = await requireMembership(ctx.db, input.orgId, userId);
      requireRole(member, ["owner", "admin"], "add members");

      const [newMember] = await ctx.db
        .insert(orgMembers)
        .values(input)
        .returning();

      await ctx.pubsub.publish(syncChannel("org"), {
        action: "updated",
        data: newMember,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof newMember>);

      return newMember;
    }),

  removeMember: protectedProcedure
    .input(z.object({ orgId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const callerId = requireDbUser(ctx);
      const isSelfRemove = callerId === input.userId;

      if (!isSelfRemove) {
        const callerMember = await requireMembership(ctx.db, input.orgId, callerId);
        requireRole(callerMember, ["owner", "admin"], "remove members");
      }

      const [removed] = await ctx.db
        .delete(orgMembers)
        .where(
          and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, input.userId)),
        )
        .returning();

      if (!removed) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      }

      await ctx.pubsub.publish(syncChannel("org"), {
        action: "updated",
        data: removed,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof removed>);

      return { success: true };
    }),

  updateMemberRole: protectedProcedure
    .input(UpdateMemberRoleSchema)
    .mutation(async ({ ctx, input }) => {
      const callerId = requireDbUser(ctx);
      const callerMember = await requireMembership(ctx.db, input.orgId, callerId);
      requireRole(callerMember, ["owner"], "update member roles");

      const [updated] = await ctx.db
        .update(orgMembers)
        .set({ role: input.role })
        .where(
          and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, input.userId)),
        )
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      }

      await ctx.pubsub.publish(syncChannel("org"), {
        action: "updated",
        data: updated,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof updated>);

      return updated;
    }),

  listMembers: protectedProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireMembership(ctx.db, input.orgId, userId);

      return ctx.db
        .select()
        .from(orgMembers)
        .where(eq(orgMembers.orgId, input.orgId))
        .orderBy(orgMembers.createdAt);
    }),

  onSync: publicProcedure.subscription(async function* ({ ctx, signal }) {
    for await (const event of iterateEvents<SyncEvent<Org>>(
      ctx.pubsub,
      syncChannel("org"),
      signal!,
    )) {
      yield tracked(String(++eventId), event);
    }
  }),
});
