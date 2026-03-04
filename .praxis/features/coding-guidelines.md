# Coding Guidelines

How code should be written in this project. These aren't theoretical preferences — they're patterns already established in the codebase. Follow them so new code looks like it belongs.

## Functional First

Write functions, not classes. The codebase is almost entirely functional: routers are plain objects, middleware is functions, hooks are functions, handlers are functions, context creation is a factory function. Keep it that way.

### When to use a function

Almost always. If you're adding a new capability, it's a function:

```typescript
// Router — object of functions
export const postRouter = router({
  list: publicProcedure.query(async ({ ctx }) => { ... }),
  create: protectedProcedure.input(CreatePostSchema).mutation(async ({ ctx, input }) => { ... }),
});

// Middleware — function that wraps next()
export const auditedProcedure = protectedProcedure.use(async ({ ctx, path, next }) => { ... });

// Hook — function that composes React Query hooks
export function usePosts() { ... }

// Job handler — function registered with pg-boss
export async function registerCleanupHandler(boss: PgBoss): Promise<void> { ... }

// Utility — plain function
export function syncChannel(entity: string): string {
  return `sync:${entity}`;
}
```

### When to use a factory function (closure)

When you need to create something that holds configuration or state, use a factory function instead of a class. The returned object or function closes over its config:

```typescript
// Factory that returns an object conforming to an interface
export function createSendGridAdapter(config: {
  apiKey: string;
  fromAddress: string;
}): EmailAdapter {
  return {
    async send(params) {
      // config.apiKey available via closure
      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        // ...
      });
      // ...
    },
  };
}

// Factory that returns a function
export function createContextFactory(pubsub: PgPubSub) {
  return async function createContext({ req }: CreateExpressContextOptions): Promise<Context> {
    // pubsub available via closure
    return { user, db, pubsub };
  };
}
```

### When a class is acceptable

Classes are fine when the thing genuinely manages long-lived mutable state with lifecycle methods (connect, subscribe, close). The codebase has one example: `PgPubSub`, which manages Postgres LISTEN connections and subscriber tracking. That's a class because it has a connection pool, a map of active subscriptions, and cleanup logic that needs to run in order.

If your thing has `start()`/`stop()`, `connect()`/`close()`, or `subscribe()`/`unsubscribe()` — a class is reasonable. If it just does one thing with some config, use a factory function.

---

## Types

### Zod schemas are the source of truth

Define the shape once in a Zod schema. Derive the TypeScript type from it with `z.infer`. Never define a type manually when a schema exists:

```typescript
// YES — single source of truth
export const CreatePostSchema = z.object({
  title: z.string().min(1, "Title is required"),
  body: z.string().min(1, "Body is required"),
});
export type CreatePost = z.infer<typeof CreatePostSchema>;

// NO — duplicated shape, will drift
export interface CreatePost {
  title: string;
  body: string;
}
```

### When to use plain types (no schema)

Internal types that never cross a system boundary — never validated against user input, never sent over the wire — don't need a Zod schema. A plain `type` or `interface` is fine:

```typescript
// Internal — only used within the API package
type Handler = (data: unknown) => void;

// Serialized shape — what the client actually receives over the wire
type SerializedUser = { id: string; name: string; email: string; role: string; createdAt: string };
```

### `type` vs `interface`

Use `type` for everything. The codebase doesn't use `interface` except where a library requires it (Express middleware signatures). `type` is more flexible (unions, intersections, mapped types) and there's no practical benefit to `interface` in this codebase.

```typescript
// YES
type EmailAdapter = {
  send(params: SendEmailParams): Promise<SendEmailResult>;
};

// Also fine (for function signatures)
type Handler = (data: unknown) => void;
```

---

## Functions

### Named exports, no default exports

Every file uses named exports. This makes imports greppable and refactor-safe. This applies to the `api`, `shared`, `hooks`, and `web` packages. The `mobile` package is the exception — Expo Router requires default exports for route files.

```typescript
// YES
export function useUsers() { ... }
export const userRouter = router({ ... });

// NO
export default function useUsers() { ... }
```

### Function declarations for top-level, arrow functions for inline

Top-level functions use the `function` keyword. Callbacks and inline handlers use arrows:

```typescript
// Top-level — function declaration
export function syncChannel(entity: string): string {
  return `sync:${entity}`;
}

// Inline — arrow function
const staleUsers = users.filter((u) => u.lastLogin < cutoff);

// Callback — arrow function
await boss.work(JOB_NAME, async ([job]) => {
  // ...
});
```

### Keep functions small and single-purpose

If a function does multiple things, split it. The router handlers are a good example — each procedure does one thing:

```typescript
// Each procedure is a focused operation
list: publicProcedure.query(/* one query */),
create: protectedProcedure.mutation(/* one insert + one publish */),
delete: protectedProcedure.mutation(/* one delete + one publish */),
```

If a handler grows beyond ~30 lines, extract the business logic into a helper function in the same file.

---

## Error Handling

### At system boundaries: validate with Zod, throw TRPCError

User input is validated by Zod schemas via `.input()`. If validation fails, tRPC automatically returns a `BAD_REQUEST` error. For business logic errors, throw `TRPCError` with the right code:

```typescript
// Zod handles input validation — you don't need to check manually
create: protectedProcedure
  .input(CreatePostSchema)  // invalid input → automatic BAD_REQUEST
  .mutation(async ({ ctx, input }) => {
    // Business logic errors — use TRPCError
    const [existing] = await ctx.db.select().from(posts).where(eq(posts.id, input.id)).limit(1);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
    if (existing.authorEmail !== ctx.user.email) throw new TRPCError({ code: "FORBIDDEN" });
  }),
```

### Inside the API: return result objects, don't throw

Functions that can fail (external API calls, file operations) should return a result object. Let the caller decide how to handle failure:

```typescript
// YES — caller decides
async send(params: SendEmailParams): Promise<SendEmailResult> {
  if (!response.ok) {
    return { success: false, error: `API error: ${response.status}` };
  }
  return { success: true, messageId };
}

// NO — forces caller to try/catch
async send(params: SendEmailParams): Promise<string> {
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return messageId;
}
```

The exception is tRPC procedures, which use `TRPCError` because that's how tRPC communicates errors to the client.

### Never leak internals to the client

Log the details server-side, send a generic message to the client:

```typescript
// YES
logger.error({ err, userId: input.userId }, "Failed to send welcome email");
throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to send email" });

// NO — leaks stack trace, internal structure
throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.stack });
```

---

## File Organization

### One concept per file

Each file exports one main thing — a router, a hook, an adapter, a middleware. Small helpers used only by that file live in the same file. Shared helpers get their own file in `lib/`.

```
routers/user.ts         ← one router
routers/post.ts         ← one router
hooks/useUsers.ts       ← one hook
hooks/usePosts.ts       ← one hook
middleware/rateLimit.ts  ← related limiters
middleware/requireRole.ts← one procedure type
services/<provider>/     ← one adapter per service (see adding-external-services.md for the pattern)
```

### Keep files under 500 lines

If a file grows past 500 lines, split it. Routers that get too large usually mean the entity is doing too many things — consider splitting into sub-routers.

### Colocate tests

Tests live next to the code they test:

```
routers/user.ts
routers/user.test.ts
middleware/auth.ts
middleware/auth.test.ts
schemas/user.ts
schemas/user.test.ts
```

### Import order

1. Node built-ins (`node:crypto`, `node:http`)
2. External packages (`drizzle-orm`, `@trpc/server`, `zod`)
3. Internal packages (`@template/shared`, `@template/hooks`)
4. Relative imports (`./schema.js`, `../lib/logger.js`)

Blank line between each group. The codebase already follows this pattern — keep it consistent.

---

## Naming

### Files

- **Lowercase with camelCase**: `requestLogger.ts`, `iterateEvents.ts`, `requireRole.ts`
- **React components**: PascalCase file matching component name: `NavBar.tsx`, `AuthGuard.tsx`
- **Schemas**: named after the entity: `user.ts`, `sync.ts`, `post.ts`

### Variables and functions

- **camelCase**: `createPost`, `getEmailAdapter`, `syncChannel`
- **Constants**: `UPPER_SNAKE_CASE` for job names and string constants: `EXAMPLE_JOB`, `SEND_EMAIL_JOB`
- **Booleans**: prefix with `is`, `has`, `can`: `isLoading`, `isCreating`, `isAuthenticated`

### Types

- **PascalCase**: `User`, `CreatePost`, `SyncEvent`, `EmailAdapter`
- **Schema suffix**: `CreateUserSchema`, `PostSchema`, `SyncEventSchema`
- **Serialized types**: prefix with `Serialized`: `SerializedUser`, `SerializedPost`

### Procedures and routes

- **Procedure types**: named after what they require: `protectedProcedure`, `adminProcedure`
- **Router methods**: verb for mutations (`create`, `delete`, `update`), noun for queries (`list`, `get`). Domain-specific verbs like `claimAdmin` or `touch` are acceptable when standard CRUD verbs don't fit the semantics. Subscriptions use the `on` prefix (e.g., `onSync`).
- **Routes**: plural nouns: `/users`, `/posts`, `/admin`

---

## Patterns to Follow

### Idempotent operations

Seeds, migrations, scheduled jobs, and any operation that could run twice should produce the same result:

```typescript
// Check before inserting
const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
if (existing.length === 0) {
  await db.insert(users).values({ ... });
}
```

### Configuration via factory, not globals

Don't read env vars or config deep in business logic. Accept configuration via function parameters or factory injection:

```typescript
// YES — config injected via factory
export function createContextFactory(pubsub: PgPubSub) {
  return async function createContext({ req }) { ... };
}

// YES — config via constructor/parameter
export function createSendGridAdapter(config: { apiKey: string }) { ... }

// NO — reading env deep in business logic
async send(params) {
  const apiKey = process.env.SENDGRID_API_KEY!;  // hard to test, hidden dependency
}
```

The only files that read `process.env` directly: `src/lib/env.ts` (validation) and `drizzle.config.ts` (Drizzle CLI config). Standalone scripts (`db/seed.ts`, `db/migrate.ts`) also read `DATABASE_URL` from `process.env` since they run outside the main server. All other files use the validated `getEnv()` accessor — including `src/index.ts`, `src/db/index.ts`, `middleware/auth.ts`, `middleware/rateLimit.ts`, and `lib/logger.ts`.

### Explicit over implicit

Prefer explicit parameters over global state. If a function needs the database, pass it as a parameter (via `ctx.db`) instead of importing a global instance. The one exception is scheduled job handlers, which import `db` directly because they run outside of tRPC context.

---

## Patterns to Avoid

### Unnecessary abstraction

Don't create a helper for something used once. Three similar lines are better than a premature abstraction:

```typescript
// YES — clear, inline, no indirection
const [user] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
if (!user) throw new TRPCError({ code: "NOT_FOUND" });

// NO — abstraction that hides a simple query
const user = await findUserOrThrow(ctx.db, email);
```

Extract when the same logic appears in three or more places.

### Type assertions on things you control

If you need `as any` or `as unknown` to make your own code compile, the types are wrong. Fix the types. The one acceptable use is at the boundary between libraries with incompatible types (e.g., `mockDb as any` in tests). Assertions on externally-provided types at auth boundaries are also acceptable — the `jose` library types JWT `JWTPayload` properties as `unknown` for custom claims, so `ctx.user?.email as string | undefined` is fine.

### Defensive checks for impossible states

Don't validate things that can't happen given the type system and middleware chain:

```typescript
// NO — protectedProcedure already guarantees ctx.user exists
create: protectedProcedure.mutation(async ({ ctx }) => {
  if (!ctx.user) throw new Error("impossible");
  // ...
});

// YES — just use it, the middleware guarantees it
create: protectedProcedure.mutation(async ({ ctx }) => {
  const email = ctx.user.email as string;
  // ...
});
```

Checking properties extracted from external types like JWT claims is acceptable even after middleware guarantees. `protectedProcedure` guarantees `ctx.user` exists, but the `JWTPayload` type from `jose` doesn't guarantee that `ctx.user.email` is a string (or present at all), so validating individual claim properties is reasonable.

### Catching errors you can't handle

Don't wrap things in try/catch if you're just going to re-throw or log and continue. Let errors propagate to the layer that can actually handle them:

```typescript
// NO — catch and re-throw adds nothing
try {
  const [user] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1);
} catch (err) {
  throw err;
}

// YES — let it propagate, tRPC catches unhandled errors
const [user] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1);
```

---

## Related

- [Adding Middleware](./adding-middleware.md) — Express vs tRPC middleware, creating procedure types
- [Adding an External Service](./adding-external-services.md) — Adapter pattern with factory functions
- [tRPC](./trpc.md) — Procedure types, router structure, type flow
- [Testing](./testing.md) — Mocking patterns, test file organization
