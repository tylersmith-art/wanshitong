import { eq } from "drizzle-orm";
import { CreateUserSchema, syncChannel, type SyncEvent, type User } from "@wanshitong/shared";
import { tracked, TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import { users } from "../db/schema.js";
import { iterateEvents } from "../lib/iterateEvents.js";
import { enqueueJob } from "../jobs/index.js";
import { WELCOME_NOTIFICATION } from "../jobs/handlers/sendWelcomeNotification.js";
import { getLogger } from "../lib/logger.js";

let eventId = 0;

export const userRouter = router({
  me: protectedProcedure.query(async ({ ctx }) => {
    return ctx.dbUser;
  }),

  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(users).orderBy(users.createdAt);
  }),

  onSync: publicProcedure.subscription(async function* ({ ctx, signal }) {
    for await (const event of iterateEvents<SyncEvent<User>>(
      ctx.pubsub,
      syncChannel("user"),
      signal!,
    )) {
      yield tracked(String(++eventId), event);
    }
  }),

  create: protectedProcedure
    .input(CreateUserSchema)
    .mutation(async ({ ctx, input }) => {
      const sub = ctx.user.sub as string | undefined;
      const [user] = await ctx.db.insert(users).values({ ...input, role: "user", ...(sub && { sub }) }).returning();
      await ctx.pubsub.publish(syncChannel("user"), {
        action: "created",
        data: user,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof user>);

      try {
        await enqueueJob(WELCOME_NOTIFICATION, { userId: user.id });
      } catch (err) {
        getLogger().error({ err, userId: user.id }, "Failed to enqueue welcome notification");
      }

      return user;
    }),

  touch: protectedProcedure
    .input(CreateUserSchema.pick({ email: true }))
    .mutation(async ({ ctx, input }) => {
      const sub = ctx.user.sub as string | undefined;
      const [user] = await ctx.db
        .update(users)
        .set({ lastLoginAt: new Date(), ...(sub && { sub }) })
        .where(eq(users.email, input.email))
        .returning();
      if (user) {
        await ctx.pubsub.publish(syncChannel("user"), {
          action: "updated",
          data: user,
          timestamp: Date.now(),
        } satisfies SyncEvent<typeof user>);
      }
      return user ?? null;
    }),

  delete: protectedProcedure
    .input(CreateUserSchema.pick({ email: true }))
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await ctx.db
        .delete(users)
        .where(eq(users.email, input.email))
        .returning();
      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      await ctx.pubsub.publish(syncChannel("user"), {
        action: "deleted",
        data: deleted,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof deleted>);
      return { success: true };
    }),
});
