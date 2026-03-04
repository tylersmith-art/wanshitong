import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { tracked, TRPCError } from "@trpc/server";
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  AttachSpecSchema,
  syncChannel,
  type SyncEvent,
  type Project,
} from "@wanshitong/shared";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import {
  projects,
  projectSpecs,
  architectureSpecs,
  orgMembers,
} from "../db/schema.js";
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
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Not a member of this organization",
    });
  }
  return member;
}

function requireRole(
  member: { role: string },
  allowed: string[],
  action: string,
): void {
  if (!allowed.includes(member.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Only ${allowed.join("/")} can ${action}`,
    });
  }
}

async function requireProjectAccess(
  db: any,
  projectId: string,
  userId: string,
): Promise<{ project: any; member: { role: string } }> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }

  const member = await requireMembership(db, project.orgId, userId);
  return { project, member };
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

export const projectRouter = router({
  create: protectedProcedure
    .input(CreateProjectSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireMembership(ctx.db, input.orgId, userId);

      const [project] = await ctx.db
        .insert(projects)
        .values(input)
        .returning();

      await ctx.pubsub.publish(syncChannel("project"), {
        action: "created",
        data: project,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof project>);

      return project;
    }),

  list: protectedProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireMembership(ctx.db, input.orgId, userId);

      return ctx.db
        .select()
        .from(projects)
        .where(eq(projects.orgId, input.orgId))
        .orderBy(projects.createdAt);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      const { project } = await requireProjectAccess(ctx.db, input.id, userId);

      const [countResult] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(projectSpecs)
        .where(eq(projectSpecs.projectId, input.id))
        .limit(1);

      return {
        ...project,
        specCount: Number(countResult?.count ?? 0),
      };
    }),

  update: protectedProcedure
    .input(z.object({ id: z.string().uuid() }).merge(UpdateProjectSchema))
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireProjectAccess(ctx.db, input.id, userId);

      const { id, ...updates } = input;
      const [updated] = await ctx.db
        .update(projects)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(projects.id, id))
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      await ctx.pubsub.publish(syncChannel("project"), {
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
      const { member } = await requireProjectAccess(
        ctx.db,
        input.id,
        userId,
      );
      requireRole(member, ["owner", "admin"], "delete project");

      const [deleted] = await ctx.db
        .delete(projects)
        .where(eq(projects.id, input.id))
        .returning();

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      await ctx.pubsub.publish(syncChannel("project"), {
        action: "deleted",
        data: deleted,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof deleted>);

      return { success: true };
    }),

  attachSpec: protectedProcedure
    .input(AttachSpecSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireProjectAccess(ctx.db, input.projectId, userId);

      const [spec] = await ctx.db
        .select()
        .from(architectureSpecs)
        .where(eq(architectureSpecs.id, input.specId))
        .limit(1);

      if (!spec) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Spec not found" });
      }

      await checkSpecAccess(ctx.db, spec, userId);

      const [link] = await ctx.db
        .insert(projectSpecs)
        .values(input)
        .returning();

      await ctx.pubsub.publish(syncChannel("project"), {
        action: "updated",
        data: link,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof link>);

      return link;
    }),

  detachSpec: protectedProcedure
    .input(AttachSpecSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireProjectAccess(ctx.db, input.projectId, userId);

      const [removed] = await ctx.db
        .delete(projectSpecs)
        .where(
          and(
            eq(projectSpecs.projectId, input.projectId),
            eq(projectSpecs.specId, input.specId),
          ),
        )
        .returning();

      if (!removed) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Spec attachment not found",
        });
      }

      await ctx.pubsub.publish(syncChannel("project"), {
        action: "updated",
        data: removed,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof removed>);

      return { success: true };
    }),

  listSpecs: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = requireDbUser(ctx);
      await requireProjectAccess(ctx.db, input.projectId, userId);

      return ctx.db
        .select()
        .from(projectSpecs)
        .where(eq(projectSpecs.projectId, input.projectId))
        .orderBy(projectSpecs.createdAt);
    }),

  onSync: publicProcedure.subscription(async function* ({ ctx, signal }) {
    for await (const event of iterateEvents<SyncEvent<Project>>(
      ctx.pubsub,
      syncChannel("project"),
      signal!,
    )) {
      yield tracked(String(++eventId), event);
    }
  }),
});
