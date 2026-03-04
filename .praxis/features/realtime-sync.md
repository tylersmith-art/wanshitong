# Real-Time Sync

When one client writes data, all connected clients see the update instantly. This uses Postgres LISTEN/NOTIFY piped through tRPC WebSocket subscriptions — no polling, no Redis, no extra infrastructure.

## How It Works

```
Client A mutation
  → API writes to DB
  → API publishes SyncEvent via Postgres NOTIFY
  → PgPubSub dispatches to all subscribers
  → tRPC subscription yields event to all connected WebSocket clients
  → Client B's hook receives event, updates React Query cache
```

Key files:
- `api/src/pubsub.ts` — PgPubSub class wrapping Postgres LISTEN/NOTIFY
- `api/src/lib/iterateEvents.ts` — async generator bridging PubSub into tRPC subscriptions
- `shared/src/schemas/sync.ts` — SyncEvent and SyncAction types
- `hooks/src/hooks/useUsers.ts` — client-side cache updates on sync events

## Example: The User Sync (Already Implemented)

### API side

```typescript
// packages/api/src/routers/user.ts

// Subscription — listens for sync events
onSync: publicProcedure.subscription(async function* ({ ctx, signal }) {
  for await (const event of iterateEvents<SyncEvent<User>>(
    ctx.pubsub,
    syncChannel("user"),  // → "sync:user"
    signal!,
  )) {
    yield tracked(String(++eventId), event);
  }
}),

// Mutations — each publishes a sync event after writing

create: protectedProcedure
  .input(CreateUserSchema)
  .mutation(async ({ ctx, input }) => {
    const [user] = await ctx.db.insert(users).values({ ...input, role: "user" }).returning();

    await ctx.pubsub.publish(syncChannel("user"), {
      action: "created",
      data: user,
      timestamp: Date.now(),
    } satisfies SyncEvent<typeof user>);

    return user;
  }),

touch: protectedProcedure
  .input(CreateUserSchema.pick({ email: true }))
  .mutation(async ({ ctx, input }) => {
    const [user] = await ctx.db
      .update(users)
      .set({ lastLoginAt: new Date() })
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
```

### Client side

```typescript
// packages/hooks/src/hooks/useUsers.ts
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

useSyncSubscription<SerializedUser>(trpc.user.onSync, {
  onCreated: (data) =>
    utils.user.list.setData(undefined, (old) =>
      old ? [...old, data] : [data]
    ),
  onUpdated: (data) =>
    utils.user.list.setData(undefined, (old) =>
      old ? old.map((u) => (u.id === data.id ? data : u)) : old
    ),
  onDeleted: () => {
    utils.user.list.invalidate();
  },
});
```

### Date Serialization

When data travels over the wire as JSON, `Date` objects are automatically serialized to ISO 8601 strings. The server-side Zod schema defines fields like `createdAt` as `z.date()`, but by the time data reaches the client via tRPC (either through queries or sync events), these become strings.

Client hook type definitions reflect this: `SerializedUser` declares `createdAt: string` and `lastLoginAt: string | null`. This is why the client type is defined manually rather than inferred from the Zod schema -- the wire format differs from the server type. No custom transformer is needed; tRPC handles the JSON serialization transparently.

## How to Implement for a New Entity

> **Note:** The example below uses `Post`, `PostSchema`, and `CreatePostSchema` as hypothetical types. These don't exist in `@wanshitong/shared` yet -- you'd create them by following [Adding Entities](./adding-entities.md) first. The code below shows what the router and hook would look like after you've defined your entity schemas.

### 1. Add the subscription to your router

After creating your entity schemas (see [adding-entities.md](./adding-entities.md)), the router would look like:

```typescript
// Create: packages/api/src/routers/post.ts
import { tracked } from "@trpc/server";
import { syncChannel, type SyncEvent, type Post } from "@wanshitong/shared";
import { iterateEvents } from "../lib/iterateEvents.js";

let eventId = 0;

export const postRouter = router({
  onSync: publicProcedure.subscription(async function* ({ ctx, signal }) {
    for await (const event of iterateEvents<SyncEvent<Post>>(
      ctx.pubsub,
      syncChannel("post"),
      signal!,
    )) {
      yield tracked(String(++eventId), event);
    }
  }),

  create: protectedProcedure
    .input(CreatePostSchema)
    .mutation(async ({ ctx, input }) => {
      const [post] = await ctx.db.insert(posts).values(input).returning();
      await ctx.pubsub.publish(syncChannel("post"), {
        action: "created",
        data: post,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof post>);
      return post;
    }),
});
```

### 2. Subscribe in your client hook

```typescript
// Create: packages/hooks/src/hooks/usePosts.ts
export function usePosts() {
  const utils = trpc.useUtils();
  const listQuery = trpc.post.list.useQuery();

  trpc.post.onSync.useSubscription(undefined, {
    onData(event) {
      const { action, data } = event.data as unknown as SyncEvent<SerializedPost>;
      switch (action) {
        case "created":
          utils.post.list.setData(undefined, (old) => old ? [...old, data] : [data]);
          break;
        case "deleted":
          utils.post.list.invalidate();
          break;
      }
    },
  });

  return { posts: listQuery.data ?? [], isLoading: listQuery.isLoading };
}
```

### Alternative: Use the generic `useSyncSubscription` hook

`useSyncSubscription` is already generic -- it accepts any tRPC subscription procedure as its first argument:

```typescript
// Signature from packages/hooks/src/lib/useSyncSubscription.ts
function useSyncSubscription<T>(
  subscription: SyncSubscriptionHook,
  updaters: CacheUpdater<T>,
): void
```

For a new entity, pass the corresponding subscription procedure:

```typescript
import { useSyncSubscription } from "@wanshitong/hooks";

useSyncSubscription<Post>(trpc.post.onSync, {
  onCreated: (post) => utils.post.list.setData(undefined, (old) => [...(old ?? []), post]),
  onUpdated: (post) => utils.post.list.setData(undefined, (old) =>
    old ? old.map((p) => (p.id === post.id ? post : p)) : old
  ),
  onDeleted: () => utils.post.list.invalidate(),
});
```

## How to Test

Sync events are just pubsub publishes. Test that mutations call `ctx.pubsub.publish`:

```typescript
it("create publishes sync event", async () => {
  const mockPubsub = { publish: vi.fn().mockResolvedValue(undefined) };
  const caller = appRouter.createCaller({
    user: { sub: "u1", email: "test@test.com" },
    db: mockDb as any,
    pubsub: mockPubsub as any,
  });

  await caller.post.create({ title: "Hello", body: "World" });

  expect(mockPubsub.publish).toHaveBeenCalledWith(
    "sync:post",
    expect.objectContaining({ action: "created" }),
  );
});
```

## How to Debug

- **Events not arriving?** Check the WebSocket connection in browser DevTools (Network → WS tab). You should see the tRPC subscription frame. If the connection drops, check CORS and that the WS URL resolves correctly.
- **Stale cache after sync?** Make sure your `setData` callback returns a new array, not a mutation of the old one. React Query uses reference equality.
- **Events from other server instances?** PgPubSub uses Postgres NOTIFY, which broadcasts across all connections to the same database. Multi-instance works out of the box.
- **Subscription never yields?** Check that your mutation actually calls `ctx.pubsub.publish()` and that the channel names match (`syncChannel("entity")` on both sides).
