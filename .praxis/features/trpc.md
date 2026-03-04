# tRPC (End-to-End Type Safety)

Types flow from Zod schemas through API routers to React Query hooks. You never write API types by hand — change a schema and the compiler tells you everywhere that needs updating.

## How It's Wired

```
packages/shared    →  Zod schemas (source of truth)
packages/api       →  tRPC routers use schemas as .input()
packages/hooks     →  typed tRPC client + React Query hooks
packages/web       →  imports hooks, gets full autocomplete
packages/mobile    →  same hooks, same types
```

The tRPC client is configured in `hooks/src/providers/TRPCProvider.tsx` with a split link: HTTP batch for queries/mutations, WebSocket for subscriptions. Tokens are attached automatically.

## Three Procedure Types

Simplified overview (see actual implementations in the referenced files):

```typescript
// packages/api/src/trpc.ts
export const publicProcedure = t.procedure;                         // no auth
export const protectedProcedure = t.procedure.use(/* auth + dbUser lookup */); // JWT required, resolves ctx.dbUser from sub

// packages/api/src/middleware/requireRole.ts
export const adminProcedure = protectedProcedure.use(/* role check */);     // JWT + admin role via ctx.dbUser
```

`protectedProcedure` does two things: verifies `ctx.user` exists (JWT is valid), then looks up the user in the `users` table by `sub` claim and attaches the result as `ctx.dbUser` (or `null` if not found).

## How to Implement a New Endpoint

### 1. Define the schema

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

Re-export from `packages/shared/src/schemas/index.ts`.

### 2. Create the router

```typescript
// packages/api/src/routers/post.ts
import { CreatePostSchema } from "@wanshitong/shared";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import { posts } from "../db/schema.js";

export const postRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(posts).orderBy(posts.createdAt);
  }),

  create: protectedProcedure
    .input(CreatePostSchema)
    .mutation(async ({ ctx, input }) => {
      const [post] = await ctx.db
        .insert(posts)
        .values({ ...input, authorId: ctx.user.sub })
        .returning();
      return post;
    }),
});
```

### 3. Wire it in

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

### 4. Use from the client

```typescript
// in any React component
import { trpc } from "@wanshitong/hooks";

function Posts() {
  const { data: posts } = trpc.post.list.useQuery();
  const create = trpc.post.create.useMutation();

  // full autocomplete on posts, create.mutate({ title, body }), etc.
}
```

## How to Test

Router tests use `createCaller()` to call procedures directly without HTTP:

```typescript
// packages/api/src/routers/post.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../db/index.js", () => ({ getConnectionString: vi.fn(() => "mock"), getDb: vi.fn(() => ({})) }));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock"),
  jwtVerify: vi.fn().mockResolvedValue({
    payload: { sub: "user1", email: "test@test.com" },
    protectedHeader: { alg: "RS256" },
  }),
}));

import { appRouter } from "./index.js";

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockResolvedValue([]),
};

it("list returns posts", async () => {
  const caller = appRouter.createCaller({
    user: null,
    db: mockDb as any,
    pubsub: {} as any,
  });
  const result = await caller.post.list();
  expect(result).toEqual([]);
});
```

## How to Debug

- **Type errors in the client?** The type chain is: schema → router → AppRouter type → hooks. Check that your router is added to `appRouter` in `routers/index.ts` and that `@wanshitong/shared` is rebuilt (`pnpm build --filter=@wanshitong/shared`).
- **"Procedure not found" at runtime?** Rebuild: `pnpm build`. The hooks package imports types from the API build output.
- **Input validation fails?** tRPC uses your Zod schema's `.parse()`. Check the error's `issues` array for field-level messages.
- **Auth errors?** `protectedProcedure` throws `UNAUTHORIZED` if `ctx.user` is null. Check the Authorization header is being sent (look in TRPCProvider's `headers()` function).
