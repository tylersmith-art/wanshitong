# Adding a New Entity

Step-by-step guide for adding a new data entity (table, types, API, frontend, real-time sync, tests). This is the most common workflow — follow it top to bottom whenever you add something like posts, comments, projects, invoices, etc.

This guide uses "posts" as the example. Replace with your entity name throughout.

> **Note:** This is a step-by-step guide for future implementation. The example code shown below does not exist in the codebase yet -- it is a worked example. To add a new entity, follow the steps below and create each file as described.

## Overview of Files You'll Touch

```
packages/shared/src/schemas/post.ts       ← Zod schemas (source of truth for types)
packages/shared/src/schemas/index.ts      ← Re-export new schemas
packages/api/src/db/schema.ts             ← Drizzle table definition
packages/api/src/routers/post.ts          ← tRPC router (CRUD + sync)
packages/api/src/routers/index.ts         ← Wire router into appRouter
packages/hooks/src/hooks/usePosts.ts      ← React Query hook with real-time sync
packages/hooks/src/index.ts               ← Re-export the hook
packages/web/src/views/Posts.tsx           ← Frontend view
packages/web/src/App.tsx                   ← Route
packages/web/src/components/NavBar.tsx     ← Nav link
packages/shared/src/schemas/post.test.ts  ← Schema tests
packages/api/src/routers/post.test.ts     ← Router tests
```

---

## Step 1: Define the Zod Schemas

This is the source of truth. Every other layer derives its types from here.

```typescript
// packages/shared/src/schemas/post.ts
import { z } from "zod";

export const CreatePostSchema = z.object({
  title: z.string().min(1, "Title is required"),
  body: z.string().min(1, "Body is required"),
});

export const PostSchema = CreatePostSchema.extend({
  id: z.string().uuid(),
  authorId: z.string().uuid(),
  createdAt: z.date(),
});

export type Post = z.infer<typeof PostSchema>;
export type CreatePost = z.infer<typeof CreatePostSchema>;
```

Then re-export from the barrel:

```typescript
// packages/shared/src/schemas/index.ts — add these lines
export {
  CreatePostSchema,
  PostSchema,
  type Post,
  type CreatePost,
} from "./post.js";
```

Rebuild shared so downstream packages see the new types:

```bash
pnpm build --filter=@template/shared
```

> **Why Zod?** The schemas serve triple duty: runtime validation on API inputs, TypeScript types via `z.infer`, and documentation of the data shape. Change the schema and the compiler tells you everywhere that needs updating.

See [tRPC](./trpc.md) for more on how schemas flow through the type system.

---

## Step 2: Define the Database Table

```typescript
// packages/api/src/db/schema.ts — add below the users table
export const posts = pgTable("posts", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  body: varchar("body", { length: 10000 }).notNull(),
  authorId: uuid("author_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

Generate and apply the migration:

```bash
pnpm db:generate   # creates SQL migration in packages/api/drizzle/
pnpm db:migrate    # applies it to Postgres
```

**Keep the Drizzle schema and Zod schema aligned.** The Drizzle table is what Postgres sees; the Zod schema is what the API and clients see. They don't have to be identical (the Zod schema might omit internal columns or transform types), but the fields clients interact with should match.

See [Database](./database.md) for more on Drizzle queries, migrations, and seed data.

---

## Step 3: Create the tRPC Router

```typescript
// packages/api/src/routers/post.ts
import { z } from "zod";
import { eq } from "drizzle-orm";
import { tracked, TRPCError } from "@trpc/server";
import {
  CreatePostSchema,
  syncChannel,
  type SyncEvent,
  type Post,
} from "@template/shared";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import { posts } from "../db/schema.js";
import { iterateEvents } from "../lib/iterateEvents.js";

let eventId = 0;

export const postRouter = router({
  // READ — public, no auth required
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(posts).orderBy(posts.createdAt);
  }),

  // REAL-TIME — public subscription for live updates
  onSync: publicProcedure.subscription(async function* ({ ctx, signal }) {
    for await (const event of iterateEvents<SyncEvent<Post>>(
      ctx.pubsub,
      syncChannel("post"),
      signal!,
    )) {
      yield tracked(String(++eventId), event);
    }
  }),

  // CREATE — requires authentication
  create: protectedProcedure
    .input(CreatePostSchema)
    .mutation(async ({ ctx, input }) => {
      const [post] = await ctx.db
        .insert(posts)
        .values({ ...input, authorId: ctx.user.sub })
        .returning();

      // Broadcast to all connected clients
      await ctx.pubsub.publish(syncChannel("post"), {
        action: "created",
        data: post,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof post>);

      return post;
    }),

  // DELETE — requires authentication
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await ctx.db
        .delete(posts)
        .where(eq(posts.id, input.id))
        .returning();

      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post not found" });
      }

      await ctx.pubsub.publish(syncChannel("post"), {
        action: "deleted",
        data: deleted,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof deleted>);

      return { success: true };
    }),
});
```

#### Update Mutations

Many entities need an update mutation beyond create and delete. The user router includes a `touch` mutation that updates a single field:

```typescript
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
```

For full entity updates, use `UpdateEntitySchema` (a partial of the create schema plus the entity ID) as the input, and `.set()` only the fields provided.

Wire it into the app router:

```typescript
// packages/api/src/routers/index.ts
import { postRouter } from "./post.js";

export const appRouter = router({
  user: userRouter,
  admin: adminRouter,
  jobs: jobsRouter,
  post: postRouter,  // add here
});
```

**Key decisions:**
- `publicProcedure` vs `protectedProcedure` vs `adminProcedure` — choose based on who should access each operation
- Every mutation that changes data should publish a `SyncEvent` so connected clients stay in sync
- Use `satisfies SyncEvent<typeof post>` for type safety on the published event

See [tRPC](./trpc.md) for procedure types and [Real-Time Sync](./realtime-sync.md) for the pubsub pattern.

---

## Step 3b: Add Role-Based Access (If Needed)

Not every entity needs role restrictions — the basic example above uses `protectedProcedure` (any logged-in user) for writes and `publicProcedure` for reads. But if your entity needs admin-only operations or owner-only access, here's how.

### Admin-only operations

Import `adminProcedure` from `middleware/requireRole.ts` and use it instead of `protectedProcedure`:

```typescript
// packages/api/src/routers/post.ts
import { adminProcedure } from "../middleware/requireRole.js";

export const postRouter = router({
  list: publicProcedure.query(/* ... */),           // anyone can read
  create: protectedProcedure.mutation(/* ... */),    // any logged-in user can create
  delete: adminProcedure.mutation(/* ... */),         // only admins can delete
});
```

`adminProcedure` does everything `protectedProcedure` does (JWT required) plus it looks up the caller's email in the `users` table and checks `role === "admin"`. If the check fails, it throws `FORBIDDEN`.

### Owner-only operations

For operations where a user should only modify their own records (e.g., "only the author can edit their post"), add an ownership check inside the procedure:

```typescript
update: protectedProcedure
  .input(UpdatePostSchema)
  .mutation(async ({ ctx, input }) => {
    // Fetch the existing record
    const [existing] = await ctx.db
      .select()
      .from(posts)
      .where(eq(posts.id, input.id))
      .limit(1);

    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }

    // Check ownership (admins bypass)
    const email = ctx.user.email as string;
    const [dbUser] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.authorId !== ctx.user.sub && dbUser?.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "You can only edit your own posts" });
    }

    const [updated] = await ctx.db
      .update(posts)
      .set({ title: input.title, body: input.body })
      .where(eq(posts.id, input.id))
      .returning();

    await ctx.pubsub.publish(syncChannel("post"), {
      action: "updated",
      data: updated,
      timestamp: Date.now(),
    } satisfies SyncEvent<typeof updated>);

    return updated;
  }),
```

### Mixed access patterns

A common pattern is different access levels per operation:

| Operation | Procedure | Who can do it |
|---|---|---|
| `list` | `publicProcedure` | Anyone |
| `create` | `protectedProcedure` | Any logged-in user |
| `update` | `protectedProcedure` + ownership check | Author or admin |
| `delete` | `adminProcedure` | Admins only |

### Handling FORBIDDEN on the client

When a procedure throws `FORBIDDEN`, the tRPC error has `data.code === "FORBIDDEN"`. Handle it in the UI:

```typescript
const { data, error } = trpc.post.list.useQuery();

if (error?.data?.code === "FORBIDDEN") {
  return <div>You don't have permission to view this.</div>;
}
```

The Admin view (`packages/web/src/views/Admin.tsx`) already demonstrates this pattern — it shows a "Claim Admin" button when the listUsers query returns FORBIDDEN.

See [Roles & Permissions](./roles-permissions.md) for adding custom roles, creating new procedure middlewares, and the full admin panel setup.

---

## Step 4: Create the Client Hook

```typescript
// packages/hooks/src/hooks/usePosts.ts
import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedPost = {
  id: string;
  title: string;
  body: string;
  authorId: string;
  createdAt: string;  // dates serialize as strings over the wire
};

export function usePosts() {
  const utils = trpc.useUtils();
  const listQuery = trpc.post.list.useQuery();

  // Subscribe to real-time sync events using the shared helper
  useSyncSubscription<SerializedPost>(trpc.post.onSync, {
    onCreated: (data) =>
      utils.post.list.setData(undefined, (old) =>
        old ? [...old, data] : [data],
      ),
    onUpdated: (data) =>
      utils.post.list.setData(undefined, (old) =>
        old ? old.map((p) => (p.id === data.id ? data : p)) : old,
      ),
    onDeleted: () => {
      utils.post.list.invalidate();
    },
  });

  const createMutation = trpc.post.create.useMutation({
    onSuccess: () => utils.post.list.invalidate(),
  });
  const deleteMutation = trpc.post.delete.useMutation({
    onSuccess: () => utils.post.list.invalidate(),
  });

  return {
    posts: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    createPost: createMutation.mutateAsync,
    deletePost: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
```

Re-export from the hooks barrel:

```typescript
// packages/hooks/src/index.ts — add this line
export { usePosts } from "./hooks/usePosts.js";
```

**Why `useSyncSubscription` instead of raw `useSubscription`?** The `useSyncSubscription` helper (in `packages/hooks/src/lib/useSyncSubscription.ts`) wraps tRPC's `useSubscription` and dispatches `SyncEvent` actions to typed callbacks (`onCreated`, `onUpdated`, `onDeleted`). It eliminates the boilerplate switch statement and keeps every entity hook consistent.

**Why `SerializedPost` instead of the Zod `Post` type?** Dates come over the wire as ISO strings, not `Date` objects. The serialized type matches what tRPC actually delivers. The Zod schema defines the canonical shape; the serialized type is what the client works with.

**Why both `onSync` and `onSuccess: invalidate()`?** The sync subscription handles updates from _other_ clients. The `onSuccess` invalidation handles the current client's own mutations as a fallback (in case the WebSocket event arrives late or the subscription isn't active).

See [Real-Time Sync](./realtime-sync.md) for more on the subscription pattern.

---

## Step 5: Build the Frontend View

```tsx
// packages/web/src/views/Posts.tsx
import { useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { usePosts } from "@template/hooks";

export function Posts() {
  const { isAuthenticated } = useAuth0();
  const { posts, isLoading, error, createPost, isCreating } = usePosts();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !body) return;
    await createPost({ title, body });
    setTitle("");
    setBody("");
  };

  return (
    <div className="max-w-[700px] mx-auto">
      <h1 className="text-2xl font-bold mb-1">Posts</h1>
      <p className="text-gray-500 mb-8">Real-time synced across all clients.</p>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded mb-4">{error}</div>
      )}

      {isAuthenticated ? (
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Create Post</h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              required
              className="px-3 py-2 border border-gray-300 rounded text-sm"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Body"
              required
              rows={3}
              className="px-3 py-2 border border-gray-300 rounded text-sm"
            />
            <button
              type="submit"
              disabled={isCreating}
              className="self-end px-5 py-2 bg-indigo-600 text-white rounded text-sm cursor-pointer disabled:opacity-60"
            >
              {isCreating ? "Creating..." : "Create"}
            </button>
          </form>
        </div>
      ) : (
        <p className="text-gray-400 italic mb-8">Log in to create posts.</p>
      )}

      <h2 className="text-lg font-semibold mb-4">All Posts</h2>
      {isLoading ? (
        <p className="text-gray-400 text-center p-8">Loading...</p>
      ) : posts.length ? (
        <div className="space-y-4">
          {posts.map((post) => (
            <div key={post.id} className="bg-white border border-gray-200 rounded-lg p-4">
              <h3 className="font-semibold">{post.title}</h3>
              <p className="text-gray-600 text-sm mt-1">{post.body}</p>
              <p className="text-gray-400 text-xs mt-2">
                {post.authorId} &middot; {new Date(post.createdAt).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-gray-400 text-center p-8">No posts yet.</p>
      )}
    </div>
  );
}
```

Add the route and nav link:

```typescript
// packages/web/src/App.tsx — add import and route
import { Posts } from "./views/Posts.js";

<Route path="/posts" element={<Posts />} />
```

```typescript
// packages/web/src/components/NavBar.tsx — add link alongside Users
<Link
  to="/posts"
  className={`no-underline font-medium ${isActive("/posts") ? "text-gray-900" : "text-gray-500"}`}
>
  Posts
</Link>
```

See [Web App](./web-app.md) for styling patterns, AuthGuard, and routing.

---

## Step 6: Add Seed Data (Optional)

```typescript
// packages/api/src/db/seed.ts — add to the seed script
const seedPosts = [
  { title: "Welcome", body: "First post in the system.", authorId: "550e8400-e29b-41d4-a716-446655440000" },
  { title: "Getting Started", body: "Here's how to use the app.", authorId: "660e8400-e29b-41d4-a716-446655440000" },
];

for (const post of seedPosts) {
  const existing = await db.select().from(posts).where(eq(posts.title, post.title)).limit(1);
  if (existing.length === 0) {
    await db.insert(posts).values(post);
    console.log(`  Created post: ${post.title}`);
  } else {
    console.log(`  Skipped post: ${post.title} (already exists)`);
  }
}
```

Don't forget to import `posts` from the schema at the top of the seed file.

See [Database](./database.md) for more on seeding.

---

## Step 7: Write Tests

### Schema tests

```typescript
// packages/shared/src/schemas/post.test.ts
import { describe, it, expect } from "vitest";
import { CreatePostSchema, PostSchema } from "./post.js";

describe("CreatePostSchema", () => {
  it("accepts valid input", () => {
    const result = CreatePostSchema.safeParse({ title: "Hello", body: "World" });
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = CreatePostSchema.safeParse({ title: "", body: "World" });
    expect(result.success).toBe(false);
  });

  it("rejects missing body", () => {
    const result = CreatePostSchema.safeParse({ title: "Hello" });
    expect(result.success).toBe(false);
  });
});

describe("PostSchema", () => {
  it("accepts valid post", () => {
    const result = PostSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      title: "Hello",
      body: "World",
      authorId: "550e8400-e29b-41d4-a716-446655440000",
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });
});
```

### Router tests

```typescript
// packages/api/src/routers/post.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/index.js", () => ({
  getConnectionString: vi.fn(() => "postgresql://mock"),
  getDb: vi.fn(() => ({})),
}));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock"),
  jwtVerify: vi.fn().mockResolvedValue({
    payload: { sub: "u1", email: "test@test.com" },
    protectedHeader: { alg: "RS256" },
  }),
}));

import { appRouter } from "./index.js";

const mockPost = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  title: "Test",
  body: "Content",
  authorId: "660e8400-e29b-41d4-a716-446655440000",
  createdAt: new Date(),
};

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockResolvedValue([mockPost]),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([mockPost]),
  delete: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
};

const mockPubsub = {
  publish: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn(),
  close: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.select.mockReturnThis();
  mockDb.from.mockReturnThis();
  mockDb.orderBy.mockResolvedValue([mockPost]);
  mockDb.insert.mockReturnThis();
  mockDb.values.mockReturnThis();
  mockDb.returning.mockResolvedValue([mockPost]);
  mockDb.delete.mockReturnThis();
  mockDb.where.mockReturnThis();
});

describe("postRouter", () => {
  it("list returns posts", async () => {
    const caller = appRouter.createCaller({ user: null, db: mockDb as any, pubsub: mockPubsub as any });
    const result = await caller.post.list();
    expect(result).toEqual([mockPost]);
  });

  it("create requires auth", async () => {
    const caller = appRouter.createCaller({ user: null, db: mockDb as any, pubsub: mockPubsub as any });
    await expect(caller.post.create({ title: "Hi", body: "World" })).rejects.toThrow("UNAUTHORIZED");
  });

  it("create inserts and publishes sync event", async () => {
    const caller = appRouter.createCaller({
      user: { sub: "u1", email: "test@test.com" },
      db: mockDb as any,
      pubsub: mockPubsub as any,
    });
    const result = await caller.post.create({ title: "Hi", body: "World" });
    expect(result).toEqual(mockPost);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:post",
      expect.objectContaining({ action: "created" }),
    );
  });
});
```

Run all tests to verify:

```bash
pnpm test
```

See [Testing](./testing.md) for mocking patterns and debugging test issues.

---

## Step 8: Build and Verify

```bash
pnpm build       # all packages compile
pnpm typecheck   # no type errors
pnpm test        # all tests pass
```

If everything passes, the entity is fully integrated. Start the dev server (`pnpm dev`) and verify the UI works end-to-end.

---

## Checklist

Use this to make sure you haven't missed a layer:

**Types & Schema**
- [ ] Zod schemas in `packages/shared/src/schemas/` with types exported
- [ ] Schemas re-exported from `packages/shared/src/schemas/index.ts`
- [ ] Drizzle table in `packages/api/src/db/schema.ts`
- [ ] Migration generated (`pnpm db:generate`) and applied (`pnpm db:migrate`)

**API**
- [ ] tRPC router with CRUD operations + `onSync` subscription
- [ ] Router wired into `packages/api/src/routers/index.ts`
- [ ] Correct procedure type per operation (`publicProcedure` / `protectedProcedure` / `adminProcedure`)
- [ ] Owner-only operations check `authorId === ctx.user.sub` (with admin bypass if applicable)
- [ ] Every mutation publishes a `SyncEvent` via `ctx.pubsub.publish()`

**Client**
- [ ] Client hook in `packages/hooks/src/hooks/` with sync subscription
- [ ] Hook re-exported from `packages/hooks/src/index.ts`
- [ ] Frontend view handles `FORBIDDEN` errors gracefully (not just generic error)
- [ ] Frontend view with form (auth-gated) and list
- [ ] Route added in `App.tsx` (with `AuthGuard` wrapper if the page requires login)
- [ ] Nav link added in `NavBar.tsx` (if needed)

**Quality**
- [ ] Schema tests in `packages/shared`
- [ ] Router tests in `packages/api` (including auth and role checks)
- [ ] `pnpm build && pnpm typecheck && pnpm test` passes

---

## Related

- [tRPC](./trpc.md) — Procedure types, router structure, type flow
- [Real-Time Sync](./realtime-sync.md) — PubSub pattern, subscription wiring, cache updates
- [Database](./database.md) — Drizzle queries, migrations, seed data
- [Authentication](./authentication.md) — Protecting procedures, reading `ctx.user`
- [Roles & Permissions](./roles-permissions.md) — Restricting to admin or custom roles
- [Testing](./testing.md) — Mocking patterns for routers, middleware, and schemas
