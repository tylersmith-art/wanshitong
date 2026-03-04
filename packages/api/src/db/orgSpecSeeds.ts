export type OrgSpecSeed = { name: string; description: string; content: string };

export const orgSpecSeeds: OrgSpecSeed[] = [
  {
    name: 'Coding Guidelines',
    description:
      'How code should be written in this project. These are patterns established in the codebase that new code should follow.',
    content: `# Coding Guidelines

How code should be written in this project. These aren't theoretical preferences — they're patterns already established in the codebase. Follow them so new code looks like it belongs.

## Functional First

Write functions, not classes. The codebase is almost entirely functional: routers are plain objects, middleware is functions, hooks are functions, handlers are functions, context creation is a factory function. Keep it that way.

### When to use a function

Almost always. If you're adding a new capability, it's a function:

\`\`\`typescript
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
  return \\\`sync:\\\${entity}\\\`;
}
\`\`\`

### When to use a factory function (closure)

When you need to create something that holds configuration or state, use a factory function instead of a class. The returned object or function closes over its config:

\`\`\`typescript
// Factory that returns an object conforming to an interface
export function createSendGridAdapter(config: {
  apiKey: string;
  fromAddress: string;
}): EmailAdapter {
  return {
    async send(params) {
      // config.apiKey available via closure
      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        headers: { Authorization: \\\`Bearer \\\${config.apiKey}\\\` },
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
\`\`\`

### When a class is acceptable

Classes are fine when the thing genuinely manages long-lived mutable state with lifecycle methods (connect, subscribe, close). Example: a PubSub manager that handles Postgres LISTEN connections and subscriber tracking. That's a class because it has a connection pool, a map of active subscriptions, and cleanup logic that needs to run in order.

If your thing has \\\`start()\\\`/\\\`stop()\\\`, \\\`connect()\\\`/\\\`close()\\\`, or \\\`subscribe()\\\`/\\\`unsubscribe()\\\` — a class is reasonable. If it just does one thing with some config, use a factory function.

---

## Types

### Zod schemas are the source of truth

Define the shape once in a Zod schema. Derive the TypeScript type from it with \\\`z.infer\\\`. Never define a type manually when a schema exists:

\`\`\`typescript
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
\`\`\`

### When to use plain types (no schema)

Internal types that never cross a system boundary — never validated against user input, never sent over the wire — don't need a Zod schema. A plain \\\`type\\\` or \\\`interface\\\` is fine:

\`\`\`typescript
// Internal — only used within the API package
type Handler = (data: unknown) => void;

// Serialized shape — what the client actually receives over the wire
type SerializedUser = { id: string; name: string; email: string; role: string; createdAt: string };
\`\`\`

### \\\`type\\\` vs \\\`interface\\\`

Use \\\`type\\\` for everything. The codebase doesn't use \\\`interface\\\` except where a library requires it (Express middleware signatures). \\\`type\\\` is more flexible (unions, intersections, mapped types) and there's no practical benefit to \\\`interface\\\` in this codebase.

\`\`\`typescript
// YES
type EmailAdapter = {
  send(params: SendEmailParams): Promise<SendEmailResult>;
};

// Also fine (for function signatures)
type Handler = (data: unknown) => void;
\`\`\`

---

## Functions

### Named exports, no default exports

Every file uses named exports. This makes imports greppable and refactor-safe. This applies to all packages. The exception is Expo Router which requires default exports for route files.

\`\`\`typescript
// YES
export function useUsers() { ... }
export const userRouter = router({ ... });

// NO
export default function useUsers() { ... }
\`\`\`

### Function declarations for top-level, arrow functions for inline

Top-level functions use the \\\`function\\\` keyword. Callbacks and inline handlers use arrows:

\`\`\`typescript
// Top-level — function declaration
export function syncChannel(entity: string): string {
  return \\\`sync:\\\${entity}\\\`;
}

// Inline — arrow function
const staleUsers = users.filter((u) => u.lastLogin < cutoff);

// Callback — arrow function
await boss.work(JOB_NAME, async ([job]) => {
  // ...
});
\`\`\`

### Keep functions small and single-purpose

If a function does multiple things, split it. The router handlers are a good example — each procedure does one thing:

\`\`\`typescript
// Each procedure is a focused operation
list: publicProcedure.query(/* one query */),
create: protectedProcedure.mutation(/* one insert + one publish */),
delete: protectedProcedure.mutation(/* one delete + one publish */),
\`\`\`

If a handler grows beyond ~30 lines, extract the business logic into a helper function in the same file.

---

## Error Handling

### At system boundaries: validate with Zod, throw TRPCError

User input is validated by Zod schemas via \\\`.input()\\\`. If validation fails, tRPC automatically returns a \\\`BAD_REQUEST\\\` error. For business logic errors, throw \\\`TRPCError\\\` with the right code:

\`\`\`typescript
// Zod handles input validation — you don't need to check manually
create: protectedProcedure
  .input(CreatePostSchema)  // invalid input -> automatic BAD_REQUEST
  .mutation(async ({ ctx, input }) => {
    // Business logic errors — use TRPCError
    const [existing] = await ctx.db.select().from(posts).where(eq(posts.id, input.id)).limit(1);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
    if (existing.authorEmail !== ctx.user.email) throw new TRPCError({ code: "FORBIDDEN" });
  }),
\`\`\`

### Inside the API: return result objects, don't throw

Functions that can fail (external API calls, file operations) should return a result object. Let the caller decide how to handle failure:

\`\`\`typescript
// YES — caller decides
async send(params: SendEmailParams): Promise<SendEmailResult> {
  if (!response.ok) {
    return { success: false, error: \\\`API error: \\\${response.status}\\\` };
  }
  return { success: true, messageId };
}

// NO — forces caller to try/catch
async send(params: SendEmailParams): Promise<string> {
  if (!response.ok) {
    throw new Error(\\\`API error: \\\${response.status}\\\`);
  }
  return messageId;
}
\`\`\`

The exception is tRPC procedures, which use \\\`TRPCError\\\` because that's how tRPC communicates errors to the client.

### Never leak internals to the client

Log the details server-side, send a generic message to the client:

\`\`\`typescript
// YES
logger.error({ err, userId: input.userId }, "Failed to send welcome email");
throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to send email" });

// NO — leaks stack trace, internal structure
throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.stack });
\`\`\`

---

## File Organization

### One concept per file

Each file exports one main thing — a router, a hook, an adapter, a middleware. Small helpers used only by that file live in the same file. Shared helpers get their own file in \\\`lib/\\\`.

\`\`\`
routers/user.ts         <- one router
routers/post.ts         <- one router
hooks/useUsers.ts       <- one hook
hooks/usePosts.ts       <- one hook
middleware/rateLimit.ts  <- related limiters
middleware/requireRole.ts<- one procedure type
services/<provider>/     <- one adapter per service
\`\`\`

### Keep files under 500 lines

If a file grows past 500 lines, split it. Routers that get too large usually mean the entity is doing too many things — consider splitting into sub-routers.

### Colocate tests

Tests live next to the code they test:

\`\`\`
routers/user.ts
routers/user.test.ts
middleware/auth.ts
middleware/auth.test.ts
schemas/user.ts
schemas/user.test.ts
\`\`\`

### Import order

1. Node built-ins (\\\`node:crypto\\\`, \\\`node:http\\\`)
2. External packages (\\\`drizzle-orm\\\`, \\\`@trpc/server\\\`, \\\`zod\\\`)
3. Internal packages (\\\`@myapp/shared\\\`, \\\`@myapp/hooks\\\`)
4. Relative imports (\\\`./schema.js\\\`, \\\`../lib/logger.js\\\`)

Blank line between each group. The codebase already follows this pattern — keep it consistent.

---

## Naming

### Files

- **Lowercase with camelCase**: \\\`requestLogger.ts\\\`, \\\`iterateEvents.ts\\\`, \\\`requireRole.ts\\\`
- **React components**: PascalCase file matching component name: \\\`NavBar.tsx\\\`, \\\`AuthGuard.tsx\\\`
- **Schemas**: named after the entity: \\\`user.ts\\\`, \\\`sync.ts\\\`, \\\`post.ts\\\`

### Variables and functions

- **camelCase**: \\\`createPost\\\`, \\\`getEmailAdapter\\\`, \\\`syncChannel\\\`
- **Constants**: \\\`UPPER_SNAKE_CASE\\\` for job names and string constants: \\\`EXAMPLE_JOB\\\`, \\\`SEND_EMAIL_JOB\\\`
- **Booleans**: prefix with \\\`is\\\`, \\\`has\\\`, \\\`can\\\`: \\\`isLoading\\\`, \\\`isCreating\\\`, \\\`isAuthenticated\\\`

### Types

- **PascalCase**: \\\`User\\\`, \\\`CreatePost\\\`, \\\`SyncEvent\\\`, \\\`EmailAdapter\\\`
- **Schema suffix**: \\\`CreateUserSchema\\\`, \\\`PostSchema\\\`, \\\`SyncEventSchema\\\`
- **Serialized types**: prefix with \\\`Serialized\\\`: \\\`SerializedUser\\\`, \\\`SerializedPost\\\`

### Procedures and routes

- **Procedure types**: named after what they require: \\\`protectedProcedure\\\`, \\\`adminProcedure\\\`
- **Router methods**: verb for mutations (\\\`create\\\`, \\\`delete\\\`, \\\`update\\\`), noun for queries (\\\`list\\\`, \\\`get\\\`). Domain-specific verbs are acceptable when standard CRUD verbs don't fit the semantics. Subscriptions use the \\\`on\\\` prefix (e.g., \\\`onSync\\\`).
- **Routes**: plural nouns: \\\`/users\\\`, \\\`/posts\\\`, \\\`/admin\\\`

---

## Patterns to Follow

### Idempotent operations

Seeds, migrations, scheduled jobs, and any operation that could run twice should produce the same result:

\`\`\`typescript
// Check before inserting
const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
if (existing.length === 0) {
  await db.insert(users).values({ ... });
}
\`\`\`

### Configuration via factory, not globals

Don't read env vars or config deep in business logic. Accept configuration via function parameters or factory injection:

\`\`\`typescript
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
\`\`\`

The only files that read \\\`process.env\\\` directly: the env validation module and CLI config files. Standalone scripts (seed, migrate) also read \\\`DATABASE_URL\\\` from \\\`process.env\\\` since they run outside the main server. All other files use the validated \\\`getEnv()\\\` accessor.

### Explicit over implicit

Prefer explicit parameters over global state. If a function needs the database, pass it as a parameter (via \\\`ctx.db\\\`) instead of importing a global instance. The one exception is scheduled job handlers, which import \\\`db\\\` directly because they run outside of tRPC context.

---

## Patterns to Avoid

### Unnecessary abstraction

Don't create a helper for something used once. Three similar lines are better than a premature abstraction:

\`\`\`typescript
// YES — clear, inline, no indirection
const [user] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
if (!user) throw new TRPCError({ code: "NOT_FOUND" });

// NO — abstraction that hides a simple query
const user = await findUserOrThrow(ctx.db, email);
\`\`\`

Extract when the same logic appears in three or more places.

### Type assertions on things you control

If you need \\\`as any\\\` or \\\`as unknown\\\` to make your own code compile, the types are wrong. Fix the types. The one acceptable use is at the boundary between libraries with incompatible types (e.g., \\\`mockDb as any\\\` in tests). Assertions on externally-provided types at auth boundaries are also acceptable — the \\\`jose\\\` library types JWT \\\`JWTPayload\\\` properties as \\\`unknown\\\` for custom claims, so \\\`ctx.user?.email as string | undefined\\\` is fine.

### Defensive checks for impossible states

Don't validate things that can't happen given the type system and middleware chain:

\`\`\`typescript
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
\`\`\`

Checking properties extracted from external types like JWT claims is acceptable even after middleware guarantees.

### Catching errors you can't handle

Don't wrap things in try/catch if you're just going to re-throw or log and continue. Let errors propagate to the layer that can actually handle them:

\`\`\`typescript
// NO — catch and re-throw adds nothing
try {
  const [user] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1);
} catch (err) {
  throw err;
}

// YES — let it propagate, tRPC catches unhandled errors
const [user] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1);
\`\`\``,
  },
  {
    name: 'Error Handling',
    description:
      'How errors are thrown, caught, and displayed across the API and client. Covers the three layers: Zod validation, tRPC procedure errors, and client-side React Query handling.',
    content: `# Error Handling

How errors are thrown, caught, and displayed across the API and client. The system has three layers — Zod validation, tRPC procedure errors, and client-side React Query handling — and each layer has a specific job. Getting this right means users see clear messages, developers see useful logs, and internal details never leak.

## The Three Layers

\`\`\`
Client (React)
  <- TRPCClientError with code + message
API (tRPC procedure)
  <- TRPCError with code
API (Zod .input())
  <- automatic BAD_REQUEST on invalid input
\`\`\`

### Layer 1: Zod input validation

Zod schemas on \\\`.input()\\\` validate automatically. If validation fails, tRPC returns a \\\`BAD_REQUEST\\\` error with Zod's field-level messages. You never write this logic — it's handled by the framework:

\`\`\`typescript
create: protectedProcedure
  .input(CreateUserSchema)  // invalid input -> automatic BAD_REQUEST
  .mutation(async ({ ctx, input }) => {
    // input is already validated and typed — safe to use
  }),
\`\`\`

The client receives an error with \\\`code: "BAD_REQUEST"\\\` and a message containing the Zod validation details.

### Layer 2: tRPC procedure errors

Business logic errors inside procedures use \\\`TRPCError\\\` with the appropriate code. These are the errors you write explicitly:

\`\`\`typescript
import { TRPCError } from "@trpc/server";

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

    // publish sync event, then return
    return { success: true };
  }),
\`\`\`

### Layer 3: Client-side handling

React Query (via tRPC hooks) catches errors and exposes them on the query/mutation result. The client decides how to display them:

\`\`\`typescript
const { data, error, isLoading } = trpc.user.list.useQuery();

// error is a TRPCClientError with .message and .data.code
if (error) {
  console.log(error.data?.code);  // "NOT_FOUND", "FORBIDDEN", etc.
  console.log(error.message);      // the message string from the server
}
\`\`\`

---

## tRPC Error Codes

Use the right code — it determines both the HTTP status and the client behavior:

| Code | HTTP | When to use |
|---|---|---|
| \\\`BAD_REQUEST\\\` | 400 | Required data is missing or malformed in a way Zod can't catch (e.g., JWT has no email claim, a referenced ID is absent from the token). Not for business rule violations. |
| \\\`UNAUTHORIZED\\\` | 401 | No valid JWT. Already handled by \\\`protectedProcedure\\\` — you rarely throw this manually |
| \\\`FORBIDDEN\\\` | 403 | User is authenticated but the action is not allowed — wrong role, not the owner, or a business rule prevents it |
| \\\`NOT_FOUND\\\` | 404 | The requested resource doesn't exist |
| \\\`CONFLICT\\\` | 409 | Action would create a duplicate or violate a uniqueness constraint |
| \\\`INTERNAL_SERVER_ERROR\\\` | 500 | Something unexpected broke — catch it, log it, throw a generic message |

Codes you almost never use directly: \\\`UNAUTHORIZED\\\` (middleware handles it), \\\`METHOD_NOT_SUPPORTED\\\`, \\\`TIMEOUT\\\`, \\\`PARSE_ERROR\\\` (framework handles these).

---

## Server-Side Patterns

### Throw TRPCError at the boundary

Procedures are the system boundary — they face the client. Throw \\\`TRPCError\\\` here:

\`\`\`typescript
delete: protectedProcedure
  .input(CreateUserSchema.pick({ email: true }))
  .mutation(async ({ ctx, input }) => {
    const [deleted] = await ctx.db
      .delete(users)
      .where(eq(users.email, input.email))
      .returning();
    if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

    // publish sync event, then return
    return { success: true };
  }),
\`\`\`

### Return result objects inside the API

When you add adapters or service integrations, functions that can fail should return result objects instead of throwing. This lets the procedure decide what to do with the failure:

\`\`\`typescript
// In the adapter — returns a result, doesn't throw
async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const response = await fetch(url, { ... });
  if (!response.ok) {
    return { success: false, error: \\\`API returned \\\${response.status}\\\` };
  }
  return { success: true, messageId: data.id };
}

// In the procedure — decides what to tell the client
sendWelcome: protectedProcedure.mutation(async ({ ctx }) => {
  const result = await sendEmail({ to: ctx.user.email, ... });
  if (!result.success) {
    logger.error({ error: result.error, email: ctx.user.email }, "Failed to send welcome email");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to send email" });
  }
  return { sent: true };
}),
\`\`\`

### Never leak internals

Log the details server-side, send a generic message to the client:

\`\`\`typescript
// YES — log details, throw generic message
logger.error({ err, userId: input.userId }, "Failed to send welcome email");
throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to send email" });

// NO — stack trace, internal structure visible to client
throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.stack });
\`\`\`

### Unhandled errors

If a procedure throws something that isn't a \\\`TRPCError\\\` (e.g., a database connection error, an unhandled null), tRPC automatically catches it and returns a generic \\\`INTERNAL_SERVER_ERROR\\\` to the client. The original error is written to stderr by tRPC's default handler. To route unhandled errors through pino, add an \\\`onError\\\` handler to \\\`createExpressMiddleware()\\\` in the main entry file.

You don't need to wrap every procedure in try/catch for this reason. Only catch errors you can actually handle or where you need to add context to the log:

\`\`\`typescript
// NO — catch and re-throw adds nothing
try {
  const [user] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1);
} catch (err) {
  throw err;
}

// YES — just let it propagate
const [user] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1);
\`\`\`

---

## Client-Side Patterns

### Handling query errors

Queries expose errors on the result object. Display them inline:

\`\`\`typescript
export function Users() {
  const { users, isLoading, error } = useUsers();

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div className="text-red-500">Error: {error}</div>;

  return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
}
\`\`\`

The \\\`useUsers\\\` hook already extracts \\\`error.message\\\` as a string. For hooks that use raw tRPC, the error object has more detail:

\`\`\`typescript
const { error } = trpc.user.list.useQuery();
// error.message — the human-readable message
// error.data?.code — "NOT_FOUND", "FORBIDDEN", etc.
\`\`\`

### Handling mutation errors

Mutations can handle errors in two ways:

**Inline with \\\`onError\\\`** — for showing error messages next to the action:

\`\`\`typescript
const [error, setError] = useState<string | null>(null);

const deleteMutation = trpc.user.delete.useMutation({
  onSuccess: () => utils.user.list.invalidate(),
  onError: (err) => setError(err.message),
});
\`\`\`

**Checking \\\`isPending\\\` + error state** — for forms:

\`\`\`typescript
const createMutation = trpc.user.create.useMutation({
  onSuccess: () => {
    utils.user.list.invalidate();
    resetForm();
  },
});

// In JSX
<button disabled={createMutation.isPending}>
  {createMutation.isPending ? "Creating..." : "Create"}
</button>
{createMutation.error && (
  <p className="text-red-500">{createMutation.error.message}</p>
)}
\`\`\`

### Reacting to specific error codes

When different errors need different UI treatment, check \\\`error.data.code\\\`:

\`\`\`typescript
const { data, error, isLoading } = trpc.admin.listUsers.useQuery();

if (error?.data?.code === "FORBIDDEN") {
  return <div>You don't have admin permissions.</div>;
}

if (error) {
  return <div>Something went wrong: {error.message}</div>;
}
\`\`\`

### React Query retry behavior

The \\\`TRPCProvider\\\` configures React Query with \\\`retry: 1\\\` — failed queries retry once, then surface the error:

\`\`\`typescript
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
})
\`\`\`

You generally don't need to change this. For mutations, React Query doesn't retry by default (mutations are not idempotent).

---

## Environment and Startup Errors

The API validates all required env vars at startup using Zod. If validation fails, it prints clear per-field errors and exits before starting the server:

\`\`\`
Environment validation failed:
  DATABASE_URL: DATABASE_URL must be a valid URL
  AUTH0_AUDIENCE: Required
\`\`\`

This is handled by the \\\`validateEnv()\\\` function in the env module.

---

## Summary: Where Each Error Type Is Handled

| Error type | Where it's thrown | Where it's caught | What the client sees |
|---|---|---|---|
| Invalid input | Zod (automatic) | tRPC framework | \\\`BAD_REQUEST\\\` + field errors |
| Not found | Procedure (\\\`TRPCError\\\`) | React Query | \\\`NOT_FOUND\\\` + your message |
| Not authorized | \\\`protectedProcedure\\\` middleware | React Query | \\\`UNAUTHORIZED\\\` |
| Not permitted | Procedure or middleware (\\\`TRPCError\\\`) | React Query | \\\`FORBIDDEN\\\` + your message |
| External service failure | Adapter (result object) | Procedure catches it, logs, rethrows as \\\`TRPCError\\\` | \\\`INTERNAL_SERVER_ERROR\\\` + generic message |
| Unexpected crash | Anywhere (unhandled throw) | tRPC framework | \\\`INTERNAL_SERVER_ERROR\\\` (generic) |
| Missing env var | \\\`validateEnv()\\\` at startup | Process exits | Server doesn't start |`,
  },
  {
    name: 'End-to-End Type Safety with tRPC',
    description:
      'Types flow from Zod schemas through API routers to React Query hooks. You never write API types by hand — change a schema and the compiler tells you everywhere that needs updating.',
    content: `# End-to-End Type Safety with tRPC

Types flow from Zod schemas through API routers to React Query hooks. You never write API types by hand — change a schema and the compiler tells you everywhere that needs updating.

## How It's Wired

\`\`\`
packages/shared    ->  Zod schemas (source of truth)
packages/api       ->  tRPC routers use schemas as .input()
packages/hooks     ->  typed tRPC client + React Query hooks
packages/web       ->  imports hooks, gets full autocomplete
packages/mobile    ->  same hooks, same types
\`\`\`

The tRPC client is configured in the hooks package's TRPCProvider with a split link: HTTP batch for queries/mutations, WebSocket for subscriptions. Tokens are attached automatically.

## Three Procedure Types

Simplified overview:

\`\`\`typescript
// trpc.ts
export const publicProcedure = t.procedure;                         // no auth
export const protectedProcedure = t.procedure.use(/* auth + dbUser lookup */); // JWT required, resolves ctx.dbUser from sub

// middleware/requireRole.ts
export const adminProcedure = protectedProcedure.use(/* role check */);     // JWT + admin role via ctx.dbUser
\`\`\`

\\\`protectedProcedure\\\` does two things: verifies \\\`ctx.user\\\` exists (JWT is valid), then looks up the user in the \\\`users\\\` table by \\\`sub\\\` claim and attaches the result as \\\`ctx.dbUser\\\` (or \\\`null\\\` if not found).

## How to Implement a New Endpoint

### 1. Define the schema

\`\`\`typescript
// In your shared schemas package
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
\`\`\`

Re-export from the shared schemas index.

### 2. Create the router

\`\`\`typescript
// In the routers directory
import { CreatePostSchema } from "@myapp/shared";
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
\`\`\`

### 3. Wire it in

\`\`\`typescript
// In the routers index
import { postRouter } from "./post.js";

export const appRouter = router({
  user: userRouter,
  admin: adminRouter,
  jobs: jobsRouter,
  post: postRouter,  // add here
});
\`\`\`

### 4. Use from the client

\`\`\`typescript
// in any React component
import { trpc } from "@myapp/hooks";

function Posts() {
  const { data: posts } = trpc.post.list.useQuery();
  const create = trpc.post.create.useMutation();

  // full autocomplete on posts, create.mutate({ title, body }), etc.
}
\`\`\`

## How to Test

Router tests use \\\`createCaller()\\\` to call procedures directly without HTTP:

\`\`\`typescript
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
\`\`\`

## How to Debug

- **Type errors in the client?** The type chain is: schema -> router -> AppRouter type -> hooks. Check that your router is added to \\\`appRouter\\\` in the routers index and that the shared package is rebuilt (\\\`pnpm build --filter=@myapp/shared\\\`).
- **"Procedure not found" at runtime?** Rebuild: \\\`pnpm build\\\`. The hooks package imports types from the API build output.
- **Input validation fails?** tRPC uses your Zod schema's \\\`.parse()\\\`. Check the error's \\\`issues\\\` array for field-level messages.
- **Auth errors?** \\\`protectedProcedure\\\` throws \\\`UNAUTHORIZED\\\` if \\\`ctx.user\\\` is null. Check the Authorization header is being sent (look in TRPCProvider's \\\`headers()\\\` function).`,
  },
  {
    name: 'Database Patterns',
    description:
      'Drizzle ORM with PostgreSQL. Schema defined in TypeScript. Migrations generated automatically from schema changes.',
    content: `# Database Patterns

Drizzle ORM with PostgreSQL. Schema defined in TypeScript. Migrations generated automatically from schema changes.

## Current Schema

\`\`\`typescript
// db/schema.ts
import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  role: varchar("role", { length: 50 }).notNull().default("user"),
  avatarUrl: varchar("avatar_url", { length: 500 }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
\`\`\`

## Database Connection

\`\`\`typescript
// db/index.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { getEnv } from "../lib/env.js";

let cachedDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getConnectionString(): string {
  return getEnv().DATABASE_URL;
}

export function getDb() {
  if (!cachedDb) {
    const client = postgres(getConnectionString());
    cachedDb = drizzle(client, { schema });
  }
  return cachedDb;
}
\`\`\`

The context factory calls \\\`getDb()\\\` each time it creates a context, but the underlying connection is cached after the first call.

## How to Implement

### Add a new table

\`\`\`typescript
// db/schema.ts
export const posts = pgTable("posts", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  body: varchar("body", { length: 10000 }).notNull(),
  authorId: uuid("author_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
\`\`\`

Then generate and apply the migration:

\`\`\`bash
pnpm db:generate   # creates SQL migration file
pnpm db:migrate    # applies it to the database
\`\`\`

### Add a column to an existing table

\`\`\`typescript
// db/schema.ts — add to users
export const users = pgTable("users", {
  // ...existing columns...
  avatarUrl: varchar("avatar_url", { length: 500 }),  // nullable by default
});
\`\`\`

Then: \\\`pnpm db:generate && pnpm db:migrate\\\`

### Keep Zod schemas in sync

If the change is visible to clients, update the shared Zod schema too:

\`\`\`typescript
// In the shared schemas package
export const UserSchema = CreateUserSchema.extend({
  id: z.string().uuid(),
  role: RoleSchema.default("user"),
  avatarUrl: z.string().url().nullable().default(null),  // match the DB column
  lastLoginAt: z.date().nullable().default(null),
  createdAt: z.date(),
});
\`\`\`

### Query examples

\`\`\`typescript
// Select all
const allUsers = await ctx.db.select().from(users).orderBy(users.createdAt);

// Where clause
const admins = await ctx.db.select().from(users).where(eq(users.role, "admin"));

// Insert
const [newUser] = await ctx.db.insert(users).values({ name: "Alice", email: "a@b.com" }).returning();

// Update
const [updated] = await ctx.db.update(users).set({ role: "admin" }).where(eq(users.email, "a@b.com")).returning();

// Delete
await ctx.db.delete(users).where(eq(users.id, userId));

// Join
const postsWithAuthors = await ctx.db
  .select({ post: posts, author: users })
  .from(posts)
  .innerJoin(users, eq(posts.authorId, users.id));
\`\`\`

### Seed data

\`\`\`typescript
// db/seed.ts
const seedUsers = [
  { name: "Admin User", email: "admin@example.com", role: "admin" as const },
  { name: "Alice", email: "alice@example.com", role: "user" as const },
  { name: "Bob", email: "bob@example.com", role: "user" as const },
];

// Idempotent — checks before inserting
for (const user of seedUsers) {
  const existing = await db.select().from(users).where(eq(users.email, user.email)).limit(1);
  if (existing.length === 0) {
    await db.insert(users).values(user);
  }
}
\`\`\`

Run with: \\\`pnpm db:seed\\\`

## How to Test

Mock the database in router tests:

\`\`\`typescript
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockResolvedValue([mockUser]),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([mockUser]),
  delete: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
};

const mockPubsub = {
  publish: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn(),
  close: vi.fn(),
};

const caller = appRouter.createCaller({
  user: null,
  db: mockDb as any,
  pubsub: mockPubsub as any,
});
\`\`\`

The mock needs to be chainable — each method returns \\\`this\\\` (via \\\`mockReturnThis()\\\`), except terminal methods like \\\`orderBy\\\` or \\\`returning\\\` which return the final data.

Reset between tests:

\`\`\`typescript
beforeEach(() => {
  vi.clearAllMocks();
  mockDb.select.mockReturnThis();
  mockDb.from.mockReturnThis();
  // ...reset all chain methods
});
\`\`\`

## How to Debug

- **"relation does not exist"?** Run \\\`pnpm db:migrate\\\`. The migration hasn't been applied.
- **Migration fails?** Check the generated SQL in the drizzle migrations directory. Drizzle generates incremental migrations — if you edited a migration file manually, it may be out of sync.
- **Schema drift?** If the database is out of sync with your schema, use \\\`pnpm db:studio\\\` (Drizzle Studio) to inspect the actual table structure.
- **Reset everything:** Wipe Postgres data entirely, then: \\\`pnpm db:migrate && pnpm db:seed\\\`.
- **Connection refused?** Make sure Docker is running. Check \\\`DATABASE_URL\\\` points to \\\`localhost:5432\\\`.
- **Drizzle Studio:** \\\`pnpm db:studio\\\` opens a browser-based GUI to browse tables, run queries, and inspect data.`,
  },
  {
    name: 'Testing Patterns',
    description:
      'Vitest runs tests in the api and shared packages. Tests live next to the code they test. Covers schema tests, router tests, middleware tests, and mocking patterns.',
    content: `# Testing Patterns

Vitest runs tests in the api and shared packages. Tests live next to the code they test (\\\`*.test.ts\\\`). The hooks and web packages have placeholder scripts (React test infra can be added later).

## Running Tests

\`\`\`bash
pnpm test                              # all packages
pnpm --filter @myapp/api test          # just API
pnpm --filter @myapp/shared test       # just shared schemas
\`\`\`

Vitest runs in single-run mode (\\\`vitest run\\\`). For watch mode during development:

\`\`\`bash
cd packages/api && npx vitest          # re-runs on file changes
\`\`\`

## Existing Tests

| File | What it covers |
|---|---|
| \\\`shared/src/schemas/user.test.ts\\\` | CreateUserSchema, UserSchema, RoleSchema, UpdateUserRoleSchema |
| \\\`shared/src/schemas/sync.test.ts\\\` | SyncActionSchema, SyncEventSchema, syncChannel |
| \\\`api/src/lib/env.test.ts\\\` | validateEnv success and exit-on-failure |
| \\\`api/src/middleware/auth.test.ts\\\` | verifyToken valid/invalid (jose mocked) |
| \\\`api/src/routers/user.test.ts\\\` | user.list, user.create (auth + insert), user.delete (auth check) |

## How to Implement

### Schema tests

The simplest pattern — test Zod validation directly:

\`\`\`typescript
import { describe, it, expect } from "vitest";
import { CreatePostSchema } from "./post.js";

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
\`\`\`

### Router tests

Use \\\`createCaller()\\\` to test tRPC procedures without HTTP. Mock the database and pubsub:

\`\`\`typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db module (required — getDb() would connect to a real database during test execution)
vi.mock("../db/index.js", () => ({
  getConnectionString: vi.fn(() => "postgresql://mock"),
  getDb: vi.fn(() => ({})),
}));

// Mock jose (required — verifyToken/getJWKS would call getEnv() and fetch real JWKs during test execution)
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock"),
  jwtVerify: vi.fn().mockResolvedValue({
    payload: { sub: "u1", email: "test@test.com" },
    protectedHeader: { alg: "RS256" },
  }),
}));

import { appRouter } from "./index.js";

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockResolvedValue([]),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([{ id: "1", title: "Test" }]),
  delete: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
};

const mockPubsub = { publish: vi.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  vi.clearAllMocks();
  // Reset chainable mocks so each test starts with a clean query chain.
  // Without this, a resolved value from one test can leak into the next.
  mockDb.select.mockReturnThis();
  mockDb.from.mockReturnThis();
  mockDb.insert.mockReturnThis();
  mockDb.delete.mockReturnThis();
  mockDb.where.mockReturnThis();
  mockDb.values.mockReturnThis();
});

it("list returns posts", async () => {
  const caller = appRouter.createCaller({ user: null, db: mockDb as any, pubsub: mockPubsub as any });
  await caller.post.list();
  expect(mockDb.select).toHaveBeenCalled();
});

it("create requires auth", async () => {
  const caller = appRouter.createCaller({ user: null, db: mockDb as any, pubsub: mockPubsub as any });
  await expect(caller.post.create({ title: "Hi", body: "World" })).rejects.toThrow("UNAUTHORIZED");
});

it("create inserts and publishes", async () => {
  const caller = appRouter.createCaller({
    user: { sub: "u1", email: "test@test.com" },
    db: mockDb as any,
    pubsub: mockPubsub as any,
  });

  const result = await caller.post.create({ title: "Hi", body: "World" });
  expect(result.title).toBe("Test");
  expect(mockPubsub.publish).toHaveBeenCalled();
});
\`\`\`

### Middleware tests

For modules that call \\\`getEnv()\\\` (like auth middleware), mock the env module so \\\`getEnv()\\\` returns test values, and mock \\\`jose\\\` so no real JWKs are fetched:

\`\`\`typescript
vi.mock("../lib/env.js", () => ({
  getEnv: vi.fn(() => ({
    AUTH0_ISSUER_BASE_URL: "https://test.auth0.com",
    AUTH0_AUDIENCE: "https://api.test.com",
  })),
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock-jwks"),
  jwtVerify: vi.fn(),
}));
\`\`\`

**\\\`vi.stubEnv()\\\` for env validation tests:** When testing \\\`validateEnv()\\\` directly (rather than middleware that calls \\\`getEnv()\\\`), prefer \\\`vi.stubEnv()\\\` to stub \\\`process.env\\\` values instead of mocking the entire module:

\`\`\`typescript
// Preferred for env var tests — directly stub process.env values
vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/testdb");
vi.stubEnv("AUTH0_ISSUER_BASE_URL", "https://test.auth0.com");
vi.stubEnv("AUTH0_AUDIENCE", "https://api.test.com");
\`\`\`

Use \\\`vi.stubEnv()\\\` when you want \\\`validateEnv()\\\` to parse real \\\`process.env\\\` values through Zod. Use \\\`vi.mock()\\\` on the env module when you need to control what \\\`getEnv()\\\` returns in middleware or router tests where the env module is imported as a dependency.

Then in the test, import the mocked function and use \\\`mockResolvedValueOnce\\\` to control each call:

\`\`\`typescript
import { jwtVerify } from "jose";
const mockJwtVerify = vi.mocked(jwtVerify);

it("returns payload for valid token", async () => {
  mockJwtVerify.mockResolvedValueOnce({
    payload: { sub: "user123", email: "test@example.com" },
    protectedHeader: { alg: "RS256" },
  } as any);

  const result = await verifyToken("valid-token");
  expect(result).toEqual({ sub: "user123", email: "test@example.com" });
});
\`\`\`

\\\`vi.mock()\\\` is hoisted to the top of the file. If you need setup before the mock factory runs, use \\\`vi.hoisted()\\\`. Regular code runs after both.

### Testing process.exit

\`\`\`typescript
it("exits on invalid env", () => {
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit called");
  });
  vi.spyOn(console, "error").mockImplementation(() => {});

  expect(() => validateEnv()).toThrow("process.exit called");
  expect(exitSpy).toHaveBeenCalledWith(1);
});
\`\`\`

## Config

\`\`\`typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
\`\`\`

## How to Debug

- **"Cannot find module" in tests?** Tests import source \\\`.ts\\\` files (Vitest transforms them), not compiled \\\`.js\\\`. But local imports still need \\\`.js\\\` extensions because the project uses ESM.
- **External calls during tests?** Lazy-initialized modules will make real connections when called during tests. Always mock these modules with \\\`vi.mock()\\\`.
- **Mocks not working?** \\\`vi.mock()\\\` is hoisted to the top of the file. If you need setup before the mock factory runs, use \\\`vi.hoisted()\\\`. If mocking a default export, return \\\`{ default: ... }\\\`.
- **Test isolation issues?** Use \\\`beforeEach(() => vi.clearAllMocks())\\\` to reset mock call counts. Use \\\`vi.restoreAllMocks()\\\` if you used \\\`spyOn\\\`.
- **Want to run a single test?** Use the vitest CLI with the test file path or use \\\`.only\\\`: \\\`it.only("my test", ...)\\\`.`,
  },
  {
    name: 'Authentication Patterns',
    description:
      'Auth0 JWT verification, API key auth, dual auth support, mobile PKCE flow, and token verification middleware patterns.',
    content: `# Authentication

Auth0 is integrated across all three platforms. The web and mobile apps handle login flows and token management. The API verifies JWTs on every request.

## Architecture

\`\`\`
Web (Auth0 React SDK)  --- Bearer token -->  API (jose JWKS verification)
Mobile (expo-auth-session) --- Bearer token -->  API
\`\`\`

Tokens are audience-scoped JWTs signed by Auth0. The API fetches Auth0's JWKS to verify signatures -- no shared secret needed.

## Web Authentication

Auth0Provider wraps the entire app in the web entry point:

\`\`\`typescript
<Auth0Provider
  domain={import.meta.env.VITE_AUTH0_DOMAIN}
  clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
  cacheLocation="localstorage"
  authorizationParams={{
    redirect_uri: window.location.origin,
    audience: import.meta.env.VITE_AUTH0_AUDIENCE,
  }}
>
\`\`\`

\\\`cacheLocation="localstorage"\\\` ensures tokens persist across page redirects (the Auth0 login callback). Without it, tokens are stored in-memory and lost during the redirect, causing a race condition where \\\`getAccessTokenSilently()\\\` fails immediately after login.

The \\\`TRPCProvider\\\` attaches tokens to every request and uses a \\\`splitLink\\\` to route subscriptions over WebSocket and queries/mutations over HTTP:

\`\`\`typescript
// hooks providers
const wsClient = createWSClient({
  url: deriveWsUrl(apiUrl),
  connectionParams: async () => {
    try {
      const token = await getAccessToken();
      return { token };
    } catch {
      return {};
    }
  },
});

return trpc.createClient({
  links: [
    splitLink({
      condition: (op) => op.type === "subscription",
      true: wsLink({ client: wsClient }),
      false: httpBatchLink({
        url: apiUrl,
        async headers() {
          try {
            const token = await getAccessToken();
            return { Authorization: \\\`Bearer \\\${token}\\\` };
          } catch {
            return {};
          }
        },
      }),
    }),
  ],
});
\`\`\`

HTTP requests send the token as a \\\`Bearer\\\` header. WebSocket connections send it via \\\`connectionParams\\\`, which the API reads in \\\`createWSContextFactory\\\`.

**Using auth in components:**

\`\`\`typescript
import { useAuth0 } from "@auth0/auth0-react";

function MyComponent() {
  const { isAuthenticated, user, loginWithRedirect, logout } = useAuth0();
  // user.email, user.name, user.picture, etc.
}
\`\`\`

**Protecting a route:**

\`\`\`typescript
<Route
  path="/profile"
  element={
    <AuthGuard>
      <Profile />
    </AuthGuard>
  }
/>
\`\`\`

\\\`AuthGuard\\\` redirects unauthenticated users to Auth0 login and shows a loading state while checking.

## Mobile Authentication

Uses \\\`expo-auth-session\\\` with PKCE flow. Tokens are stored in \\\`expo-secure-store\\\`.

\`\`\`typescript
import { getValidAccessToken } from "../lib/auth";

// Auto-refreshes if expired (60s buffer)
const token = await getValidAccessToken();
\`\`\`

The \\\`AuthContext\\\` provider wraps the app and exposes \\\`getAccessToken\\\` for tRPC.

## API Verification

\`\`\`typescript
// API auth middleware
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getEnv } from "../lib/env.js";

let JWKS: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!JWKS) {
    const { AUTH0_ISSUER_BASE_URL } = getEnv();
    JWKS = createRemoteJWKSet(
      new URL(\\\`\\\${AUTH0_ISSUER_BASE_URL}/.well-known/jwks.json\\\`)
    );
  }
  return JWKS;
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { AUTH0_ISSUER_BASE_URL, AUTH0_AUDIENCE } = getEnv();
    const { payload } = await jwtVerify(token, getJWKS(), {
      issuer: \\\`\\\${AUTH0_ISSUER_BASE_URL}/\\\`,
      audience: AUTH0_AUDIENCE,
    });
    return payload;
  } catch {
    return null;
  }
}
\`\`\`

The context factory extracts the Bearer token from the request and calls \\\`verifyToken\\\`. The result lands on \\\`ctx.user\\\`:

\`\`\`typescript
// API context creation
const authHeader = req.headers.authorization;
if (authHeader?.startsWith("Bearer ")) {
  user = await verifyToken(authHeader.slice(7));
}
return { user, db, pubsub };
\`\`\`

## How to Implement Auth in a New Procedure

Use \\\`protectedProcedure\\\` instead of \\\`publicProcedure\\\`:

\`\`\`typescript
import { protectedProcedure } from "../trpc.js";

mySecureEndpoint: protectedProcedure.mutation(async ({ ctx }) => {
  // ctx.user is the raw JWT payload (guaranteed non-null)
  // ctx.dbUser is the users table row resolved from ctx.user.sub (may be null for new users)
  const sub = ctx.user.sub; // Auth0 user ID (always present)
  const dbUser = ctx.dbUser; // DB row or null
  // ...
}),
\`\`\`

> **Note:** \\\`ctx.user\\\` is the raw \\\`JWTPayload\\\` from \\\`jose\\\`. Auth0 access tokens with a custom audience only include standard claims (\\\`sub\\\`, \\\`iss\\\`, \\\`aud\\\`, \\\`exp\\\`) -- the \\\`email\\\` claim is NOT present. Use \\\`ctx.dbUser\\\` to get user details from the database. The middleware automatically looks up the user by \\\`sub\\\` on every authenticated request.

> **Note:** \\\`ctx.dbUser\\\` is \\\`null\\\` for brand-new users who haven't called \\\`user.create\\\` yet. Routes that require a DB user should check for this (e.g., notification routes throw \\\`NOT_FOUND\\\`).

For public endpoints that optionally use auth:

\`\`\`typescript
maybeAuthEndpoint: publicProcedure.query(async ({ ctx }) => {
  if (ctx.user) {
    // authenticated -- personalize
  } else {
    // anonymous -- return public data
  }
}),
\`\`\`

## How to Test

Mock both \\\`getEnv\\\` and \\\`jose\\\` -- the auth middleware calls \\\`getEnv()\\\` at runtime to read env vars, so you mock the module rather than setting \\\`process.env\\\` directly:

\`\`\`typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/env.js", () => ({
  getEnv: vi.fn(() => ({
    AUTH0_ISSUER_BASE_URL: "https://test.auth0.com",
    AUTH0_AUDIENCE: "https://api.test.com",
  })),
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock-jwks"),
  jwtVerify: vi.fn(),
}));

import { verifyToken } from "./auth.js";
import { jwtVerify } from "jose";

const mockJwtVerify = vi.mocked(jwtVerify);

describe("verifyToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns payload for valid token", async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: "user123", email: "test@example.com" },
      protectedHeader: { alg: "RS256" },
    } as any);

    const result = await verifyToken("valid-token");
    expect(result).toEqual({ sub: "user123", email: "test@example.com" });
  });

  it("returns null for invalid token", async () => {
    mockJwtVerify.mockRejectedValueOnce(new Error("invalid"));
    expect(await verifyToken("bad")).toBeNull();
  });
});
\`\`\`

For router tests, mock the whole auth chain and pass \\\`user\\\` directly in the context:

\`\`\`typescript
const caller = appRouter.createCaller({
  user: { sub: "user1", email: "test@test.com" },  // or null for unauthenticated
  db: mockDb as any,
  pubsub: mockPubsub as any,
});
\`\`\`

## How to Debug

- **401 on every request?** Check that \\\`AUTH0_ISSUER_BASE_URL\\\` and \\\`AUTH0_AUDIENCE\\\` env vars match your Auth0 config. The audience must match exactly.
- **Token not sent?** Open DevTools Network tab, check the Authorization header on tRPC requests. If missing, the \\\`getAccessToken()\\\` call in TRPCProvider is failing silently -- it catches errors and returns empty headers.
- **"Invalid audience" from jose?** The audience in the JWT must match \\\`AUTH0_AUDIENCE\\\` exactly. Check with \\\`jwt.io\\\` to decode the token and compare.
- **JWKS fetch fails?** The API needs outbound HTTPS access to \\\`{AUTH0_ISSUER_BASE_URL}/.well-known/jwks.json\\\`. Check DNS/firewall if in a restricted environment.
- **Mobile token expired?** \\\`getValidAccessToken()\\\` auto-refreshes with a 60s buffer, but if the refresh token is also expired, it throws. Catch it and re-prompt login.`,
  },
  {
    name: 'Roles & Permissions',
    description:
      'RBAC with two roles (user and admin), enforced via tRPC middleware. Includes admin claiming for first-time setup and role management procedures.',
    content: `# Roles & Permissions

Two roles: \\\`user\\\` (default) and \\\`admin\\\`. Roles live in the database on the \\\`users\\\` table, validated with Zod schemas, and enforced via tRPC middleware.

## How It Works

\`\`\`
JWT (sub claim) -> protectedProcedure resolves ctx.dbUser -> adminProcedure checks role
\`\`\`

The \\\`protectedProcedure\\\` middleware resolves \\\`ctx.dbUser\\\` from the JWT \\\`sub\\\` claim on every authenticated request. The \\\`adminProcedure\\\` then simply checks the role:

\`\`\`typescript
// API role middleware
export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.dbUser || ctx.dbUser.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }

  return next({ ctx });
});
\`\`\`

No redundant DB query -- \\\`ctx.dbUser\\\` was already resolved by \\\`protectedProcedure\\\`.

## First Admin Setup

When the project is first deployed, no admin exists. The \\\`claimAdmin\\\` mutation lets the first authenticated user promote themselves.

Note: Both \\\`claimAdmin\\\` and \\\`adminProcedure\\\` use \\\`BAD_REQUEST\\\` for a missing email -- a JWT without an email claim is a malformed request, not an access control issue. \\\`FORBIDDEN\\\` is reserved for authenticated users who lack the required role.

\`\`\`typescript
// Admin router
claimAdmin: protectedProcedure.mutation(async ({ ctx }) => {
  const email = ctx.user?.email as string | undefined;
  if (!email) throw new TRPCError({ code: "BAD_REQUEST", message: "No email in token" });

  // Check if any admin exists
  const admins = await ctx.db.select().from(users).where(eq(users.role, "admin")).limit(1);
  if (admins.length > 0) throw new TRPCError({ code: "FORBIDDEN", message: "An admin already exists" });

  // Promote caller
  const [updated] = await ctx.db.update(users)
    .set({ role: "admin" })
    .where(eq(users.email, email))
    .returning();
  if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "User not found. Create your account first." });
  return updated;
});
\`\`\`

After that, admins manage roles via the admin page or the \\\`admin.updateRole\\\` mutation.

## Existing Admin Endpoints

| Procedure | Access | What it does |
|---|---|---|
| \\\`admin.claimAdmin\\\` | \\\`protectedProcedure\\\` | Promotes caller to admin if no admin exists |
| \\\`admin.listUsers\\\` | \\\`adminProcedure\\\` | Returns all users with roles |
| \\\`admin.updateRole\\\` | \\\`adminProcedure\\\` | Sets a user's role by email |

## How to Implement a New Role

### 1. Add the role to the schema

\`\`\`typescript
// In the shared schemas package
export const RoleSchema = z.enum(["user", "admin", "moderator"]);
\`\`\`

### 2. Create a procedure middleware

\`\`\`typescript
// API role middleware
export const moderatorProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.dbUser || !["admin", "moderator"].includes(ctx.dbUser.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Moderator access required" });
  }

  return next({ ctx });
});
\`\`\`

### 3. Use it in a router

\`\`\`typescript
deleteComment: moderatorProcedure
  .input(z.object({ commentId: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    // only admins and moderators reach here
  }),
\`\`\`

### 4. Update the admin panel

In the admin view, add the new role to the \\\`ROLES\\\` array:

\`\`\`typescript
const ROLES = ["user", "moderator", "admin"] as const;
\`\`\`

## How to Test

\`\`\`typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("../db/index.js", () => ({
  getConnectionString: vi.fn(() => "postgresql://mock"),
  getDb: vi.fn(() => ({})),
}));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock"),
  jwtVerify: vi.fn().mockResolvedValue({
    payload: { sub: "u1", email: "admin@test.com" },
    protectedHeader: { alg: "RS256" },
  }),
}));

import { appRouter } from "./index.js";

it("listUsers requires admin role", async () => {
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([{ email: "admin@test.com", role: "user" }]),
    orderBy: vi.fn().mockResolvedValue([]),
  };

  const caller = appRouter.createCaller({
    user: { sub: "u1", email: "admin@test.com" },
    db: mockDb as any,
    pubsub: {} as any,
  });

  await expect(caller.admin.listUsers()).rejects.toThrow("FORBIDDEN");
});

it("listUsers succeeds for admin", async () => {
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([{ email: "admin@test.com", role: "admin" }]),
    orderBy: vi.fn().mockResolvedValue([]),
  };

  const caller = appRouter.createCaller({
    user: { sub: "u1", email: "admin@test.com" },
    db: mockDb as any,
    pubsub: {} as any,
  });

  const result = await caller.admin.listUsers();
  expect(result).toEqual([]);
});
\`\`\`

## How to Debug

- **"Admin access required" but you are admin?** The middleware looks up the user by \\\`sub\\\` from the JWT. Make sure the \\\`sub\\\` column in the \\\`users\\\` table matches your Auth0 user ID. Decode your token at jwt.io to check the \\\`sub\\\` claim.
- **claimAdmin says "An admin already exists"?** Check \\\`users\\\` table for any row with \\\`role = 'admin'\\\`. Use Drizzle Studio: \\\`pnpm db:studio\\\`.
- **claimAdmin says "User not found"?** Your Auth0 account email must already exist in the \\\`users\\\` table. Create a user first (via the Users page) with the same email as your Auth0 login.
- **New role not showing in Admin panel?** Make sure you added it to the \\\`ROLES\\\` array in the admin view and to \\\`RoleSchema\\\` in the shared package, then rebuild: \\\`pnpm build\\\`.`,
  },
  {
    name: 'Rate Limiting',
    description:
      'Per-IP request throttling using express-rate-limit. Applied globally to all Express routes with a configurable threshold and a stricter limiter for sensitive endpoints.',
    content: `# Rate Limiting

Per-IP request throttling using \\\`express-rate-limit\\\`. Applied globally to all Express routes. A stricter limiter is available for sensitive endpoints.

## What's Configured

\`\`\`typescript
// API rate limit middleware
import rateLimit from "express-rate-limit";
import { getEnv } from "../lib/env.js";

let cachedGlobalLimiter: ReturnType<typeof rateLimit> | null = null;

export function getGlobalLimiter() {
  if (!cachedGlobalLimiter) {
    cachedGlobalLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,  // 15 minutes
      max: parseInt(getEnv().RATE_LIMIT_MAX, 10),
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Too many requests, please try again later." },
    });
  }
  return cachedGlobalLimiter;
}

export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});
\`\`\`

The global limiter is applied in the API entry point after CORS:

\`\`\`typescript
app.use(getGlobalLimiter());
\`\`\`

Every response includes standard rate limit headers. With \\\`express-rate-limit\\\` v7 and \\\`standardHeaders: true\\\`, the library uses the IETF draft-6 combined \\\`RateLimit\\\` header format. The exact header names depend on the installed version -- v7 may send a single \\\`RateLimit\\\` header instead of three separate \\\`RateLimit-*\\\` headers.

## How to Implement

### Apply strict limiting to a specific route

\`\`\`typescript
// API entry point
import { strictLimiter } from "./middleware/rateLimit.js";

app.use("/api/trpc/admin.updateRole", strictLimiter);
\`\`\`

### Create a custom limiter

\`\`\`typescript
import rateLimit from "express-rate-limit";

export const authLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 5,               // 5 attempts per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts." },
});
\`\`\`

### Adjust the global limit

Set \\\`RATE_LIMIT_MAX\\\` in your \\\`.env\\\` file:

\`\`\`
RATE_LIMIT_MAX=200
\`\`\`

## How to Test

Rate limiting is Express middleware, not tRPC middleware, so it doesn't show up in \\\`createCaller()\\\` tests. Test it with HTTP requests:

\`\`\`typescript
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { getGlobalLimiter } from "./rateLimit.js";

describe("getGlobalLimiter", () => {
  const app = express();
  app.use(getGlobalLimiter());
  app.get("/test", (_req, res) => res.json({ ok: true }));

  it("includes rate limit headers", async () => {
    const res = await request(app).get("/test");
    expect(res.headers["ratelimit-limit"]).toBeDefined();
    expect(res.headers["ratelimit-remaining"]).toBeDefined();
  });
});
\`\`\`

Or verify headers manually with curl:

\`\`\`bash
curl -i http://localhost:3001/api/health
# Look for RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset headers
\`\`\`

## How to Debug

- **Rate limit headers missing?** Make sure \\\`getGlobalLimiter()\\\` is applied before the tRPC middleware in the API entry point. Express middleware runs in order.
- **Getting rate limited in development?** Increase \\\`RATE_LIMIT_MAX\\\` in your \\\`.env\\\` or set it to a high value like \\\`10000\\\` for local development.
- **Rate limiting doesn't work behind a proxy?** By default, \\\`express-rate-limit\\\` uses \\\`req.ip\\\`. If behind nginx or a load balancer, set \\\`app.set('trust proxy', 1)\\\` in the API entry point so it reads \\\`X-Forwarded-For\\\`.
- **429 errors in tests?** Rate limit state persists across requests within the same test process. Create a fresh Express app per test or use a separate limiter instance.`,
  },
  {
    name: 'Environment Validation',
    description:
      'All required env vars are validated at startup with a Zod schema before anything else runs. Provides a typed getEnv() accessor used throughout the API.',
    content: `# Environment Validation

All required env vars are validated at startup with Zod before anything else runs. If a variable is missing or invalid, the server prints field-level errors and exits immediately.

## What's Validated

\`\`\`typescript
// API env module
const envSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
  AUTH0_ISSUER_BASE_URL: z.string().url("AUTH0_ISSUER_BASE_URL must be a valid URL"),
  AUTH0_AUDIENCE: z.string().url("AUTH0_AUDIENCE must be a valid URL"),
  PORT: z.string().default("3001"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  RATE_LIMIT_MAX: z.string().default("100"),
  NODE_ENV: z.string().default("development"),
  LOG_LEVEL: z.string().default("info"),
});
\`\`\`

Called at the very top of the API entry point, before any other imports:

\`\`\`typescript
import "dotenv/config";
import { validateEnv } from "./lib/env.js";
const env = validateEnv();
// everything else uses env.PORT, env.CORS_ORIGIN, etc.
\`\`\`

On failure, you get clear output:

\`\`\`
Environment validation failed:
  DATABASE_URL: DATABASE_URL must be a valid URL
  AUTH0_ISSUER_BASE_URL: Required
\`\`\`

## How to Implement

### Add a new env var

\`\`\`typescript
// API env module
const envSchema = z.object({
  // ...existing vars...
  STRIPE_SECRET_KEY: z.string().min(1, "STRIPE_SECRET_KEY is required"),
  SENDGRID_API_KEY: z.string().optional(),  // optional -- won't block startup
});
\`\`\`

Then use it anywhere in the API:

\`\`\`typescript
import { getEnv } from "../lib/env.js";

const env = getEnv();
const stripe = new Stripe(env.STRIPE_SECRET_KEY);
\`\`\`

### Add it to your .env

\`\`\`
STRIPE_SECRET_KEY=sk_test_...
\`\`\`

### Add it to K8s secrets

Update your env file and redeploy.

## How to Test

\`\`\`typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateEnv } from "./env.js";

describe("validateEnv", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns parsed env for valid input", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db");
    vi.stubEnv("AUTH0_ISSUER_BASE_URL", "https://example.auth0.com");
    vi.stubEnv("AUTH0_AUDIENCE", "https://api.example.com");

    const env = validateEnv();
    expect(env.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/db");
    expect(env.PORT).toBe("3001");          // default
    expect(env.CORS_ORIGIN).toBe("http://localhost:3000");  // default
  });

  it("exits on missing required vars", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AUTH0_ISSUER_BASE_URL", "");
    vi.stubEnv("AUTH0_AUDIENCE", "");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => validateEnv()).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
\`\`\`

Key pattern: mock \\\`process.exit\\\` to throw (so the test doesn't actually exit), then assert it was called with \\\`1\\\`.

## How to Debug

- **Server exits immediately on startup?** Check the console output for "Environment validation failed" and the specific field errors. Most common: missing \\\`.env\\\` file or a var not set.
- **"validateEnv() must be called first" error?** Something is calling \\\`getEnv()\\\` before \\\`validateEnv()\\\` runs. Make sure \\\`validateEnv()\\\` is the first thing in the entry point after \\\`dotenv/config\\\`.
- **Valid URL but still failing?** Zod's \\\`z.string().url()\\\` requires a full URL with protocol. \\\`example.com\\\` fails -- it needs \\\`https://example.com\\\`.
- **Different behavior locally vs production?** Check that your K8s secret has all required vars.`,
  },
  {
    name: 'Structured Logging',
    description:
      'Pino logger with pino-http request middleware. Pretty-printed in development, JSON in production. Configurable log levels via LOG_LEVEL env var.',
    content: `# Structured Logging

All API logging uses Pino. Pretty-printed in development, JSON in production. Request logging is automatic.

## Setup

\`\`\`typescript
// API logger module
import pino from "pino";
import { getEnv } from "./env.js";

let cachedLogger: pino.Logger | null = null;

export function getLogger() {
  if (!cachedLogger) {
    const env = getEnv();
    cachedLogger = pino({
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV !== "production" && {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
    });
  }
  return cachedLogger;
}
\`\`\`

Request logging via pino-http:

\`\`\`typescript
// API request logger middleware
import type { IncomingMessage, ServerResponse } from "node:http";
import pinoHttp from "pino-http";
import type { HttpLogger } from "pino-http";
import { getLogger } from "../lib/logger.js";

let cachedRequestLogger: HttpLogger | null = null;

export function getRequestLogger(): HttpLogger {
  if (!cachedRequestLogger) {
    cachedRequestLogger = pinoHttp({
      logger: getLogger(),
      customLogLevel(_req: IncomingMessage, res: ServerResponse, err: Error | undefined) {
        if (res.statusCode >= 500 || err) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
      autoLogging: {
        ignore(req: IncomingMessage) {
          return req.url === "/api/health";  // skip health checks
        },
      },
    });
  }
  return cachedRequestLogger;
}
\`\`\`

## How to Implement

### Use the logger in your code

\`\`\`typescript
import { getLogger } from "../lib/logger.js";

// Structured data as first arg, message as second
getLogger().info({ userId: "abc", action: "login" }, "User logged in");
getLogger().warn({ attempts: 3 }, "Rate limit approaching");
getLogger().error({ err, requestId }, "Failed to process payment");
\`\`\`

**Do not use \\\`console.log\\\`** in API code. Use \\\`getLogger()\\\` for consistent structured output.

### Log levels

| Level | When to use |
|---|---|
| \\\`error\\\` | Something broke. Needs attention. |
| \\\`warn\\\` | Unexpected but handled. Worth monitoring. |
| \\\`info\\\` | Normal operations. User actions, lifecycle events. |
| \\\`debug\\\` | Detailed troubleshooting info. Not shown by default. |
| \\\`trace\\\` | Very verbose. Function entry/exit, data dumps. |

### Change log level at runtime

Set \\\`LOG_LEVEL\\\` env var:

\`\`\`
LOG_LEVEL=debug  # shows debug + info + warn + error
LOG_LEVEL=warn   # shows only warn + error
\`\`\`

### Child loggers for context

\`\`\`typescript
const jobLogger = getLogger().child({ module: "jobs", jobType: "email" });
jobLogger.info({ to: "user@test.com" }, "Sending email");
// output includes module and jobType on every line
\`\`\`

## Development Output

\`\`\`
[10:32:15.123] INFO: API server listening on http://localhost:3001
[10:32:15.124] INFO: WebSocket server listening on ws://localhost:3001/api/trpc
[10:32:16.456] INFO: POST /api/trpc/user.create 200 12ms
[10:32:17.789] WARN: GET /api/trpc/admin.listUsers 403 3ms
\`\`\`

## Production Output

\`\`\`json
{"level":30,"time":1707600735123,"msg":"API server listening on http://localhost:3001"}
{"level":30,"time":1707600736456,"req":{"method":"POST","url":"/api/trpc/user.create"},"res":{"statusCode":200},"responseTime":12,"msg":"request completed"}
\`\`\`

Pipe to any JSON log aggregator (Datadog, Grafana Loki, CloudWatch, etc.).

## How to Test

Logger output doesn't need to be tested directly. For code that uses the logger, either:

1. Let it log (Vitest captures stdout)
2. Mock it if you want to assert on log calls:

\`\`\`typescript
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

vi.mock("../lib/logger.js", () => ({
  getLogger: () => mockLogger,
}));

import { getLogger } from "../lib/logger.js";

it("logs job processing", async () => {
  // ... trigger the code ...
  expect(getLogger().info).toHaveBeenCalledWith(
    expect.objectContaining({ jobId: expect.any(String) }),
    "Processing example job",
  );
});
\`\`\`

## How to Debug

- **No log output?** Check \\\`LOG_LEVEL\\\`. If set to \\\`warn\\\`, \\\`info\\\` messages won't appear. Default is \\\`info\\\`.
- **Logs are JSON in development?** \\\`pino-pretty\\\` is a devDependency. Make sure \\\`NODE_ENV\\\` is not set to \\\`production\\\` in your \\\`.env\\\`. If unset, it defaults to \\\`development\\\`.
- **Request logs show "undefined" for URL?** Make sure \\\`getRequestLogger()\\\` middleware is applied before route handlers in the API entry point.
- **Health check spam in logs?** The request logger already ignores \\\`/api/health\\\`. If you add other health/readiness endpoints, add them to the \\\`ignore\\\` function in the request logger middleware.
- **Want to see debug logs?** Set \\\`LOG_LEVEL=debug\\\` in your \\\`.env\\\` and restart.`,
  },
  {
    name: 'CI/CD Patterns',
    description:
      'GitHub Actions workflows for CI (build + typecheck + test on PRs) and path-filtered deploys (API, web, infra) on push to main.',
    content: `# CI/CD

GitHub Actions handles both PR checks and production deploys. All workflows run on a self-hosted runner.

## CI Workflow (Pull Requests)

\`\`\`yaml
# CI workflow
name: CI
on:
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - run: corepack enable
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm typecheck
      - run: pnpm test
\`\`\`

Every PR to \\\`main\\\` must pass build + typecheck + tests before merging.

## Deploy Workflows (Push to Main)

Three workflows, each with path filters so only affected packages deploy. All three also support \\\`workflow_dispatch\\\` for manual triggers:

### deploy-api

Triggers on changes to API or shared packages:
1. Builds Docker image tagged with git SHA
2. Creates K8s secret from env file
3. Applies K8s deployment manifest
4. Waits for rollout (120s timeout)

### deploy-web

Triggers on changes to web, hooks, or shared packages:
1. Loads \\\`VITE_*\\\` env vars from env file
2. Builds Docker image with Vite build args, tagged with git SHA
3. Applies K8s deployment manifest
4. Waits for rollout (120s timeout)

### deploy-infra

Triggers on changes to K8s manifests. Manages the PostgreSQL secret and deploys the PostgreSQL K8s deployment. Waits for rollout (120s timeout).

## How to Implement

### Add a new CI step

Edit the CI workflow. Example -- add a lint step:

\`\`\`yaml
      - run: pnpm build
      - run: pnpm typecheck
      - run: pnpm lint        # add here
      - run: pnpm test
\`\`\`

### Add a new deploy workflow

Create a new file in the workflows directory:

\`\`\`yaml
name: Deploy Worker

on:
  push:
    branches: [main]
    paths:
      - "packages/worker/**"

jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - name: Set environment variables
        run: |
          echo "REPO_NAME=$(basename $GITHUB_REPOSITORY)" >> $GITHUB_ENV
          echo "GIT_SHA=$(git rev-parse --short HEAD)" >> $GITHUB_ENV
      - name: Build Docker image
        run: docker build -f packages/worker/Dockerfile -t \\\${{ env.REPO_NAME }}-worker:\\\${{ env.GIT_SHA }} .
      - name: Deploy to Kubernetes
        run: |
          sed -e "s|<REPO_NAME>|\\\${{ env.REPO_NAME }}|g" \\\\
              -e "s|<IMAGE_NAME>|\\\${{ env.REPO_NAME }}-worker:\\\${{ env.GIT_SHA }}|g" \\\\
              .k8s/worker-deployment.yml | kubectl apply -f -
      - name: Verify rollout
        run: kubectl rollout status deployment/\\\${{ env.REPO_NAME }}-worker --timeout=120s
\`\`\`

### Add a script to CI

1. Add the script to the relevant \\\`package.json\\\`
2. Add a Turbo task in \\\`turbo.json\\\` if it should run across packages
3. Add the step to the CI workflow

## How to Test

CI changes are tested by creating a PR. The workflow triggers automatically.

To test locally before pushing:

\`\`\`bash
pnpm build && pnpm typecheck && pnpm test
\`\`\`

This mirrors exactly what CI runs.

## How to Debug

- **CI failed on "pnpm install"?** Usually a lockfile mismatch. Run \\\`pnpm install\\\` locally and commit the updated \\\`pnpm-lock.yaml\\\`.
- **Build passes locally but fails in CI?** CI uses \\\`--frozen-lockfile\\\`, which is stricter. Also check for OS-specific issues (CI runs on macOS/ARM via the self-hosted runner).
- **Deploy succeeded but app is broken?** Check pod logs on the cluster. The rollout status check only verifies pods are running, not that the app is healthy.
- **Workflow didn't trigger?** Check the path filters. Changes to shared packages trigger both API and web deploys. Changes to hooks trigger web deploy. Changes outside the packages directory don't trigger any deploy. All deploy workflows also support \\\`workflow_dispatch\\\` for manual runs.
- **All workflows queue sequentially?** The self-hosted runner is a single machine -- only one job runs at a time. Workflows across all repos queue. This is by design.
- **Rollout timeout (120s)?** Usually means the pod is crash-looping. Check logs with \\\`--previous\\\` flag to see the crash output.
- **K8s secret issues?** The env file must exist on the runner. If it's missing, the init script wasn't run for this project.`,
  },
  {
    name: 'Adding an External Service',
    description:
      'How to integrate any external service using the adapter pattern. Covers adapter types, factory functions, console/real implementations, env var config, and testing.',
    content: `# Adding an External Service

How to integrate any external service (email, payments, storage, SMS, AI, etc.) using the adapter pattern. The adapter abstracts the provider so business logic never depends on a specific vendor. Providers can be swapped via env vars, database config, or at call time — without changing any calling code.

This guide uses email as the example. The pattern is the same for any external service.

## The Rule

**Every external service gets an adapter.** Even if you're only using one provider today. The adapter is a TypeScript type. Business logic calls the adapter. The adapter calls the provider. This is non-negotiable — it's how you avoid vendor lock-in and keep tests fast.

\\\`\\\`\\\`
Business logic (routers, jobs)
  → calls adapter interface
    → adapter implementation calls provider SDK (SendGrid, Stripe, S3, etc.)
\\\`\\\`\\\`

Adapters use factory functions, not classes — see the Coding Guidelines spec for why.

## Overview of Files You'll Create

\\\`\\\`\\\`
packages/api/src/services/email/
  types.ts           ← Adapter type + shared types
  index.ts           ← Factory that returns the right implementation
  sendgrid.ts        ← SendGrid implementation
  console.ts         ← Dev/test implementation (logs to console)
  resend.ts          ← (future) Another provider, no other code changes
\\\`\\\`\\\`

---

## Step 1: Define the Adapter Type

Create the adapter type file. This is the contract. Every implementation must satisfy it. Business logic only imports types and the factory -- never a specific provider.

\\\`\\\`\\\`typescript
// Create: packages/api/src/services/email/types.ts

export type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
};

export type SendEmailResult = {
  success: boolean;
  messageId?: string;
  error?: string;
};

export type EmailAdapter = {
  send(params: SendEmailParams): Promise<SendEmailResult>;
};
\\\`\\\`\\\`

**Guidelines for the type:**
- Keep it minimal — only the operations your app actually uses
- Use your own types for params and results, not the provider's types
- The type should make sense if you read it without knowing which provider backs it
- Don't leak provider-specific concepts (e.g., don't put "SendGrid template IDs" in the shared type)

---

## Step 2: Build the Dev/Console Implementation

Create this file first. This implementation logs to the console instead of sending real emails. It's what you use in development and tests.

\\\`\\\`\\\`typescript
// Create: packages/api/src/services/email/console.ts
import { getLogger } from "../../lib/logger.js";
import type { EmailAdapter } from "./types.js";

export function createConsoleEmailAdapter(): EmailAdapter {
  return {
    async send(params) {
      getLogger().info(
        { to: params.to, subject: params.subject },
        "Email sent (console adapter — not actually delivered)",
      );
      return { success: true, messageId: \\\`console-\\\${Date.now()}\\\` };
    },
  };
}
\\\`\\\`\\\`

This means you can build and test the entire email flow before you have a provider account or API key.

---

## Step 3: Build the Real Implementation

Create the provider-specific implementation file.

\\\`\\\`\\\`typescript
// Create: packages/api/src/services/email/sendgrid.ts
import { getLogger } from "../../lib/logger.js";
import type { EmailAdapter } from "./types.js";

export function createSendGridAdapter(config: {
  apiKey: string;
  fromAddress: string;
}): EmailAdapter {
  return {
    async send(params) {
      try {
        const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: {
            Authorization: \\\`Bearer \\\${config.apiKey}\\\`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: params.to }] }],
            from: { email: config.fromAddress },
            subject: params.subject,
            content: [{ type: "text/html", value: params.html }],
            ...(params.replyTo && { reply_to: { email: params.replyTo } }),
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          getLogger().error({ status: response.status, body }, "SendGrid API error");
          return { success: false, error: \\\`SendGrid error: \\\${response.status}\\\` };
        }

        const messageId = response.headers.get("x-message-id") ?? undefined;
        return { success: true, messageId };
      } catch (err) {
        getLogger().error({ err }, "SendGrid request failed");
        return { success: false, error: (err as Error).message };
      }
    },
  };
}
\\\`\\\`\\\`

**Key patterns:**
- Factory takes config — never reads env vars directly (the top-level factory does that)
- Returns a result object instead of throwing — let the caller decide how to handle failure
- Logs errors with structured data through Pino
- Uses only \\\`fetch\\\` — no provider SDK required (though you can use one if the API is complex)
- Config is available via closure — no \\\`this\\\`, no private fields

---

## Step 4: Create the Factory

Create the factory file. The factory decides which implementation to use. It reads configuration from env vars, but could also read from the database or accept runtime overrides.

\\\`\\\`\\\`typescript
// Create: packages/api/src/services/email/index.ts
import { getEnv } from "../../lib/env.js";
import { getLogger } from "../../lib/logger.js";
import type { EmailAdapter } from "./types.js";
import { createConsoleEmailAdapter } from "./console.js";
import { createSendGridAdapter } from "./sendgrid.js";

export type { EmailAdapter, SendEmailParams, SendEmailResult } from "./types.js";

let instance: EmailAdapter | null = null;

export function getEmailAdapter(): EmailAdapter {
  if (instance) return instance;

  const env = getEnv();
  const provider = env.EMAIL_PROVIDER;  // "sendgrid" | "console" | undefined

  switch (provider) {
    case "sendgrid":
      getLogger().info("Email adapter: SendGrid");
      instance = createSendGridAdapter({
        apiKey: env.SENDGRID_API_KEY!,
        fromAddress: env.EMAIL_FROM!,
      });
      break;

    default:
      getLogger().info("Email adapter: console (no EMAIL_PROVIDER set)");
      instance = createConsoleEmailAdapter();
      break;
  }

  return instance;
}

// For tests: override the adapter
export function setEmailAdapter(adapter: EmailAdapter): void {
  instance = adapter;
}

// For tests: reset to force re-initialization
export function resetEmailAdapter(): void {
  instance = null;
}
\\\`\\\`\\\`

---

## Step 5: Add the Env Vars

Add the following fields to the existing env schema.

\\\`\\\`\\\`typescript
// Add to the env schema in your env validation module
const envSchema = z.object({
  // ...existing vars...
  EMAIL_PROVIDER: z.string().optional(),     // "sendgrid", "resend", etc. Falls back to console.
  SENDGRID_API_KEY: z.string().optional(),   // Required when EMAIL_PROVIDER=sendgrid
  EMAIL_FROM: z.string().optional(),         // Required when EMAIL_PROVIDER is set
});
\\\`\\\`\\\`

Keep provider-specific vars optional at the Zod level. Validate them inside the factory instead — this way the app boots fine in development without email credentials:

\\\`\\\`\\\`typescript
// In the factory switch case:
case "sendgrid":
  if (!env.SENDGRID_API_KEY || !env.EMAIL_FROM) {
    throw new Error("EMAIL_PROVIDER=sendgrid requires SENDGRID_API_KEY and EMAIL_FROM");
  }
  instance = createSendGridAdapter({ apiKey: env.SENDGRID_API_KEY, fromAddress: env.EMAIL_FROM });
  break;
\\\`\\\`\\\`

---

## Step 6: Use the Adapter

### From a tRPC procedure

Add a procedure like this to an existing router.

\\\`\\\`\\\`typescript
// Add to your user router
import { getEmailAdapter } from "../services/email/index.js";

sendWelcome: protectedProcedure
  .input(z.object({ email: z.string().email() }))
  .mutation(async ({ input }) => {
    const email = getEmailAdapter();
    const result = await email.send({
      to: input.email,
      subject: "Welcome!",
      html: "<h1>Welcome to the app</h1>",
    });

    if (!result.success) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to send email" });
    }

    return { messageId: result.messageId };
  }),
\\\`\\\`\\\`

### From a background job (recommended for non-blocking sends)

Create a job handler file for the email send.

\\\`\\\`\\\`typescript
// Create a job handler for sending welcome emails
import type PgBoss from "pg-boss";
import { getLogger } from "../../lib/logger.js";
import { getEmailAdapter } from "../../services/email/index.js";

export const SEND_WELCOME_EMAIL = "send-welcome-email";

type Payload = {
  to: string;
  name: string;
};

export async function registerSendWelcomeEmailHandler(boss: PgBoss): Promise<void> {
  await boss.work(SEND_WELCOME_EMAIL, async ([job]) => {
    const { to, name } = job.data as Payload;
    const email = getEmailAdapter();

    const result = await email.send({
      to,
      subject: "Welcome!",
      html: \\\`<h1>Hello \\\${name}</h1><p>Welcome to the app.</p>\\\`,
    });

    if (!result.success) {
      getLogger().error({ to, error: result.error }, "Welcome email failed");
      throw new Error(result.error);  // pg-boss will retry
    }

    getLogger().info({ to, messageId: result.messageId }, "Welcome email sent");
  });
}
\\\`\\\`\\\`

Then add the enqueue call to your mutation:

\\\`\\\`\\\`typescript
// Add to your router file:
import { enqueueJob } from "../jobs/index.js";
import { SEND_WELCOME_EMAIL } from "../jobs/handlers/sendWelcomeEmail.js";

create: protectedProcedure
  .input(CreateUserSchema)
  .mutation(async ({ ctx, input }) => {
    const [user] = await ctx.db.insert(users).values({ ...input, role: "user" }).returning();

    // Non-blocking — returns immediately, email sends in background
    await enqueueJob(SEND_WELCOME_EMAIL, { to: user.email, name: user.name });

    return user;
  }),
\\\`\\\`\\\`

---

## Step 7: Database-Driven Configuration (When Needed)

Sometimes the provider or its config comes from the database — e.g., per-tenant email settings in a multi-tenant app, or admin-configurable SMTP settings.

Add an overload to the factory file that accepts a config parameter:

\\\`\\\`\\\`typescript
// Add to: packages/api/src/services/email/index.ts

export function createEmailAdapter(config: {
  provider: string;
  apiKey: string;
  fromAddress: string;
}): EmailAdapter {
  switch (config.provider) {
    case "sendgrid":
      return createSendGridAdapter({ apiKey: config.apiKey, fromAddress: config.fromAddress });
    default:
      return createConsoleEmailAdapter();
  }
}
\\\`\\\`\\\`

Then in your procedure:

\\\`\\\`\\\`typescript
sendNotification: protectedProcedure.mutation(async ({ ctx }) => {
  // Read config from DB (e.g., org-level settings)
  const [settings] = await ctx.db
    .select()
    .from(orgSettings)
    .where(eq(orgSettings.orgId, ctx.user.orgId))
    .limit(1);

  const email = createEmailAdapter({
    provider: settings.emailProvider,
    apiKey: settings.emailApiKey,
    fromAddress: settings.emailFrom,
  });

  await email.send({ to: "...", subject: "...", html: "..." });
}),
\\\`\\\`\\\`

This way the same adapter type works whether config comes from env vars (singleton via \\\`getEmailAdapter()\\\`), the database (per-request via \\\`createEmailAdapter()\\\`), or passed in directly.

---

## Step 8: Adding a New Provider Later

This is the payoff. When you switch from SendGrid to Resend, create one new file and change one env var:

\\\`\\\`\\\`typescript
// Create: packages/api/src/services/email/resend.ts
import { getLogger } from "../../lib/logger.js";
import type { EmailAdapter } from "./types.js";

export function createResendAdapter(config: {
  apiKey: string;
  fromAddress: string;
}): EmailAdapter {
  return {
    async send(params) {
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: \\\`Bearer \\\${config.apiKey}\\\`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: config.fromAddress,
            to: params.to,
            subject: params.subject,
            html: params.html,
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          getLogger().error({ status: response.status, body }, "Resend API error");
          return { success: false, error: \\\`Resend error: \\\${response.status}\\\` };
        }

        const data = await response.json();
        return { success: true, messageId: data.id };
      } catch (err) {
        getLogger().error({ err }, "Resend request failed");
        return { success: false, error: (err as Error).message };
      }
    },
  };
}
\\\`\\\`\\\`

Then add the new case to the factory:

\\\`\\\`\\\`typescript
// Extend the switch statement in the factory
case "resend":
  getLogger().info("Email adapter: Resend");
  instance = createResendAdapter({ apiKey: env.RESEND_API_KEY!, fromAddress: env.EMAIL_FROM! });
  break;
\\\`\\\`\\\`

Change the env var:

\\\`\\\`\\\`
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
\\\`\\\`\\\`

No other code changes. Every mutation, job, and test that uses \\\`getEmailAdapter()\\\` now sends through Resend.

---

## How to Test

The adapter pattern makes testing trivial. You never mock HTTP calls or provider SDKs — you mock the adapter.

### Unit test with a mock adapter

\\\`\\\`\\\`typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setEmailAdapter, resetEmailAdapter } from "../services/email/index.js";
import type { EmailAdapter } from "../services/email/types.js";

const mockEmail: EmailAdapter = {
  send: vi.fn().mockResolvedValue({ success: true, messageId: "test-123" }),
};

beforeEach(() => {
  vi.clearAllMocks();
  setEmailAdapter(mockEmail);
});

afterAll(() => resetEmailAdapter());

it("sends welcome email on user create", async () => {
  const caller = appRouter.createCaller({
    user: { sub: "u1", email: "test@test.com" },
    db: mockDb as any,
    pubsub: mockPubsub as any,
  });

  await caller.user.sendWelcome({ email: "new@test.com" });

  expect(mockEmail.send).toHaveBeenCalledWith(
    expect.objectContaining({ to: "new@test.com", subject: "Welcome!" }),
  );
});

it("throws on email failure", async () => {
  vi.mocked(mockEmail.send).mockResolvedValueOnce({ success: false, error: "API down" });

  const caller = appRouter.createCaller({ user: mockUser, db: mockDb as any, pubsub: mockPubsub as any });
  await expect(caller.user.sendWelcome({ email: "new@test.com" })).rejects.toThrow("INTERNAL_SERVER_ERROR");
});
\\\`\\\`\\\`

### Testing a specific adapter implementation

\\\`\\\`\\\`typescript
import { describe, it, expect, vi } from "vitest";
import { createSendGridAdapter } from "./sendgrid.js";

it("calls SendGrid API with correct payload", async () => {
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    headers: new Headers({ "x-message-id": "sg-123" }),
  });
  vi.stubGlobal("fetch", mockFetch);

  const adapter = createSendGridAdapter({ apiKey: "test-key", fromAddress: "from@test.com" });
  const result = await adapter.send({ to: "to@test.com", subject: "Hi", html: "<p>Hello</p>" });

  expect(result).toEqual({ success: true, messageId: "sg-123" });
  expect(mockFetch).toHaveBeenCalledWith(
    "https://api.sendgrid.com/v3/mail/send",
    expect.objectContaining({ method: "POST" }),
  );

  vi.unstubAllGlobals();
});
\\\`\\\`\\\`

---

## How to Debug

- **Console adapter being used in production?** Check that \\\`EMAIL_PROVIDER\\\` is set in your env. If it's missing or empty, the factory defaults to console.
- **"SENDGRID_API_KEY is required" at startup?** You set \\\`EMAIL_PROVIDER=sendgrid\\\` but didn't provide the API key. Either set the key or remove \\\`EMAIL_PROVIDER\\\` to use the console adapter.
- **Email sent but not received?** Check the adapter's return value — \\\`success: true\\\` only means the API accepted the request. Check the provider's dashboard for delivery status. Also check spam folders.
- **Wrong provider being used?** The factory caches the adapter as a singleton. If you changed env vars after the first call, the old adapter is still cached. Restart the server.
- **Need to test with real emails in staging?** Set \\\`EMAIL_PROVIDER=sendgrid\\\` in the staging env. The same code, different config.

---

## Checklist

- [ ] Adapter type in \\\`services/<name>/types.ts\\\` with params, result, and adapter types
- [ ] Console/dev factory that logs instead of calling the real service
- [ ] Real factory with config accepted via parameter (closure, not class)
- [ ] Top-level factory in \\\`services/<name>/index.ts\\\` with \\\`get<Name>Adapter()\\\`, \\\`set<Name>Adapter()\\\`, \\\`reset<Name>Adapter()\\\`
- [ ] Provider-specific env vars added to env schema (optional at Zod level, validated in factory)
- [ ] Business logic calls the adapter, never the provider directly
- [ ] Heavy operations routed through background jobs (not blocking requests)
- [ ] Tests mock the adapter type, not the provider SDK
- [ ] Provider swap requires only: one new file + one factory case + env var change

---

## Applying This Pattern to Other Services

| Service | Adapter Methods | Implementations |
|---|---|---|
| **Payments** | \\\`createCharge()\\\`, \\\`refund()\\\`, \\\`getBalance()\\\` | Stripe, Square, console |
| **File Storage** | \\\`upload()\\\`, \\\`download()\\\`, \\\`delete()\\\`, \\\`getUrl()\\\` | S3, GCS, local filesystem |
| **SMS** | \\\`send()\\\` | Twilio, Vonage, console |
| **Push Notifications** | \\\`send()\\\`, \\\`sendBatch()\\\` | Expo Push, Firebase, console |
| **AI/LLM** | \\\`complete()\\\`, \\\`embed()\\\` | OpenAI, Anthropic, local/mock |
| **Search** | \\\`index()\\\`, \\\`search()\\\`, \\\`delete()\\\` | Algolia, Meilisearch, Postgres full-text |

The structure is always the same:
\\\`\\\`\\\`
services/<name>/
  types.ts      ← adapter type
  index.ts      ← factory
  console.ts    ← dev/test factory
  <provider>.ts ← real factory(s)
\\\`\\\`\\\``,
  },
  {
    name: 'Adding Scheduled Jobs',
    description:
      'How to add recurring work that runs on a schedule using pg-boss cron scheduling. Covers cron expressions, idempotency, retries, dead-letter queues, and monitoring.',
    content: `# Adding a Scheduled Job

How to add recurring work that runs on a schedule — daily report emails, hourly data syncs, nightly cleanup of expired records, periodic health checks against external APIs. Uses pg-boss's built-in cron scheduling, which runs inside the existing API process with no extra infrastructure.

This guide builds on the Background Jobs spec. If you haven't read that yet, start there — it covers how pg-boss is wired up, how to create handlers, and how to enqueue one-off jobs. This guide covers the parts that are different for scheduled work: cron expressions, idempotency, monitoring, and cleanup.

This guide uses "a nightly job that deletes users who haven't logged in for 90 days" as the example. Replace with your use case.

## How pg-boss Scheduling Works

pg-boss has a built-in cron scheduler. When you call \\\`boss.schedule()\\\`, it stores the schedule in a \\\`pgboss.schedule\\\` table. A clock monitor inside pg-boss checks this table and automatically enqueues a job at each cron tick. You register a \\\`work()\\\` handler for the same job name, and it processes each enqueued instance.

\\\`\\\`\\\`
boss.schedule("delete-stale-users", "0 3 * * *")
  → pg-boss clock monitor fires at 3:00 AM
    → enqueues a job named "delete-stale-users"
      → your work() handler picks it up and runs
\\\`\\\`\\\`

Key behaviors:
- Schedules survive server restarts — they're stored in Postgres
- If the server is down when a cron tick fires, pg-boss enqueues the job when it starts back up (within one cron interval)
- On multi-instance deployments, pg-boss leader election ensures only one instance runs the scheduler — no duplicate jobs
- \\\`schedule()\\\` is idempotent — calling it again with the same name updates the existing schedule

---

## Step 1: Create the Handler

The handler is the same as any one-off job handler. The only difference is what's inside: scheduled jobs typically query the database, do bulk operations, and log what they did.

\\\`\\\`\\\`typescript
// Create a scheduled job handler file
import type PgBoss from "pg-boss";
import { eq, lt, isNotNull } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { getLogger } from "../../lib/logger.js";

export const DELETE_STALE_USERS = "delete-stale-users";

export async function registerDeleteStaleUsersHandler(boss: PgBoss): Promise<void> {
  await boss.work(DELETE_STALE_USERS, async ([job]) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    const staleUsers = await getDb()
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(lt(users.lastLoginAt, cutoff));

    if (staleUsers.length === 0) {
      getLogger().info({ jobId: job.id }, "No stale users to delete");
      return;
    }

    for (const user of staleUsers) {
      await getDb()
        .delete(users)
        .where(eq(users.id, user.id));
    }

    getLogger().info(
      { jobId: job.id, count: staleUsers.length },
      "Deleted stale users",
    );
  });

  getLogger().info(\\\`Registered handler for \\\${DELETE_STALE_USERS}\\\`);
}
\\\`\\\`\\\`

**Why does the handler import \\\`getDb\\\` directly instead of using \\\`ctx.db\\\`?** Scheduled jobs run outside of tRPC request context — there's no HTTP request and no \\\`ctx\\\`. The handler imports the database connection directly via \\\`getDb()\\\`. This is the one place in the codebase where that's normal.

---

## Step 2: Register the Handler and Schedule

Add both the handler registration and the schedule call to \\\`initJobs\\\`. The schedule tells pg-boss *when* to enqueue; the handler tells it *what to do* when the job arrives.

\\\`\\\`\\\`typescript
// Add to your jobs index file
import { registerDeleteStaleUsersHandler, DELETE_STALE_USERS }
  from "./handlers/deleteStaleUsers.js";

export async function initJobs(connectionString: string): Promise<void> {
  boss = new PgBoss(connectionString);
  boss.on("error", (error) => getLogger().error({ err: error }, "pg-boss error"));
  await boss.start();
  getLogger().info("pg-boss started");

  // Create queues (required in pg-boss v10 before work()/send())
  await boss.createQueue(EXAMPLE_JOB);
  await boss.createQueue(DELETE_STALE_USERS);

  // Register handlers
  await registerExampleHandler(boss);
  await registerDeleteStaleUsersHandler(boss);

  // Register schedules
  await boss.schedule(DELETE_STALE_USERS, "0 3 * * *");
  getLogger().info("Registered schedule: delete-stale-users at 0 3 * * *");
}
\\\`\\\`\\\`

\\\`schedule()\\\` is idempotent. If the schedule already exists with the same name and cron expression, it's a no-op. If the cron expression changed, it updates the existing schedule. This means it's safe to call on every server startup.

### Cron expression reference

\\\`\\\`\\\`
┌───────── minute (0-59)
│ ┌─────── hour (0-23)
│ │ ┌───── day of month (1-31)
│ │ │ ┌─── month (1-12)
│ │ │ │ ┌─ day of week (0-7, 0 and 7 are Sunday)
│ │ │ │ │
* * * * *
\\\`\\\`\\\`

Common patterns:

| Schedule | Cron | When it runs |
|---|---|---|
| Every hour | \\\`0 * * * *\\\` | :00 of every hour |
| Every 15 minutes | \\\`*/15 * * * *\\\` | :00, :15, :30, :45 |
| Daily at 3 AM | \\\`0 3 * * *\\\` | 3:00 AM |
| Daily at midnight | \\\`0 0 * * *\\\` | 12:00 AM |
| Weekdays at 9 AM | \\\`0 9 * * 1-5\\\` | Mon–Fri at 9:00 AM |
| Weekly on Sunday | \\\`0 0 * * 0\\\` | Sunday at midnight |
| First of every month | \\\`0 0 1 * *\\\` | 1st at midnight |

### Timezone

By default, cron expressions evaluate in UTC. To use a different timezone, pass the \\\`tz\\\` option:

\\\`\\\`\\\`typescript
await boss.schedule(DELETE_STALE_USERS, "0 3 * * *", null, {
  tz: "America/New_York",
});
\\\`\\\`\\\`

The third argument is \\\`data\\\` (pass \\\`null\\\` if you don't need static data attached to each scheduled job instance).

---

## Step 3: Make It Idempotent

Scheduled jobs can run more than once for the same logical time window — retries, clock skew, a deploy that re-triggers the schedule, or a bug that runs the same handler twice. The handler must produce the same result regardless of how many times it runs.

### The rule

**If you ran the handler twice in a row, the second run should be a no-op (or at least not cause harm).**

### Common idempotency patterns

**Deletes are naturally idempotent.** Deleting the same record twice is safe — the first run removes it, the second run finds nothing to delete. This is one reason deletion-based cleanup is simpler than flag-based approaches:

\\\`\\\`\\\`typescript
// Deleting stale users is inherently idempotent — if the user was already
// deleted by a previous run, the WHERE clause simply matches zero rows.
const staleUsers = await getDb()
  .select({ id: users.id })
  .from(users)
  .where(lt(users.lastLoginAt, cutoff));
\\\`\\\`\\\`

**Use \\\`ON CONFLICT DO NOTHING\\\` for inserts.** If the job creates records (e.g., generating monthly invoices), use upserts to avoid duplicates:

\\\`\\\`\\\`typescript
await getDb()
  .insert(invoices)
  .values({ userId: user.id, month: currentMonth, amount: 29.99 })
  .onConflictDoNothing({ target: [invoices.userId, invoices.month] });
\\\`\\\`\\\`

**Use a job key for deduplication.** pg-boss can prevent duplicate scheduled instances using \\\`singletonKey\\\`:

\\\`\\\`\\\`typescript
await boss.schedule(MONTHLY_REPORT, "0 9 1 * *", null, {
  singletonKey: \\\`monthly-report-\\\${new Date().toISOString().slice(0, 7)}\\\`,  // "monthly-report-2026-02"
});
\\\`\\\`\\\`

If a job with that key already exists in the queue, pg-boss won't create another.

**Log what was skipped.** So you can tell the difference between "ran but nothing to do" and "didn't run at all":

\\\`\\\`\\\`typescript
if (staleUsers.length === 0) {
  getLogger().info({ jobId: job.id }, "No stale users to delete — skipping");
  return;
}
\\\`\\\`\\\`

---

## Step 4: Passing Static Data to Scheduled Jobs

If every scheduled run needs the same configuration, pass it as the third argument to \\\`schedule()\\\`:

\\\`\\\`\\\`typescript
await boss.schedule(
  DELETE_STALE_USERS,
  "0 3 * * *",
  { daysThreshold: 90, dryRun: false },  // attached to every enqueued job
);
\\\`\\\`\\\`

Then read it in the handler:

\\\`\\\`\\\`typescript
await boss.work(DELETE_STALE_USERS, async ([job]) => {
  const { daysThreshold, dryRun } = job.data as { daysThreshold: number; dryRun: boolean };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysThreshold);

  // ... use dryRun to log instead of mutating
});
\\\`\\\`\\\`

This is useful for:
- Making thresholds configurable without code changes (update the schedule data)
- Adding a \\\`dryRun\\\` flag during rollout
- Passing env-specific configuration (different thresholds in staging vs production)

---

## Step 5: Monitoring That It Actually Ran

A scheduled job that silently stops running is worse than a job that fails loudly. You need to know both that it ran and what it did.

### Structured logging (minimum viable monitoring)

Every scheduled handler should log at the start and end with enough context to answer "did it run?" and "what did it do?":

\\\`\\\`\\\`typescript
await boss.work(DELETE_STALE_USERS, async ([job]) => {
  getLogger().info({ jobId: job.id, scheduledFor: job.data }, "Starting delete-stale-users");

  // ... do the work ...

  getLogger().info(
    { jobId: job.id, deleted: staleUsers.length, durationMs: Date.now() - start },
    "Finished delete-stale-users",
  );
});
\\\`\\\`\\\`

In production, pipe these logs to your aggregator (Datadog, Loki, CloudWatch) and set an alert for "no log line matching \\\`Finished delete-stale-users\\\` in 25 hours" — slightly more than the cron interval.

### Query pg-boss tables directly

pg-boss stores job history in Postgres. You can inspect it with Drizzle Studio (\\\`pnpm db:studio\\\`) or raw SQL:

\\\`\\\`\\\`sql
-- Did the job run recently?
SELECT id, state, created_on, started_on, completed_on
FROM pgboss.job
WHERE name = 'delete-stale-users'
ORDER BY created_on DESC
LIMIT 5;

-- What schedules are registered?
SELECT * FROM pgboss.schedule;

-- How many jobs by state?
SELECT state, count(*)
FROM pgboss.job
WHERE name = 'delete-stale-users'
GROUP BY state;
\\\`\\\`\\\`

Job states: \\\`created\\\` → \\\`active\\\` → \\\`completed\\\` (or \\\`failed\\\`, \\\`cancelled\\\`, \\\`expired\\\`).

### Expose via a tRPC admin endpoint (optional)

If you want to check job status from the admin panel without database access, you can add an endpoint. This requires a \\\`getBoss()\\\` export that returns the pg-boss instance.

\\\`\\\`\\\`typescript
// Add to your admin router
import { getBoss } from "../jobs/index.js";

jobStatus: adminProcedure
  .input(z.object({ name: z.string() }))
  .query(async ({ input }) => {
    const boss = getBoss();
    const size = await boss.getQueueSize(input.name);
    const schedules = await boss.getSchedules();
    const schedule = schedules.find((s) => s.name === input.name);

    return {
      queueSize: size,
      cron: schedule?.cron ?? null,
      tz: schedule?.options?.tz ?? "UTC",
    };
  }),
\\\`\\\`\\\`

To support this, add a \\\`getBoss()\\\` getter to your jobs index:

\\\`\\\`\\\`typescript
export function getBoss(): PgBoss {
  if (!boss) throw new Error("pg-boss not initialized");
  return boss;
}
\\\`\\\`\\\`

---

## Step 6: Cleanup Patterns

Scheduled jobs often accumulate data — completed job records in pg-boss tables, stale application data, or temporary artifacts. Plan for cleanup from the start.

### pg-boss auto-cleanup

pg-boss automatically deletes completed/failed jobs after a retention period. The default is 30 days. You can configure it per-queue:

\\\`\\\`\\\`typescript
await boss.createQueue(DELETE_STALE_USERS, {
  retentionDays: 7,  // keep job history for 7 days
});
\\\`\\\`\\\`

Or per-schedule:

\\\`\\\`\\\`typescript
await boss.schedule(DELETE_STALE_USERS, "0 3 * * *", null, {
  retentionDays: 7,
});
\\\`\\\`\\\`

### Application-level cleanup jobs

If your scheduled job creates temporary data, add a companion cleanup job. For example, if you had a \\\`reports\\\` table and generated daily reports that are only needed for 30 days:

\\\`\\\`\\\`typescript
// Create a cleanup handler for old reports
import { getDb } from "../../db/index.js";
import { getLogger } from "../../lib/logger.js";

export const CLEANUP_OLD_REPORTS = "cleanup-old-reports";

export async function registerCleanupOldReportsHandler(boss: PgBoss): Promise<void> {
  await boss.work(CLEANUP_OLD_REPORTS, async ([job]) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const result = await getDb()
      .delete(reports)
      .where(lt(reports.createdAt, cutoff));

    getLogger().info({ jobId: job.id, deleted: result.rowCount }, "Cleaned up old reports");
  });
}
\\\`\\\`\\\`

\\\`\\\`\\\`typescript
// In initJobs() — schedule the cleanup
await boss.schedule(CLEANUP_OLD_REPORTS, "0 4 * * *");  // 4 AM, after the report job
\\\`\\\`\\\`

### Pattern: pair a generator with its cleaner

| Generator | Cleaner | Schedule |
|---|---|---|
| \\\`generate-daily-report\\\` (3 AM) | \\\`cleanup-old-reports\\\` (4 AM) | Keep 30 days |
| \\\`sync-external-data\\\` (every hour) | \\\`cleanup-stale-sync-cache\\\` (daily) | Keep 7 days |
| \\\`send-digest-email\\\` (weekly) | N/A — no artifacts to clean | N/A |

Run the cleaner after the generator to avoid a window where both are fighting over the same data.

---

## Step 7: Retries and Dead Letters

Scheduled jobs should be resilient to transient failures (database timeouts, external API blips). Configure retries on the queue or the schedule.

### On the queue (applies to all jobs in that queue)

\\\`\\\`\\\`typescript
await boss.createQueue(DELETE_STALE_USERS, {
  retryLimit: 3,
  retryDelay: 60,       // 60 seconds between retries
  retryBackoff: true,   // exponential backoff: 60s, 120s, 240s
  deadLetter: "failed-jobs",  // after all retries exhausted, move here
});
\\\`\\\`\\\`

### On the schedule (applies to each enqueued instance)

\\\`\\\`\\\`typescript
await boss.schedule(DELETE_STALE_USERS, "0 3 * * *", null, {
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
});
\\\`\\\`\\\`

### Dead letter queue

A dead letter queue catches jobs that failed all retries. Register a handler that logs or alerts:

\\\`\\\`\\\`typescript
// Create a dead letter handler
export async function registerDeadLetterHandler(boss: PgBoss): Promise<void> {
  await boss.createQueue("failed-jobs");

  await boss.work("failed-jobs", async ([job]) => {
    getLogger().error(
      { originalJob: job.data, jobId: job.id },
      "Job exhausted all retries and moved to dead letter queue",
    );
    // Optionally: send an alert, post to Slack, increment a metric
  });
}
\\\`\\\`\\\`

---

## Step 8: Removing a Schedule

When you no longer need a scheduled job, call \\\`unschedule()\\\` during initialization:

\\\`\\\`\\\`typescript
// In initJobs()
await boss.unschedule("old-job-name");
\\\`\\\`\\\`

Or remove it from the \\\`pgboss.schedule\\\` table directly:

\\\`\\\`\\\`sql
DELETE FROM pgboss.schedule WHERE name = 'old-job-name';
\\\`\\\`\\\`

Don't just remove the \\\`schedule()\\\` call from code — the existing schedule persists in Postgres. You must explicitly unschedule it or it will keep enqueuing jobs (which will fail if the handler is gone).

---

## Step 9: Write Tests

### Test the handler logic directly

Don't test the pg-boss scheduling machinery — test your handler's business logic.

\\\`\\\`\\\`typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/index.js", () => ({ getDb: vi.fn() }));

import type PgBoss from "pg-boss";

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue([
    { id: "user-1", email: "stale@test.com" },
  ]),
  delete: vi.fn().mockReturnThis(),
};

// Replace the getDb import with our mock
vi.doMock("../../db/index.js", () => ({ getDb: () => mockDb }));

import { registerDeleteStaleUsersHandler } from "./deleteStaleUsers.js";

describe("deleteStaleUsers", () => {
  it("registers the handler", async () => {
    const mockBoss = { work: vi.fn() } as unknown as PgBoss;
    await registerDeleteStaleUsersHandler(mockBoss);
    expect(mockBoss.work).toHaveBeenCalledWith("delete-stale-users", expect.any(Function));
  });

  it("deletes stale users", async () => {
    const mockBoss = { work: vi.fn() } as unknown as PgBoss;
    await registerDeleteStaleUsersHandler(mockBoss);

    // Extract the handler that was registered
    const handler = (mockBoss.work as any).mock.calls[0][1] as Function;
    await handler([{ id: "job-1", data: {} }]);

    expect(mockDb.delete).toHaveBeenCalled();
  });

  it("skips when no stale users found", async () => {
    mockDb.where.mockResolvedValueOnce([]);  // no results

    const mockBoss = { work: vi.fn() } as unknown as PgBoss;
    await registerDeleteStaleUsersHandler(mockBoss);

    const handler = (mockBoss.work as any).mock.calls[0][1] as Function;
    await handler([{ id: "job-1", data: {} }]);

    expect(mockDb.delete).not.toHaveBeenCalled();
  });
});
\\\`\\\`\\\`

### Test that schedules are registered at startup

\\\`\\\`\\\`typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("pg-boss", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      start: vi.fn(),
      on: vi.fn(),
      work: vi.fn(),
      schedule: vi.fn(),
    })),
  };
});

vi.mock("./handlers/example.js", () => ({
  registerExampleHandler: vi.fn(),
}));
vi.mock("./handlers/deleteStaleUsers.js", () => ({
  DELETE_STALE_USERS: "delete-stale-users",
  registerDeleteStaleUsersHandler: vi.fn(),
}));

import { initJobs } from "./index.js";
import PgBoss from "pg-boss";

it("registers scheduled jobs on startup", async () => {
  await initJobs("postgresql://mock");

  const bossInstance = (PgBoss as unknown as vi.Mock).mock.results[0].value;
  expect(bossInstance.schedule).toHaveBeenCalledWith(
    "delete-stale-users",
    "0 3 * * *",
  );
});
\\\`\\\`\\\`

---

## Checklist

**Handler**
- [ ] Handler file in the jobs handlers directory with exported job name constant
- [ ] Handler imports \\\`getDb\\\` directly (not from tRPC context)
- [ ] Handler is idempotent — safe to run twice for the same time window
- [ ] Handler logs at start and finish with \\\`jobId\\\`, result counts, and duration
- [ ] Handler registered in \\\`initJobs()\\\`

**Schedule**
- [ ] \\\`boss.schedule()\\\` called in \\\`initJobs()\\\` with the correct cron expression
- [ ] Timezone set via \\\`tz\\\` option if the schedule should follow local time, not UTC
- [ ] Old/removed schedules cleaned up with \\\`boss.unschedule()\\\`

**Resilience**
- [ ] Retries configured (3 retries with backoff is a good default)
- [ ] Dead letter queue set up if failures need human attention
- [ ] Cleanup job exists for any temporary data the scheduled job creates

**Monitoring**
- [ ] Structured log lines at start and finish of every run
- [ ] Alert or check for "job hasn't run in > expected interval" (log aggregator or admin endpoint)

**Tests**
- [ ] Handler business logic tested by extracting and calling the registered function
- [ ] Schedule registration verified in \\\`initJobs\\\` test
- [ ] Idempotency tested — handler called twice produces correct results

---

## Common Scheduled Job Patterns

| Job | Schedule | Key concerns |
|---|---|---|
| **Delete stale accounts** | Daily | Idempotent (deletes are safe to repeat), log count |
| **Send digest emails** | Daily/weekly | Use external service adapter, offload to background job handler |
| **Sync external data** | Hourly | Idempotent (upsert), handle API rate limits, partial failure |
| **Generate reports** | Daily/monthly | Pair with a cleanup job, store results with a date key |
| **Expire temporary tokens** | Hourly | \\\`DELETE WHERE expires_at < NOW()\\\`, log count |
| **Refresh materialized views** | Every 15 min | Postgres \\\`REFRESH MATERIALIZED VIEW CONCURRENTLY\\\` |
| **Health check external APIs** | Every 5 min | Log status, alert on consecutive failures |`,
  },
  {
    name: 'Background Jobs',
    description:
      'pg-boss provides a persistent job queue backed by Postgres. Covers job handlers, enqueuing, retries, concurrency, and scheduling.',
    content: `# Background Jobs

pg-boss provides a persistent job queue backed by the existing Postgres database. No Redis or additional infrastructure. Jobs survive server restarts and support scheduling, retries, and concurrency.

## How It's Wired

\\\`\\\`\\\`typescript
// jobs/index.ts
import PgBoss from "pg-boss";

let boss: PgBoss | null = null;

export async function initJobs(connectionString: string): Promise<void> {
  boss = new PgBoss(connectionString);
  boss.on("error", (error) => getLogger().error({ err: error }, "pg-boss error"));
  await boss.start();
  await boss.createQueue(EXAMPLE_JOB);  // pg-boss v10: required before work()/send()
  await registerExampleHandler(boss);
}

export async function enqueueJob<T extends object>(name: string, data: T): Promise<string | null> {
  if (!boss) throw new Error("pg-boss not initialized");
  return boss.send(name, data);
}
\\\`\\\`\\\`

Lifecycle is managed in the main entry file:

\\\`\\\`\\\`typescript
async function start() {
  await initJobs(connectionString);  // starts pg-boss, registers handlers
  server.listen(env.PORT, () => { ... });
}

async function shutdown() {
  await closeJobs();  // graceful stop
}
\\\`\\\`\\\`

## Example Job (Already Implemented)

\\\`\\\`\\\`typescript
// jobs/handlers/example.ts
export const EXAMPLE_JOB = "example-job";

export async function registerExampleHandler(boss: PgBoss): Promise<void> {
  await boss.work(EXAMPLE_JOB, async ([job]) => {
    getLogger().info({ jobId: job.id, data: job.data }, "Processing example job");
  });
}
\\\`\\\`\\\`

Triggered via tRPC:

\\\`\\\`\\\`typescript
// routers/jobs.ts
enqueue: protectedProcedure
  .input(z.object({ message: z.string().optional() }))
  .mutation(async ({ input }) => {
    const jobId = await enqueueJob(EXAMPLE_JOB, {
      message: input.message ?? "hello from trpc",
      enqueuedAt: Date.now(),
    });
    return { jobId };
  }),
\\\`\\\`\\\`

## How to Implement a New Job

### 1. Create the handler

\\\`\\\`\\\`typescript
// jobs/handlers/sendEmail.ts
import type PgBoss from "pg-boss";
import { getLogger } from "../../lib/logger.js";

export const SEND_EMAIL_JOB = "send-email";

type SendEmailPayload = {
  to: string;
  subject: string;
  body: string;
};

export async function registerSendEmailHandler(boss: PgBoss): Promise<void> {
  await boss.work(SEND_EMAIL_JOB, async ([job]) => {
    const { to, subject, body } = job.data as SendEmailPayload;
    getLogger().info({ jobId: job.id, to, subject }, "Sending email");

    // your email sending logic here
    // await sendgrid.send({ to, subject, html: body });

    getLogger().info({ jobId: job.id }, "Email sent");
  });
}
\\\`\\\`\\\`

### 2. Register it

\\\`\\\`\\\`typescript
// jobs/index.ts
import { registerSendEmailHandler } from "./handlers/sendEmail.js";

export async function initJobs(connectionString: string): Promise<void> {
  // ...existing setup...
  await boss.createQueue(SEND_EMAIL_JOB);  // pg-boss v10: required before work()/send()
  await registerExampleHandler(boss);
  await registerSendEmailHandler(boss);  // add here
}
\\\`\\\`\\\`

### 3. Enqueue from anywhere

\\\`\\\`\\\`typescript
import { enqueueJob } from "../jobs/index.js";
import { SEND_EMAIL_JOB } from "../jobs/handlers/sendEmail.js";

await enqueueJob(SEND_EMAIL_JOB, {
  to: "user@example.com",
  subject: "Welcome!",
  body: "<h1>Hello</h1>",
});
\\\`\\\`\\\`

### 4. (Optional) Expose via tRPC

\\\`\\\`\\\`typescript
// routers/email.ts
sendWelcome: protectedProcedure
  .input(z.object({ userId: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    const [user] = await ctx.db.select().from(users).where(eq(users.id, input.userId));
    const jobId = await enqueueJob(SEND_EMAIL_JOB, {
      to: user.email,
      subject: "Welcome!",
      body: \\\`<h1>Hello \\\${user.name}</h1>\\\`,
    });
    return { jobId };
  }),
\\\`\\\`\\\`

## Advanced pg-boss Features

### Scheduled/delayed jobs

\\\`\\\`\\\`typescript
await boss.send(SEND_EMAIL_JOB, data, {
  startAfter: 30,  // delay 30 seconds
});

// Or with a cron schedule
await boss.schedule(SEND_EMAIL_JOB, "0 9 * * *", data);  // daily at 9am
\\\`\\\`\\\`

### Retries

\\\`\\\`\\\`typescript
await boss.send(SEND_EMAIL_JOB, data, {
  retryLimit: 3,
  retryDelay: 60,  // 60 seconds between retries
});
\\\`\\\`\\\`

### Concurrency

\\\`\\\`\\\`typescript
await boss.work(SEND_EMAIL_JOB, { batchSize: 5 }, async (jobs) => {
  // processes up to 5 jobs at a time
  for (const job of jobs) { /* ... */ }
});
\\\`\\\`\\\`

## How to Test

Mock \\\`enqueueJob\\\` in router tests:

\\\`\\\`\\\`typescript
vi.mock("../jobs/index.js", () => ({
  enqueueJob: vi.fn().mockResolvedValue("job-123"),
}));

import { enqueueJob } from "../jobs/index.js";

it("enqueues a job", async () => {
  const caller = appRouter.createCaller({ user: { sub: "u1" }, db: mockDb, pubsub: mockPubsub });
  const result = await caller.jobs.enqueue({ message: "test" });

  expect(result.jobId).toBe("job-123");
  expect(enqueueJob).toHaveBeenCalledWith("example-job", expect.objectContaining({ message: "test" }));
});
\\\`\\\`\\\`

For handler tests, call the handler function directly:

\\\`\\\`\\\`typescript
import type PgBoss from "pg-boss";

it("processes the job", async () => {
  const mockBoss = { work: vi.fn() } as unknown as PgBoss;
  await registerSendEmailHandler(mockBoss);

  // Get the handler that was registered
  const handler = mockBoss.work.mock.calls[0][1] as Function;
  await handler([{ id: "job-1", data: { to: "a@b.com", subject: "Hi", body: "Hello" } }]);

  // Assert on side effects (email sent, logger called, etc.)
});
\\\`\\\`\\\`

## How to Debug

- **Jobs not running?** Check that \\\`initJobs()\\\` completed successfully at startup (look for "pg-boss started" in logs). If it fails, pg-boss can't create its schema tables — check your DATABASE_URL.
- **Job stuck in "active"?** If the server crashes mid-job, pg-boss marks it as expired after a timeout (default 15 min). Check with: \\\`SELECT * FROM pgboss.job WHERE name = 'your-job' AND state = 'active'\\\`.
- **Job failed silently?** pg-boss catches handler errors and moves the job to "failed" state. Check: \\\`SELECT * FROM pgboss.job WHERE name = 'your-job' AND state = 'failed'\\\`.
- **pg-boss tables not created?** pg-boss auto-creates its \\\`pgboss\\\` schema on first \\\`boss.start()\\\`. If your DB user lacks CREATE SCHEMA permissions, it will fail.
- **Want to inspect the queue?** Use Drizzle Studio (\\\`pnpm db:studio\\\`) and look at the \\\`pgboss.job\\\` table, or query directly: \\\`SELECT state, count(*) FROM pgboss.job GROUP BY state\\\`.`,
  },
  {
    name: 'Real-Time Sync',
    description:
      'When one client writes data, all connected clients see the update instantly. Uses Postgres LISTEN/NOTIFY piped through tRPC WebSocket subscriptions.',
    content: `# Real-Time Sync

When one client writes data, all connected clients see the update instantly. This uses Postgres LISTEN/NOTIFY piped through tRPC WebSocket subscriptions — no polling, no Redis, no extra infrastructure.

## How It Works

\\\`\\\`\\\`
Client A mutation
  → API writes to DB
  → API publishes SyncEvent via Postgres NOTIFY
  → PgPubSub dispatches to all subscribers
  → tRPC subscription yields event to all connected WebSocket clients
  → Client B's hook receives event, updates React Query cache
\\\`\\\`\\\`

Key files:
- PgPubSub class wrapping Postgres LISTEN/NOTIFY
- Async generator bridging PubSub into tRPC subscriptions
- SyncEvent and SyncAction types in the shared schemas package
- Client-side hooks for cache updates on sync events

## Example: The User Sync (Already Implemented)

### API side

\\\`\\\`\\\`typescript
// In the user router

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
\\\`\\\`\\\`

### Client side

\\\`\\\`\\\`typescript
// In the useUsers hook
import { useSyncSubscription } from "@myapp/hooks";

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
\\\`\\\`\\\`

### Date Serialization

When data travels over the wire as JSON, \\\`Date\\\` objects are automatically serialized to ISO 8601 strings. The server-side Zod schema defines fields like \\\`createdAt\\\` as \\\`z.date()\\\`, but by the time data reaches the client via tRPC (either through queries or sync events), these become strings.

Client hook type definitions reflect this: \\\`SerializedUser\\\` declares \\\`createdAt: string\\\` and \\\`lastLoginAt: string | null\\\`. This is why the client type is defined manually rather than inferred from the Zod schema -- the wire format differs from the server type. No custom transformer is needed; tRPC handles the JSON serialization transparently.

## How to Implement for a New Entity

### 1. Add the subscription to your router

After creating your entity schemas, the router would look like:

\\\`\\\`\\\`typescript
// Create a new entity router
import { tracked } from "@trpc/server";
import { syncChannel, type SyncEvent, type Post } from "@myapp/shared";
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
\\\`\\\`\\\`

### 2. Subscribe in your client hook

\\\`\\\`\\\`typescript
// Create a new entity hook
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
\\\`\\\`\\\`

### Alternative: Use the generic \\\`useSyncSubscription\\\` hook

\\\`useSyncSubscription\\\` is already generic -- it accepts any tRPC subscription procedure as its first argument:

\\\`\\\`\\\`typescript
// Signature from the sync subscription utility
function useSyncSubscription<T>(
  subscription: SyncSubscriptionHook,
  updaters: CacheUpdater<T>,
): void
\\\`\\\`\\\`

For a new entity, pass the corresponding subscription procedure:

\\\`\\\`\\\`typescript
import { useSyncSubscription } from "@myapp/hooks";

useSyncSubscription<Post>(trpc.post.onSync, {
  onCreated: (post) => utils.post.list.setData(undefined, (old) => [...(old ?? []), post]),
  onUpdated: (post) => utils.post.list.setData(undefined, (old) =>
    old ? old.map((p) => (p.id === post.id ? post : p)) : old
  ),
  onDeleted: () => utils.post.list.invalidate(),
});
\\\`\\\`\\\`

## How to Test

Sync events are just pubsub publishes. Test that mutations call \\\`ctx.pubsub.publish\\\`:

\\\`\\\`\\\`typescript
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
\\\`\\\`\\\`

## How to Debug

- **Events not arriving?** Check the WebSocket connection in browser DevTools (Network → WS tab). You should see the tRPC subscription frame. If the connection drops, check CORS and that the WS URL resolves correctly.
- **Stale cache after sync?** Make sure your \\\`setData\\\` callback returns a new array, not a mutation of the old one. React Query uses reference equality.
- **Events from other server instances?** PgPubSub uses Postgres NOTIFY, which broadcasts across all connections to the same database. Multi-instance works out of the box.
- **Subscription never yields?** Check that your mutation actually calls \\\`ctx.pubsub.publish()\\\` and that the channel names match (\\\`syncChannel("entity")\\\` on both sides).`,
  },
  {
    name: 'Notifications',
    description:
      'Push notifications (mobile), in-app toasts (web + mobile), and a paginated notification history view. One function call persists to DB, publishes a real-time sync event, and fires mobile push.',
    content: `# Notifications

Push notifications (mobile), in-app toasts (web + mobile), and a paginated notification history view. One function call persists to DB, publishes a real-time sync event, and fires mobile push — no separate steps.

## How It's Wired

\\\`\\\`\\\`
sendNotification(db, pubsub, target, payload)
  → inserts into \\\`notifications\\\` table
  → publishes SyncEvent on "notification" channel (Postgres LISTEN/NOTIFY)
  → looks up push tokens for eligible users (opt-out check)
  → calls push adapter (Expo in prod, console in dev)
\\\`\\\`\\\`

The notification service takes \\\`db\\\` and \\\`pubsub\\\` as explicit parameters (dependency injection). It can be called from tRPC procedures, pg-boss job handlers, or any server-side code that has access to a database connection and pubsub instance.

## Data Model

### \\\`notifications\\\` table

| Column | Type | Notes |
|--------|------|-------|
| \\\`id\\\` | uuid | PK, auto-generated |
| \\\`userId\\\` | uuid | FK → users.id, cascade delete |
| \\\`title\\\` | varchar(255) | Required |
| \\\`body\\\` | varchar(2000) | Required |
| \\\`actionUrl\\\` | varchar(500) | Nullable — navigates on click |
| \\\`read\\\` | boolean | Default false |
| \\\`createdAt\\\` | timestamptz | Default now |

### \\\`push_tokens\\\` table

| Column | Type | Notes |
|--------|------|-------|
| \\\`id\\\` | uuid | PK, auto-generated |
| \\\`userId\\\` | uuid | FK → users.id, cascade delete |
| \\\`token\\\` | varchar(255) | Unique — Expo push token |
| \\\`createdAt\\\` | timestamptz | Default now |

### \\\`users\\\` table addition

| Column | Type | Notes |
|--------|------|-------|
| \\\`pushOptOut\\\` | boolean | Default false — suppresses push only, toasts still appear |

Schema definition in the database schema file.

## Zod Schemas

All schemas live in the shared schemas package and are re-exported from the schemas index.

\\\`\\\`\\\`typescript
import {
  CreateNotificationSchema,  // { title, body, actionUrl? }
  NotificationSchema,        // full notification with id, userId, read, createdAt
  PushTokenSchema,           // { id, userId, token, createdAt }
  RegisterPushTokenSchema,   // { token }
  NotificationListInputSchema, // { cursor?, limit }
  UpdatePushOptOutSchema,    // { optOut }
  type Notification,
  type CreateNotification,
  type PushToken,
  type RegisterPushToken,
  type NotificationListInput,
  type UpdatePushOptOut,
} from "@myapp/shared";
\\\`\\\`\\\`

## Sending Notifications

### From a tRPC procedure or job handler

\\\`\\\`\\\`typescript
import { sendNotification } from "../../services/notifications/index.js";

// Single user
const result = await sendNotification(db, pubsub, { userId: "user-uuid" }, {
  title: "New comment",
  body: "Someone commented on your post",
  actionUrl: "/posts/123",
});

// Multiple users
const result = await sendNotification(db, pubsub, { userIds: ["id-1", "id-2"] }, {
  title: "Update available",
  body: "Version 2.0 is out",
});
\\\`\\\`\\\`

### Broadcast to all users

\\\`\\\`\\\`typescript
import { broadcastNotification } from "../../services/notifications/index.js";

const result = await broadcastNotification(db, pubsub, {
  title: "System maintenance",
  body: "Scheduled downtime tonight at 11pm",
});
\\\`\\\`\\\`

### Return value

Both functions return:

\\\`\\\`\\\`typescript
{
  notificationIds: string[];
  pushResults: { sent: number; skipped: number; failed: number };
}
\\\`\\\`\\\`

- \\\`sent\\\` — push notifications delivered
- \\\`skipped\\\` — users who opted out of push
- \\\`failed\\\` — push delivery failures (stale tokens auto-cleaned)

### From a pg-boss job

The welcome notification job shows the pattern for calling \\\`sendNotification\\\` from a background job:

\\\`\\\`\\\`typescript
import { sendNotification } from "../../services/notifications/index.js";
import { getDb, getConnectionString } from "../../db/index.js";
import { PgPubSub } from "../../pubsub.js";

// Inside a job handler:
const db = getDb();
const pubsub = new PgPubSub(getConnectionString());

try {
  await sendNotification(db, pubsub, { userId }, {
    title: "Thanks for registering!",
    body: "Welcome! Explore the app to get started.",
  });
} finally {
  await pubsub.close();  // always close the pubsub instance you created
}
\\\`\\\`\\\`

Job handlers create their own \\\`PgPubSub\\\` instance because they run outside the HTTP request lifecycle. Always close it in a \\\`finally\\\` block.

## tRPC Router

The notification router — all endpoints require authentication (\\\`protectedProcedure\\\`).

| Procedure | Type | Input | Description |
|-----------|------|-------|-------------|
| \\\`list\\\` | query | \\\`{ cursor?, limit }\\\` | Paginated list, newest first |
| \\\`unreadCount\\\` | query | — | Count of unread notifications |
| \\\`markRead\\\` | mutation | \\\`{ id }\\\` | Mark one notification as read (ownership checked) |
| \\\`markUnread\\\` | mutation | \\\`{ id }\\\` | Mark one notification as unread (ownership checked) |
| \\\`markAllRead\\\` | mutation | — | Mark all unread notifications as read |
| \\\`onSync\\\` | subscription | — | Real-time sync events for the notification channel |
| \\\`registerPushToken\\\` | mutation | \\\`{ token }\\\` | Upsert an Expo push token for the current user |
| \\\`updatePushOptOut\\\` | mutation | \\\`{ optOut }\\\` | Toggle push notification opt-out |

All queries and mutations scope to the authenticated user. \\\`markRead\\\`/\\\`markUnread\\\` verify notification ownership before updating.

## Push Adapter

The push system uses the adapter pattern (see the Adding an External Service spec).

\\\`\\\`\\\`
packages/api/src/services/push/
  types.ts      ← PushAdapter type, SendPushParams, SendPushResult
  console.ts    ← Dev adapter (logs to Pino, returns success)
  expo.ts       ← Expo Push API adapter (batches in chunks of 100)
  index.ts      ← Factory: getPushAdapter(), setPushAdapter(), resetPushAdapter()
\\\`\\\`\\\`

### Adapter selection

- No \\\`PUSH_PROVIDER\\\` env var → console adapter (dev mode, no real pushes)
- \\\`PUSH_PROVIDER=expo\\\` → Expo adapter (requires \\\`EXPO_ACCESS_TOKEN\\\`)

### Stale token cleanup

When the Expo API returns \\\`DeviceNotRegistered\\\`, the notification service automatically deletes the stale push token from the \\\`push_tokens\\\` table. No manual cleanup needed.

## Client Hooks

Both hooks live in the hooks package and are re-exported from the hooks index.

### \\\`useNotifications()\\\`

\\\`\\\`\\\`typescript
import { useNotifications } from "@myapp/hooks";

const {
  notifications,   // Notification[] — current page
  isLoading,       // boolean
  error,           // string | null
  hasNextPage,     // boolean
  fetchNextPage,   // () => void
  unreadCount,     // number
  markRead,        // (input: { id: string }) => Promise
  markUnread,      // (input: { id: string }) => Promise
  markAllRead,     // () => Promise
} = useNotifications();
\\\`\\\`\\\`

Automatically syncs in real-time via \\\`useSyncSubscription\\\` — new notifications appear instantly, read/unread state updates propagate across tabs.

### \\\`useNotificationToast(onNotification)\\\`

\\\`\\\`\\\`typescript
import { useNotificationToast } from "@myapp/hooks";

useNotificationToast((notification) => {
  // notification: { id, title, body, actionUrl }
  // Show a toast, Alert, or whatever your platform supports
});
\\\`\\\`\\\`

Framework-agnostic — the callback receives the notification data and you decide how to display it. Fires only for \\\`created\\\` sync events (new notifications).

## UI Components

### Web

- **NotificationToast** — Fixed-position toast stack in top-right. Auto-dismisses after 5 seconds. Click navigates to \\\`actionUrl\\\`. Rendered in the app layout so it's always active.
- **NotificationList** — Paginated notification list with mark read/unread, mark all read, relative timestamps. Used in the Profile page.
- **Unread badge** — Navbar shows unread count badge when > 0.

### Mobile

- **Notifications tab** — FlatList with infinite scroll, long-press to toggle read/unread, tap to navigate to \\\`actionUrl\\\`, mark all as read button.
- **Push token registration** — Registers Expo push token on app launch via \\\`registerPushToken\\\` mutation. Uses a ref guard to prevent duplicate registrations.
- **Push opt-out toggle** — Switch component calling \\\`updatePushOptOut\\\` mutation.
- **Toast on foreground** — Mobile shows an Alert when a notification arrives while the app is in the foreground.

## Welcome Notification (Example)

A built-in example that exercises the full pipeline end-to-end. When a user registers, a pg-boss job fires and sends:

> **Thanks for registering!**
> Welcome! Explore the app to get started.

Implementation:
- Job handler for sending the welcome notification
- Job registration: queue created and handler registered at startup in the jobs index
- Trigger: user \\\`create\\\` mutation enqueues the job with \\\`{ userId }\\\` after inserting the user

## How to Add a New Notification Type

### 1. Send from server-side code

\\\`\\\`\\\`typescript
import { sendNotification } from "../services/notifications/index.js";

// In a tRPC procedure:
await sendNotification(ctx.db, ctx.pubsub, { userId: targetUserId }, {
  title: "Order shipped",
  body: \\\`Your order #\\\${orderId} is on its way!\\\`,
  actionUrl: \\\`/orders/\\\${orderId}\\\`,
});
\\\`\\\`\\\`

### 2. Send from a background job

Create a job handler following the Background Jobs pattern:

\\\`\\\`\\\`typescript
// Create a job handler for order shipped notifications
import type PgBoss from "pg-boss";
import { getDb, getConnectionString } from "../../db/index.js";
import { PgPubSub } from "../../pubsub.js";
import { sendNotification } from "../../services/notifications/index.js";

export const ORDER_SHIPPED_JOB = "order-shipped";

export async function registerOrderShippedHandler(boss: PgBoss): Promise<void> {
  await boss.work(ORDER_SHIPPED_JOB, async ([job]) => {
    const { userId, orderId } = job.data as { userId: string; orderId: string };
    const db = getDb();
    const pubsub = new PgPubSub(getConnectionString());

    try {
      await sendNotification(db, pubsub, { userId }, {
        title: "Order shipped",
        body: \\\`Your order #\\\${orderId} is on its way!\\\`,
        actionUrl: \\\`/orders/\\\${orderId}\\\`,
      });
    } finally {
      await pubsub.close();
    }
  });
}
\\\`\\\`\\\`

Then register it in your jobs index:

\\\`\\\`\\\`typescript
import { registerOrderShippedHandler, ORDER_SHIPPED_JOB } from "./handlers/orderShipped.js";

// In initJobs():
await boss.createQueue(ORDER_SHIPPED_JOB);
await registerOrderShippedHandler(boss);
\\\`\\\`\\\`

### 3. Enqueue from anywhere

\\\`\\\`\\\`typescript
import { enqueueJob } from "../jobs/index.js";
import { ORDER_SHIPPED_JOB } from "../jobs/handlers/orderShipped.js";

await enqueueJob(ORDER_SHIPPED_JOB, { userId, orderId });
\\\`\\\`\\\`

That's it. The notification service handles persistence, real-time sync, push delivery, opt-out checking, and stale token cleanup automatically.

## Push Notification Setup

Push notifications require credentials from Apple and Google, configured through Expo's EAS Build system.

### Prerequisites (manual, one-time)

1. **Apple Developer Account** — Required for APNs (Apple Push Notification service)
   - Generate an APNs key (.p8 file) in the Apple Developer portal
   - Note the Key ID and Team ID

2. **Google Firebase project** — Required for FCM (Firebase Cloud Messaging)
   - Create a Firebase project and download \\\`google-services.json\\\`
   - Enable Cloud Messaging API

3. **Expo account** — Required to proxy push through Expo's service
   - Create a project at expo.dev
   - Generate an access token

### Env vars

| Variable | Required | Description |
|----------|----------|-------------|
| \\\`PUSH_PROVIDER\\\` | No | Set to \\\`expo\\\` to enable real push delivery |
| \\\`EXPO_ACCESS_TOKEN\\\` | When \\\`PUSH_PROVIDER=expo\\\` | Expo push service access token |

## How to Test

### Schema tests

\\\`\\\`\\\`typescript
// 18 tests covering all Zod schemas — validation, defaults, edge cases
\\\`\\\`\\\`

### Service tests

\\\`\\\`\\\`typescript
// 7 tests: single/multi/broadcast, opt-out, no tokens, DeviceNotRegistered cleanup, push failure resilience
\\\`\\\`\\\`

### Router tests

\\\`\\\`\\\`typescript
// 16 tests: pagination, auth, ownership, upsert, opt-out, unread count
\\\`\\\`\\\`

### Push adapter tests

\\\`\\\`\\\`typescript
// 11 tests: console (2), expo (6), factory (3)
\\\`\\\`\\\`

### Job handler tests

\\\`\\\`\\\`typescript
// 3 tests: happy path, pubsub cleanup, error handling
\\\`\\\`\\\`

Mock \\\`sendNotification\\\` in your own tests:

\\\`\\\`\\\`typescript
vi.mock("../../services/notifications/index.js", () => ({
  sendNotification: vi.fn().mockResolvedValue({
    notificationIds: ["notif-1"],
    pushResults: { sent: 1, skipped: 0, failed: 0 },
  }),
}));
\\\`\\\`\\\`

## How to Debug

- **Notifications not appearing?** Check that \\\`sendNotification()\\\` was called — look for the DB insert in Drizzle Studio (\\\`pnpm db:studio\\\`, \\\`notifications\\\` table).
- **Toasts not showing?** Verify the NotificationToast component is mounted in your app layout and that the WebSocket subscription is connected (check browser DevTools network tab for WS frames on the notification channel).
- **Push not delivered?** Check logs for "Push adapter: console" — means \\\`PUSH_PROVIDER\\\` is not set. For Expo, look for "Expo Push API error" or "Expo push ticket error" in logs.
- **Push delivered but not received on device?** Verify the device token is in the \\\`push_tokens\\\` table. Check that \\\`pushOptOut\\\` is \\\`false\\\` for the user. On iOS, ensure push permissions were granted.
- **Stale tokens?** They're cleaned automatically when Expo returns \\\`DeviceNotRegistered\\\`. Check logs for "Deleted stale push tokens".
- **Welcome notification not sent on registration?** Check that the welcome notification queue was created in \\\`initJobs()\\\` and that \\\`enqueueJob\\\` is called in the user \\\`create\\\` mutation. Check pg-boss job state: \\\`SELECT * FROM pgboss.job WHERE name = 'welcome-notification'\\\`.`,
  },
  {
    name: 'Adding a New Entity',
    description:
      'Step-by-step guide for adding a new data entity end-to-end: Zod schemas, Drizzle table, tRPC router, client hook, frontend view, RBAC, and tests.',
    content: `# Adding a New Entity

Step-by-step guide for adding a new data entity (table, types, API, frontend, real-time sync, tests). This is the most common workflow — follow it top to bottom whenever you add something like posts, comments, projects, invoices, etc.

This guide uses "posts" as the example. Replace with your entity name throughout.

> **Note:** This is a step-by-step guide for future implementation. The example code shown below does not exist in the codebase yet -- it is a worked example. To add a new entity, follow the steps below and create each file as described.

## Overview of Files You'll Touch

\\\`\\\`\\\`
packages/shared/src/schemas/post.ts       <- Zod schemas (source of truth for types)
packages/shared/src/schemas/index.ts      <- Re-export new schemas
packages/api/src/db/schema.ts             <- Drizzle table definition
packages/api/src/routers/post.ts          <- tRPC router (CRUD + sync)
packages/api/src/routers/index.ts         <- Wire router into appRouter
packages/hooks/src/hooks/usePosts.ts      <- React Query hook with real-time sync
packages/hooks/src/index.ts               <- Re-export the hook
packages/web/src/views/Posts.tsx           <- Frontend view
packages/web/src/App.tsx                   <- Route
packages/web/src/components/NavBar.tsx     <- Nav link
packages/shared/src/schemas/post.test.ts  <- Schema tests
packages/api/src/routers/post.test.ts     <- Router tests
\\\`\\\`\\\`

---

## Step 1: Define the Zod Schemas

This is the source of truth. Every other layer derives its types from here.

\\\`\\\`\\\`typescript
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
\\\`\\\`\\\`

Then re-export from the barrel:

\\\`\\\`\\\`typescript
// packages/shared/src/schemas/index.ts — add these lines
export {
  CreatePostSchema,
  PostSchema,
  type Post,
  type CreatePost,
} from "./post.js";
\\\`\\\`\\\`

Rebuild shared so downstream packages see the new types:

\\\`\\\`\\\`bash
pnpm build --filter=@myapp/shared
\\\`\\\`\\\`

> **Why Zod?** The schemas serve triple duty: runtime validation on API inputs, TypeScript types via \\\`z.infer\\\`, and documentation of the data shape. Change the schema and the compiler tells you everywhere that needs updating.

---

## Step 2: Define the Database Table

\\\`\\\`\\\`typescript
// packages/api/src/db/schema.ts — add below the users table
export const posts = pgTable("posts", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  body: varchar("body", { length: 10000 }).notNull(),
  authorId: uuid("author_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
\\\`\\\`\\\`

Generate and apply the migration:

\\\`\\\`\\\`bash
pnpm db:generate   # creates SQL migration in packages/api/drizzle/
pnpm db:migrate    # applies it to Postgres
\\\`\\\`\\\`

**Keep the Drizzle schema and Zod schema aligned.** The Drizzle table is what Postgres sees; the Zod schema is what the API and clients see. They don't have to be identical (the Zod schema might omit internal columns or transform types), but the fields clients interact with should match.

---

## Step 3: Create the tRPC Router

\\\`\\\`\\\`typescript
// packages/api/src/routers/post.ts
import { z } from "zod";
import { eq } from "drizzle-orm";
import { tracked, TRPCError } from "@trpc/server";
import {
  CreatePostSchema,
  syncChannel,
  type SyncEvent,
  type Post,
} from "@myapp/shared";
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
\\\`\\\`\\\`

#### Update Mutations

Many entities need an update mutation beyond create and delete. The user router includes a \\\`touch\\\` mutation that updates a single field:

\\\`\\\`\\\`typescript
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
\\\`\\\`\\\`

For full entity updates, use \\\`UpdateEntitySchema\\\` (a partial of the create schema plus the entity ID) as the input, and \\\`.set()\\\` only the fields provided.

Wire it into the app router:

\\\`\\\`\\\`typescript
// packages/api/src/routers/index.ts
import { postRouter } from "./post.js";

export const appRouter = router({
  user: userRouter,
  admin: adminRouter,
  jobs: jobsRouter,
  post: postRouter,  // add here
});
\\\`\\\`\\\`

**Key decisions:**
- \\\`publicProcedure\\\` vs \\\`protectedProcedure\\\` vs \\\`adminProcedure\\\` — choose based on who should access each operation
- Every mutation that changes data should publish a \\\`SyncEvent\\\` so connected clients stay in sync
- Use \\\`satisfies SyncEvent<typeof post>\\\` for type safety on the published event

---

## Step 3b: Add Role-Based Access (If Needed)

Not every entity needs role restrictions — the basic example above uses \\\`protectedProcedure\\\` (any logged-in user) for writes and \\\`publicProcedure\\\` for reads. But if your entity needs admin-only operations or owner-only access, here's how.

### Admin-only operations

Import \\\`adminProcedure\\\` from the middleware and use it instead of \\\`protectedProcedure\\\`:

\\\`\\\`\\\`typescript
// packages/api/src/routers/post.ts
import { adminProcedure } from "../middleware/requireRole.js";

export const postRouter = router({
  list: publicProcedure.query(/* ... */),           // anyone can read
  create: protectedProcedure.mutation(/* ... */),    // any logged-in user can create
  delete: adminProcedure.mutation(/* ... */),         // only admins can delete
});
\\\`\\\`\\\`

\\\`adminProcedure\\\` does everything \\\`protectedProcedure\\\` does (JWT required) plus it looks up the caller's email in the \\\`users\\\` table and checks \\\`role === "admin"\\\`. If the check fails, it throws \\\`FORBIDDEN\\\`.

### Owner-only operations

For operations where a user should only modify their own records (e.g., "only the author can edit their post"), add an ownership check inside the procedure:

\\\`\\\`\\\`typescript
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
\\\`\\\`\\\`

### Mixed access patterns

A common pattern is different access levels per operation:

| Operation | Procedure | Who can do it |
|---|---|---|
| \\\`list\\\` | \\\`publicProcedure\\\` | Anyone |
| \\\`create\\\` | \\\`protectedProcedure\\\` | Any logged-in user |
| \\\`update\\\` | \\\`protectedProcedure\\\` + ownership check | Author or admin |
| \\\`delete\\\` | \\\`adminProcedure\\\` | Admins only |

### Handling FORBIDDEN on the client

When a procedure throws \\\`FORBIDDEN\\\`, the tRPC error has \\\`data.code === "FORBIDDEN"\\\`. Handle it in the UI:

\\\`\\\`\\\`typescript
const { data, error } = trpc.post.list.useQuery();

if (error?.data?.code === "FORBIDDEN") {
  return <div>You don't have permission to view this.</div>;
}
\\\`\\\`\\\`

The Admin view already demonstrates this pattern — it shows a "Claim Admin" button when the listUsers query returns FORBIDDEN.

---

## Step 4: Create the Client Hook

\\\`\\\`\\\`typescript
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
\\\`\\\`\\\`

Re-export from the hooks barrel:

\\\`\\\`\\\`typescript
// packages/hooks/src/index.ts — add this line
export { usePosts } from "./hooks/usePosts.js";
\\\`\\\`\\\`

**Why \\\`useSyncSubscription\\\` instead of raw \\\`useSubscription\\\`?** The \\\`useSyncSubscription\\\` helper wraps tRPC's \\\`useSubscription\\\` and dispatches \\\`SyncEvent\\\` actions to typed callbacks (\\\`onCreated\\\`, \\\`onUpdated\\\`, \\\`onDeleted\\\`). It eliminates the boilerplate switch statement and keeps every entity hook consistent.

**Why \\\`SerializedPost\\\` instead of the Zod \\\`Post\\\` type?** Dates come over the wire as ISO strings, not \\\`Date\\\` objects. The serialized type matches what tRPC actually delivers. The Zod schema defines the canonical shape; the serialized type is what the client works with.

**Why both \\\`onSync\\\` and \\\`onSuccess: invalidate()\\\`?** The sync subscription handles updates from _other_ clients. The \\\`onSuccess\\\` invalidation handles the current client's own mutations as a fallback (in case the WebSocket event arrives late or the subscription isn't active).

---

## Step 5: Build the Frontend View

\\\`\\\`\\\`tsx
// packages/web/src/views/Posts.tsx
import { useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { usePosts } from "@myapp/hooks";

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
\\\`\\\`\\\`

Add the route and nav link:

\\\`\\\`\\\`typescript
// packages/web/src/App.tsx — add import and route
import { Posts } from "./views/Posts.js";

<Route path="/posts" element={<Posts />} />
\\\`\\\`\\\`

\\\`\\\`\\\`typescript
// packages/web/src/components/NavBar.tsx — add link alongside Users
<Link
  to="/posts"
  className={\\\`no-underline font-medium \\\${isActive("/posts") ? "text-gray-900" : "text-gray-500"}\\\`}
>
  Posts
</Link>
\\\`\\\`\\\`

---

## Step 6: Add Seed Data (Optional)

\\\`\\\`\\\`typescript
// packages/api/src/db/seed.ts — add to the seed script
const seedPosts = [
  { title: "Welcome", body: "First post in the system.", authorId: "550e8400-e29b-41d4-a716-446655440000" },
  { title: "Getting Started", body: "Here's how to use the app.", authorId: "660e8400-e29b-41d4-a716-446655440000" },
];

for (const post of seedPosts) {
  const existing = await db.select().from(posts).where(eq(posts.title, post.title)).limit(1);
  if (existing.length === 0) {
    await db.insert(posts).values(post);
    console.log(\\\`  Created post: \\\${post.title}\\\`);
  } else {
    console.log(\\\`  Skipped post: \\\${post.title} (already exists)\\\`);
  }
}
\\\`\\\`\\\`

Don't forget to import \\\`posts\\\` from the schema at the top of the seed file.

---

## Step 7: Write Tests

### Schema tests

\\\`\\\`\\\`typescript
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
\\\`\\\`\\\`

### Router tests

\\\`\\\`\\\`typescript
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
\\\`\\\`\\\`

Run all tests to verify:

\\\`\\\`\\\`bash
pnpm test
\\\`\\\`\\\`

---

## Step 8: Build and Verify

\\\`\\\`\\\`bash
pnpm build       # all packages compile
pnpm typecheck   # no type errors
pnpm test        # all tests pass
\\\`\\\`\\\`

If everything passes, the entity is fully integrated. Start the dev server (\\\`pnpm dev\\\`) and verify the UI works end-to-end.

---

## Checklist

Use this to make sure you haven't missed a layer:

**Types & Schema**
- [ ] Zod schemas in \\\`packages/shared/src/schemas/\\\` with types exported
- [ ] Schemas re-exported from \\\`packages/shared/src/schemas/index.ts\\\`
- [ ] Drizzle table in \\\`packages/api/src/db/schema.ts\\\`
- [ ] Migration generated (\\\`pnpm db:generate\\\`) and applied (\\\`pnpm db:migrate\\\`)

**API**
- [ ] tRPC router with CRUD operations + \\\`onSync\\\` subscription
- [ ] Router wired into \\\`packages/api/src/routers/index.ts\\\`
- [ ] Correct procedure type per operation (\\\`publicProcedure\\\` / \\\`protectedProcedure\\\` / \\\`adminProcedure\\\`)
- [ ] Owner-only operations check \\\`authorId === ctx.user.sub\\\` (with admin bypass if applicable)
- [ ] Every mutation publishes a \\\`SyncEvent\\\` via \\\`ctx.pubsub.publish()\\\`

**Client**
- [ ] Client hook in \\\`packages/hooks/src/hooks/\\\` with sync subscription
- [ ] Hook re-exported from \\\`packages/hooks/src/index.ts\\\`
- [ ] Frontend view handles \\\`FORBIDDEN\\\` errors gracefully (not just generic error)
- [ ] Frontend view with form (auth-gated) and list
- [ ] Route added in \\\`App.tsx\\\` (with \\\`AuthGuard\\\` wrapper if the page requires login)
- [ ] Nav link added in \\\`NavBar.tsx\\\` (if needed)

**Quality**
- [ ] Schema tests in \\\`packages/shared\\\`
- [ ] Router tests in \\\`packages/api\\\` (including auth and role checks)
- [ ] \\\`pnpm build && pnpm typecheck && pnpm test\\\` passes`,
  },
  {
    name: 'Adding Sub-Entities',
    description:
      'How to add data that belongs to an existing entity: foreign keys, parent-scoped queries, joins, cascading deletes, nested schemas, and real-time sync decisions.',
    content: `# Adding Sub-Entities

How to add data that belongs to an existing entity — comments on a post, tasks in a project, line items on an invoice, notes on a user. The parent already exists; you're adding children that reference it with a foreign key.

This guide builds on the Adding a New Entity guide. If the parent entity doesn't exist yet, do that first. This guide covers the parts that are different when there's a relationship: foreign keys, join queries, cascading deletes, nested Zod schemas, and what to publish for real-time sync.

This guide uses "notes that belong to a user" as the example. Replace with your entities throughout.

> **Note:** This is a step-by-step guide for future implementation. The example code shown below does not exist in the codebase yet -- it is a worked example. To add a sub-entity, follow the steps below and create each file as described.

## Overview of Files You'll Touch

Same set as adding any entity, plus you'll modify the parent's router and hook to expose the children.

\\\`\\\`\\\`
packages/shared/src/schemas/note.ts       <- Zod schemas (references parent ID)
packages/shared/src/schemas/index.ts      <- Re-export
packages/api/src/db/schema.ts             <- Drizzle table with foreign key
packages/api/src/routers/note.ts          <- tRPC router (scoped to parent)
packages/api/src/routers/index.ts         <- Wire into appRouter
packages/hooks/src/hooks/useNotes.ts      <- React Query hook (takes parentId)
packages/hooks/src/index.ts               <- Re-export
packages/web/src/views/Notes.tsx          <- UI (or inline in parent view)
\\\`\\\`\\\`

---

## Step 1: Define the Zod Schemas

The create schema takes the parent ID as a required field. This is how the client tells the API which parent the child belongs to.

\\\`\\\`\\\`typescript
// packages/shared/src/schemas/note.ts
import { z } from "zod";

export const CreateNoteSchema = z.object({
  userId: z.string().uuid(),
  content: z.string().min(1, "Content is required"),
});

export const NoteSchema = CreateNoteSchema.extend({
  id: z.string().uuid(),
  createdAt: z.date(),
});

export type Note = z.infer<typeof NoteSchema>;
export type CreateNote = z.infer<typeof CreateNoteSchema>;
\\\`\\\`\\\`

Re-export from the barrel:

\\\`\\\`\\\`typescript
// packages/shared/src/schemas/index.ts — add these lines
export {
  CreateNoteSchema,
  NoteSchema,
  type Note,
  type CreateNote,
} from "./note.js";
\\\`\\\`\\\`

Rebuild shared:

\\\`\\\`\\\`bash
pnpm build --filter=@myapp/shared
\\\`\\\`\\\`

**Should the create schema include the parent ID?** Yes. The alternative is passing the parent ID as a URL/path parameter and omitting it from the body schema, but tRPC doesn't have path parameters — everything goes through input. Including it in the schema also means the client gets type-checked at compile time.

---

## Step 2: Define the Database Table with a Foreign Key

\\\`\\\`\\\`typescript
// packages/api/src/db/schema.ts — add below the users table
export const notes = pgTable("notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: varchar("content", { length: 5000 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
\\\`\\\`\\\`

Generate and apply the migration:

\\\`\\\`\\\`bash
pnpm db:generate
pnpm db:migrate
\\\`\\\`\\\`

### Choosing \\\`onDelete\\\` behavior

This is the most important decision for a sub-entity. It determines what happens to children when the parent is deleted.

| Behavior | SQL | When to use |
|---|---|---|
| \\\`cascade\\\` | Children are deleted with the parent | Owned data that has no meaning without the parent (notes, line items, comments) |
| \\\`set null\\\` | Foreign key becomes \\\`NULL\\\` | Data that should survive (e.g., posts by a deleted user — keep the post, clear the author) |
| \\\`restrict\\\` | Parent delete is blocked if children exist | The parent shouldn't be deletable while children are active (e.g., can't delete a project with open tasks) |

Most sub-entities use \\\`cascade\\\`. If you're unsure, ask: "does this child make sense without its parent?" If no, cascade. If yes, set null or restrict.

For \\\`set null\\\`, the foreign key column must be nullable:

\\\`\\\`\\\`typescript
userId: uuid("user_id")
  .references(() => users.id, { onDelete: "set null" }),  // no .notNull()
\\\`\\\`\\\`

---

## Step 3: Create the tRPC Router (Scoped to Parent)

The key difference from a standalone entity: **reads and writes are scoped to a parent ID**. The \\\`list\\\` procedure takes a parent ID input and filters by it. The \\\`create\\\` mutation attaches the parent ID to the insert.

\\\`\\\`\\\`typescript
// packages/api/src/routers/note.ts
import { z } from "zod";
import { eq } from "drizzle-orm";
import { tracked } from "@trpc/server";
import {
  CreateNoteSchema,
  syncChannel,
  type SyncEvent,
  type Note,
} from "@myapp/shared";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import { notes } from "../db/schema.js";
import { iterateEvents } from "../lib/iterateEvents.js";

let eventId = 0;

export const noteRouter = router({
  // LIST — scoped to a parent
  list: publicProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(notes)
        .where(eq(notes.userId, input.userId))
        .orderBy(notes.createdAt);
    }),

  // REAL-TIME — subscribe to changes for a specific parent
  onSync: publicProcedure.subscription(async function* ({ ctx, signal }) {
    for await (const event of iterateEvents<SyncEvent<Note>>(
      ctx.pubsub,
      syncChannel("note"),
      signal!,
    )) {
      yield tracked(String(++eventId), event);
    }
  }),

  // CREATE — requires auth, attaches parent ID
  create: protectedProcedure
    .input(CreateNoteSchema)
    .mutation(async ({ ctx, input }) => {
      const [note] = await ctx.db
        .insert(notes)
        .values(input)
        .returning();

      await ctx.pubsub.publish(syncChannel("note"), {
        action: "created",
        data: note,
        timestamp: Date.now(),
      } satisfies SyncEvent<typeof note>);

      return note;
    }),

  // DELETE — requires auth
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await ctx.db
        .delete(notes)
        .where(eq(notes.id, input.id))
        .returning();

      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
      }

      await ctx.pubsub.publish(syncChannel("note"), {
        action: "deleted",
        data: deleted,
        timestamp: Date.now(),
      });

      return { success: true };
    }),
});
\\\`\\\`\\\`

Wire it into the app router:

\\\`\\\`\\\`typescript
// packages/api/src/routers/index.ts
import { noteRouter } from "./note.js";

export const appRouter = router({
  user: userRouter,
  admin: adminRouter,
  jobs: jobsRouter,
  note: noteRouter,  // add here
});
\\\`\\\`\\\`

### Should the router be nested under the parent?

You have two options:

**Flat (recommended for this template):** \\\`trpc.note.list({ userId })\\\` — a separate top-level router. Simpler routing, straightforward hook wiring.

**Nested:** \\\`trpc.user.notes.list({ userId })\\\` — a sub-router merged into the parent. Better conceptual grouping, but tRPC nested routers add complexity for marginal benefit.

This guide uses flat routing. If you prefer nested, create the note router the same way but merge it into the user router instead of the app router.

### What about ownership checks?

If only the parent's owner should manage children, add the same ownership check pattern from the Adding a New Entity guide (Step 3b):

\\\`\\\`\\\`typescript
create: protectedProcedure
  .input(CreateNoteSchema)
  .mutation(async ({ ctx, input }) => {
    // Verify the caller owns the parent
    const [parent] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);

    if (!parent) throw new TRPCError({ code: "NOT_FOUND" });

    const callerEmail = ctx.user.email as string;
    if (parent.email !== callerEmail) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Not your user profile" });
    }

    const [note] = await ctx.db.insert(notes).values(input).returning();
    // ... publish sync event, return
  }),
\\\`\\\`\\\`

---

## Step 4: Querying Parent + Children Together (Joins)

Sometimes you want to return children alongside their parent in a single query — e.g., listing users with their note count, or loading a user profile with their notes included.

### Count children per parent

\\\`\\\`\\\`typescript
import { count, eq } from "drizzle-orm";

const usersWithNoteCounts = await ctx.db
  .select({
    user: users,
    noteCount: count(notes.id),
  })
  .from(users)
  .leftJoin(notes, eq(notes.userId, users.id))
  .groupBy(users.id)
  .orderBy(users.createdAt);
\\\`\\\`\\\`

\\\`leftJoin\\\` ensures parents with zero children still appear. \\\`innerJoin\\\` would exclude them.

### Load a parent with all its children

\\\`\\\`\\\`typescript
// Option A: Two queries (simpler, often faster)
const [user] = await ctx.db.select().from(users).where(eq(users.id, userId)).limit(1);
const userNotes = await ctx.db.select().from(notes).where(eq(notes.userId, userId)).orderBy(notes.createdAt);
return { ...user, notes: userNotes };

// Option B: Join query (one round trip, more complex result shape)
const rows = await ctx.db
  .select({ user: users, note: notes })
  .from(users)
  .leftJoin(notes, eq(notes.userId, users.id))
  .where(eq(users.id, userId));

// Drizzle returns one row per join match, so you need to reshape:
const user = rows[0]?.user;
const userNotes = rows.filter((r) => r.note !== null).map((r) => r.note!);
return { ...user, notes: userNotes };
\\\`\\\`\\\`

**Which approach to use?** Two queries is clearer and works well for loading a single parent with its children. The join approach is better when loading many parents with children (avoids N+1). For most sub-entity cases in this template, two queries is fine.

### Zod schema for the joined response

If you're returning nested data, add a schema for it:

\\\`\\\`\\\`typescript
// packages/shared/src/schemas/note.ts — add at the bottom
export const UserWithNotesSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "Name is required"),
  email: z.string().email(),
  role: RoleSchema.default("user"),
  avatarUrl: z.string().url().nullable().default(null),
  lastLoginAt: z.date().nullable().default(null),
  createdAt: z.date(),
  notes: z.array(NoteSchema),
});

export type UserWithNotes = z.infer<typeof UserWithNotesSchema>;
\\\`\\\`\\\`

You don't always need this. If the joined response is only used by one procedure and never validated elsewhere, the TypeScript return type from the query is sufficient. Add the Zod schema when the nested shape is part of your public API contract or used in multiple places.

---

## Step 5: Real-Time Sync Decisions

When a child is created, updated, or deleted, you need to decide what to publish and who should care.

### Option A: Publish the child only (recommended for most cases)

\\\`\\\`\\\`typescript
await ctx.pubsub.publish(syncChannel("note"), {
  action: "created",
  data: note,
  timestamp: Date.now(),
});
\\\`\\\`\\\`

The child hook (\\\`useNotes\\\`) subscribes to \\\`sync:note\\\` and updates its own cache. The parent hook (\\\`useUsers\\\`) doesn't need to know.

**Use when:** The parent view doesn't show child data inline. Notes are viewed on a separate page or section.

### Option B: Publish the child AND invalidate the parent

\\\`\\\`\\\`typescript
// Publish the child event
await ctx.pubsub.publish(syncChannel("note"), {
  action: "created",
  data: note,
  timestamp: Date.now(),
});

// Also notify parent subscribers (e.g., if the parent view shows a note count)
await ctx.pubsub.publish(syncChannel("user"), {
  action: "updated",
  data: { id: input.userId },
  timestamp: Date.now(),
});
\\\`\\\`\\\`

**Use when:** The parent view shows aggregated child info (counts, latest child, status derived from children). The parent hook receives the "updated" event and refetches.

### Option C: Publish the parent with children embedded

\\\`\\\`\\\`typescript
const updatedUser = await ctx.db.select().from(users).where(eq(users.id, input.userId)).limit(1);
const userNotes = await ctx.db.select().from(notes).where(eq(notes.userId, input.userId));

await ctx.pubsub.publish(syncChannel("user"), {
  action: "updated",
  data: { ...updatedUser[0], notes: userNotes },
  timestamp: Date.now(),
});
\\\`\\\`\\\`

**Use when:** Rarely. This increases message size and couples the parent and child sync channels. Usually Option A or B is better.

---

## Step 6: Create the Client Hook (Scoped to Parent)

The hook takes a parent ID and passes it to the list query. The sync subscription filters events by parent ID on the client side.

\\\`\\\`\\\`typescript
// packages/hooks/src/hooks/useNotes.ts
import { trpc } from "../trpc.js";
import { useSyncSubscription } from "../lib/useSyncSubscription.js";

type SerializedNote = {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
};

export function useNotes(userId: string) {
  const utils = trpc.useUtils();
  const listQuery = trpc.note.list.useQuery({ userId });

  // Subscribe to real-time sync events using the shared helper.
  // The callbacks filter by parent ID so events for other parents are ignored.
  useSyncSubscription<SerializedNote>(trpc.note.onSync, {
    onCreated: (data) => {
      if (data.userId !== userId) return;
      utils.note.list.setData({ userId }, (old) =>
        old ? [...old, data] : [data],
      );
    },
    onUpdated: (data) => {
      if (data.userId !== userId) return;
      utils.note.list.setData({ userId }, (old) =>
        old ? old.map((n) => (n.id === data.id ? data : n)) : old,
      );
    },
    onDeleted: (data) => {
      if ("userId" in data && data.userId !== userId) return;
      utils.note.list.invalidate({ userId });
    },
  });

  const createMutation = trpc.note.create.useMutation({
    onSuccess: () => utils.note.list.invalidate({ userId }),
  });
  const deleteMutation = trpc.note.delete.useMutation({
    onSuccess: () => utils.note.list.invalidate({ userId }),
  });

  return {
    notes: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    createNote: (content: string) => createMutation.mutateAsync({ userId, content }),
    deleteNote: (id: string) => deleteMutation.mutateAsync({ id }),
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
\\\`\\\`\\\`

Re-export from the hooks barrel:

\\\`\\\`\\\`typescript
// packages/hooks/src/index.ts — add this line
export { useNotes } from "./hooks/useNotes.js";
\\\`\\\`\\\`

**Key differences from a top-level entity hook:**
- Uses \\\`useSyncSubscription\\\` (same as top-level hooks) but each callback filters by parent ID before updating the cache
- The hook takes \\\`userId\\\` as a parameter
- \\\`listQuery\\\` passes \\\`{ userId }\\\` to scope the query
- \\\`setData\\\` and \\\`invalidate\\\` pass \\\`{ userId }\\\` so React Query updates the right cache entry
- \\\`createNote\\\` wraps the mutation to auto-attach the \\\`userId\\\` so the caller only passes \\\`content\\\`

---

## Step 7: Build the Frontend

Sub-entity views can be standalone pages (e.g., \\\`/users/:userId/notes\\\`) or inline sections within the parent view.

### As an inline section on the parent

\\\`\\\`\\\`tsx
// Inside an existing view — e.g., a user detail page
import { useNotes } from "@myapp/hooks";

function UserNotes({ userId }: { userId: string }) {
  const { notes, isLoading, createNote, isCreating } = useNotes(userId);
  const [content, setContent] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content) return;
    await createNote(content);
    setContent("");
  };

  return (
    <div>
      <h3 className="text-lg font-semibold mb-3">Notes</h3>

      <form onSubmit={handleSubmit} className="flex gap-2 mb-4">
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Add a note..."
          required
          className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
        />
        <button
          type="submit"
          disabled={isCreating}
          className="px-4 py-2 bg-indigo-600 text-white rounded text-sm cursor-pointer disabled:opacity-60"
        >
          {isCreating ? "Adding..." : "Add"}
        </button>
      </form>

      {isLoading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : notes.length ? (
        <div className="space-y-2">
          {notes.map((note) => (
            <div key={note.id} className="bg-gray-50 p-3 rounded text-sm">
              <p>{note.content}</p>
              <p className="text-gray-400 text-xs mt-1">
                {new Date(note.createdAt).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-gray-400 text-sm">No notes yet.</p>
      )}
    </div>
  );
}
\\\`\\\`\\\`

### As a standalone page with a route parameter

\\\`\\\`\\\`tsx
// packages/web/src/views/UserNotes.tsx
import { useParams } from "react-router-dom";
import { useNotes } from "@myapp/hooks";

export function UserNotes() {
  const { userId } = useParams<{ userId: string }>();
  if (!userId) return <p>Missing user ID</p>;

  const { notes, isLoading, createNote, isCreating } = useNotes(userId);
  // ... same UI as above
}
\\\`\\\`\\\`

\\\`\\\`\\\`typescript
// packages/web/src/App.tsx — add route
<Route path="/users/:userId/notes" element={<UserNotes />} />
\\\`\\\`\\\`

---

## Step 8: Cascading Deletes and Sync

If you used \\\`onDelete: "cascade"\\\` on the foreign key, Postgres automatically deletes children when the parent is deleted. But the client doesn't know about those cascaded deletes unless you handle it.

### Option A: Invalidate the child cache when the parent is deleted

In the parent's delete mutation, publish a sync event on the child's channel too:

\\\`\\\`\\\`typescript
// In the user router's delete mutation
delete: protectedProcedure
  .input(CreateUserSchema.pick({ email: true }))
  .mutation(async ({ ctx, input }) => {
    // Look up the user ID before deleting (we need it for the child sync)
    const [user] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    await ctx.db.delete(users).where(eq(users.email, input.email));

    // Notify user subscribers
    await ctx.pubsub.publish(syncChannel("user"), {
      action: "deleted",
      data: input,
      timestamp: Date.now(),
    });

    // Notify note subscribers — their cache for this user is now stale
    if (user) {
      await ctx.pubsub.publish(syncChannel("note"), {
        action: "deleted",
        data: { userId: user.id },
        timestamp: Date.now(),
      });
    }

    return { success: true };
  }),
\\\`\\\`\\\`

### Option B: Let the client handle it naturally

If the child view is only visible when the parent exists (e.g., it's a section on the parent's detail page), navigating away from the deleted parent unmounts the child hook. The stale cache entry is harmless and gets garbage-collected by React Query.

Option B is usually fine. Only use Option A if children are visible independently of the parent (e.g., a "recent notes" feed that includes notes from all users).

---

## Step 9: Write Tests

### Schema tests

\\\`\\\`\\\`typescript
// packages/shared/src/schemas/note.test.ts
import { describe, it, expect } from "vitest";
import { CreateNoteSchema, NoteSchema } from "./note.js";

describe("CreateNoteSchema", () => {
  it("accepts valid input", () => {
    const result = CreateNoteSchema.safeParse({
      userId: "550e8400-e29b-41d4-a716-446655440000",
      content: "A note",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing userId", () => {
    const result = CreateNoteSchema.safeParse({ content: "A note" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid userId format", () => {
    const result = CreateNoteSchema.safeParse({ userId: "not-a-uuid", content: "A note" });
    expect(result.success).toBe(false);
  });

  it("rejects empty content", () => {
    const result = CreateNoteSchema.safeParse({
      userId: "550e8400-e29b-41d4-a716-446655440000",
      content: "",
    });
    expect(result.success).toBe(false);
  });
});
\\\`\\\`\\\`

### Router tests

\\\`\\\`\\\`typescript
// packages/api/src/routers/note.test.ts
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

const mockNote = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  userId: "660e8400-e29b-41d4-a716-446655440000",
  content: "Test note",
  createdAt: new Date(),
};

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockResolvedValue([mockNote]),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([mockNote]),
  delete: vi.fn().mockReturnThis(),
};

const mockPubsub = { publish: vi.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.select.mockReturnThis();
  mockDb.from.mockReturnThis();
  mockDb.where.mockReturnThis();
  mockDb.orderBy.mockResolvedValue([mockNote]);
  mockDb.insert.mockReturnThis();
  mockDb.values.mockReturnThis();
  mockDb.returning.mockResolvedValue([mockNote]);
  mockDb.delete.mockReturnThis();
});

describe("noteRouter", () => {
  it("list returns notes for a user", async () => {
    const caller = appRouter.createCaller({ user: null, db: mockDb as any, pubsub: mockPubsub as any });
    const result = await caller.note.list({ userId: mockNote.userId });
    expect(result).toEqual([mockNote]);
  });

  it("create requires auth", async () => {
    const caller = appRouter.createCaller({ user: null, db: mockDb as any, pubsub: mockPubsub as any });
    await expect(
      caller.note.create({ userId: mockNote.userId, content: "Hello" }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("create inserts and publishes sync event", async () => {
    const caller = appRouter.createCaller({
      user: { sub: "u1", email: "test@test.com" },
      db: mockDb as any,
      pubsub: mockPubsub as any,
    });
    const result = await caller.note.create({ userId: mockNote.userId, content: "Hello" });
    expect(result).toEqual(mockNote);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:note",
      expect.objectContaining({ action: "created" }),
    );
  });

  it("delete removes note and publishes sync event", async () => {
    const caller = appRouter.createCaller({
      user: { sub: "u1", email: "test@test.com" },
      db: mockDb as any,
      pubsub: mockPubsub as any,
    });
    const result = await caller.note.delete({ id: mockNote.id });
    expect(result).toEqual({ success: true });
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:note",
      expect.objectContaining({ action: "deleted" }),
    );
  });
});
\\\`\\\`\\\`

Run all tests:

\\\`\\\`\\\`bash
pnpm test
\\\`\\\`\\\`

---

## Checklist

Everything from the Adding a New Entity checklist, plus:

**Relationship**
- [ ] Foreign key in Drizzle schema with appropriate \\\`onDelete\\\` behavior (\\\`cascade\\\`, \\\`set null\\\`, or \\\`restrict\\\`)
- [ ] Migration generated and applied
- [ ] Create schema includes the parent ID field (\\\`userId\\\`, \\\`projectId\\\`, etc.)

**API**
- [ ] \\\`list\\\` procedure takes parent ID as input and filters by it
- [ ] \\\`create\\\` mutation includes the parent ID in the insert
- [ ] Ownership check on mutations if only the parent's owner should manage children
- [ ] Cascading delete handling — either notify child channel or rely on view unmounting

**Client**
- [ ] Hook takes parent ID as parameter
- [ ] \\\`listQuery\\\`, \\\`setData\\\`, and \\\`invalidate\\\` all pass the parent ID to scope to the right cache entry
- [ ] Sync subscription filters events by parent ID (ignores events for other parents)
- [ ] \\\`createNote\\\` wrapper auto-attaches parent ID so callers only pass child fields

**Joins (if needed)**
- [ ] \\\`leftJoin\\\` for counts or optional children, \\\`innerJoin\\\` when children are required
- [ ] Joined response reshaped from flat rows into nested structure
- [ ] Zod schema for nested response if it's part of the public API contract

---

## Common Patterns

### Multiple children on the same parent

A user can have notes, tasks, and bookmarks. Each gets its own table, router, and hook — they all follow this same guide independently. They all reference \\\`users.id\\\` with their own foreign key.

### Grandchildren (nested sub-entities)

A project has tasks, a task has comments. Same pattern, one level deeper. The comment table references \\\`tasks.id\\\`, the comment router scopes by \\\`taskId\\\`, and the hook takes \\\`taskId\\\`. The cascading delete chain is: project deleted -> tasks cascade-deleted -> comments cascade-deleted.

### Many-to-many relationships

Users belong to multiple teams, teams have multiple users. This requires a join table:

\\\`\\\`\\\`typescript
export const teamMembers = pgTable("team_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 50 }).notNull().default("member"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
});
\\\`\\\`\\\`

The router needs \\\`addMember\\\` and \\\`removeMember\\\` mutations instead of \\\`create\\\` and \\\`delete\\\`. The hook queries through the join table. Everything else follows the same principles.`,
  },
  {
    name: 'Adding a Monorepo Package',
    description:
      'How to add a new package to the monorepo: pnpm workspace setup, TypeScript project references, turbo pipeline, barrel exports, and cross-package imports.',
    content: `# Adding a Monorepo Package

How to add a new package to the monorepo — a shared library, a background worker, an email service, a CLI tool. This covers the pnpm workspace, TypeScript project references, turbo pipeline, and cross-package imports that make it all work.

## How the Monorepo Is Wired

\\\`\\\`\\\`
pnpm-workspace.yaml     <- declares packages/* as workspaces
tsconfig.base.json      <- shared compiler options (all packages extend this)
turbo.json              <- build pipeline ordering
packages/
  shared/               <- Zod schemas, types, utilities (no runtime deps)
  api/                  <- Express + tRPC server (depends on shared)
  hooks/                <- React Query hooks + tRPC client (depends on shared, api types)
  web/                  <- React SPA (depends on hooks)
  mobile/               <- Expo app (depends on hooks)
\\\`\\\`\\\`

### How dependencies flow

\\\`\\\`\\\`
shared  -->  api
shared  -.>  hooks  -->  web
api     -.>  hooks  -->  mobile
shared  -->  mobile

-->  = runtime dependency (dependencies)
-.>  = type-only devDependency (devDependencies)
\\\`\\\`\\\`

\\\`shared\\\` has no internal dependencies — it's the leaf. Everything else depends on it. \\\`hooks\\\` lists both \\\`shared\\\` and \\\`api\\\` as **devDependencies** — it only uses them for types at build time, not at runtime. \\\`web\\\` and \\\`mobile\\\` depend on \\\`hooks\\\` as a runtime dependency.

> **Client type export.** \\\`api\\\` exposes a \\\`./client\\\` subpath export (\\\`@myapp/api/client\\\`) that re-exports \\\`AppRouter\\\` without pulling in the server startup code from \\\`src/index.ts\\\`. \\\`hooks/src/trpc.ts\\\` imports from this subpath instead of reaching into \\\`api\\\` internals. The \\\`./client\\\` entry is defined in \\\`api/package.json\\\` under \\\`exports\\\` and backed by \\\`src/client.ts\\\`, which is a types-only barrel.

### How turbo knows what to build first

\\\`\\\`\\\`json
// turbo.json
"build": {
  "dependsOn": ["^build"],  // build my dependencies first
  "outputs": ["dist/**"]
}
\\\`\\\`\\\`

The \\\`^build\\\` means "build all packages I depend on before building me." So \\\`pnpm build\\\` automatically builds \\\`shared\\\` -> \\\`hooks\\\` -> \\\`web\\\` (and \\\`shared\\\` -> \\\`api\\\`). You never need to specify the order manually.

### How TypeScript resolves cross-package imports

Two mechanisms work together:

1. **\\\`workspace:*\\\` in package.json** — pnpm symlinks the package into \\\`node_modules\\\`, so \\\`import { UserSchema } from "@myapp/shared"\\\` resolves at runtime.

2. **\\\`references\\\` in tsconfig.json** — TypeScript follows project references for type checking, so you get autocomplete and compile errors across packages.

\\\`\\\`\\\`json
// packages/api/tsconfig.json
{
  "references": [
    { "path": "../shared" }   // TypeScript knows about shared's types
  ]
}
\\\`\\\`\\\`

### How barrel exports work

Each package has an \\\`src/index.ts\\\` that re-exports its public API. Consumers import from the package name, never from internal paths:

\\\`\\\`\\\`typescript
// YES — import from the package
import { UserSchema, type User } from "@myapp/shared";

// NO — reaching into internal files
import { UserSchema } from "@myapp/shared/src/schemas/user.js";
\\\`\\\`\\\`

The \\\`exports\\\` field in package.json maps the package name to the built output:

\\\`\\\`\\\`json
// packages/shared/package.json
"exports": {
  ".": {
    "import": "./dist/index.js",
    "types": "./dist/index.d.ts"
  }
}
\\\`\\\`\\\`

---

## Adding a New Package

### 1. Create the directory and package.json

\\\`\\\`\\\`bash
mkdir -p packages/worker/src
\\\`\\\`\\\`

\\\`\\\`\\\`json
// packages/worker/package.json
{
  "name": "@myapp/worker",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@myapp/shared": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
\\\`\\\`\\\`

Key details:
- **\\\`"type": "module"\\\`** — all packages use ESM
- **\\\`"private": true\\\`** — monorepo packages aren't published to npm
- **\\\`workspace:*\\\`** — tells pnpm to use the local version of \\\`@myapp/shared\\\`
- **\\\`exports\\\`** — required for other packages to import from \\\`@myapp/worker\\\`

> **Exception: Expo apps** — The \\\`mobile\\\` package does not follow the standard ESM setup. Expo apps use their own conventions: no \\\`"type": "module"\\\`, no \\\`"exports"\\\` field, no \\\`"build"\\\` script, and \\\`tsconfig.json\\\` extends \\\`expo/tsconfig.base\\\` instead of the monorepo base. This is expected — Expo's toolchain handles bundling and TypeScript differently from Node.js library packages.

### 2. Create tsconfig.json

\\\`\\\`\\\`json
// packages/worker/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  },
  "include": ["src"],
  "references": [
    { "path": "../shared" }
  ]
}
\\\`\\\`\\\`

Key details:
- **\\\`extends\\\`** — inherits strict mode, ESM, source maps from \\\`tsconfig.base.json\\\`
- **\\\`composite: true\\\`** — only required for library packages that other packages import from (e.g., \\\`shared\\\`, or a \\\`worker\\\` that \\\`api\\\` imports from). Frontend apps like \\\`web\\\` and \\\`mobile\\\` don't need it since nothing imports from them — \\\`web\\\` correctly omits it.
- **\\\`references\\\`** — list every internal package this one imports from. If you use \\\`@myapp/shared\\\`, add \\\`{ "path": "../shared" }\\\`.

### 3. Create the barrel export

\\\`\\\`\\\`typescript
// packages/worker/src/index.ts
export { processQueue } from "./queue.js";
export type { QueueJob } from "./types.js";
\\\`\\\`\\\`

Only export what other packages need. Internal implementation stays unexported.

### 4. Add tests (if applicable)

\\\`\\\`\\\`typescript
// packages/worker/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
\\\`\\\`\\\`

### 5. Install dependencies

\\\`\\\`\\\`bash
pnpm install
\\\`\\\`\\\`

pnpm automatically picks up the new workspace package. No changes to \\\`pnpm-workspace.yaml\\\` needed — the glob \\\`packages/*\\\` already covers it.

### 6. Verify the build chain

\\\`\\\`\\\`bash
pnpm build
\\\`\\\`\\\`

Turbo should build \\\`shared\\\` first (because \\\`worker\\\` depends on it), then \\\`worker\\\`. Check the turbo output to confirm the order is correct.

---

## Package Types and What They Need

Not every package needs the same setup. Here's what differs:

### Library package (shared code, imported by others)

Examples: \\\`shared\\\`, a \\\`utils\\\` package, a \\\`validation\\\` package.

\\\`\\\`\\\`json
// tsconfig.json — needs composite for project references
"compilerOptions": {
  "composite": true,
  "declaration": true,   // inherited from base, but worth noting
}
\\\`\\\`\\\`

- **\\\`composite: true\\\`** — required so other packages can reference it
- **\\\`exports\\\` in package.json** — required so imports resolve
- **No \\\`dev\\\` script** — libraries don't run, they're built and imported. Use \\\`"dev": "tsc --watch"\\\` to rebuild on changes.

### Server package (runs as a process)

Examples: \\\`api\\\`, a background \\\`worker\\\`, a \\\`cron\\\` service.

\\\`\\\`\\\`json
// tsconfig.json — doesn't need composite (nothing imports from it)
"compilerOptions": {
  "outDir": "./dist",
  "rootDir": "./src"
  // no composite, no declaration needed
}
\\\`\\\`\\\`

> **Exception:** \\\`api\\\` has \\\`composite: true\\\` because it exports types via its \\\`./client\\\` subpath (\\\`@myapp/api/client\\\`). If your server package similarly exposes types consumed by other packages, it needs \\\`composite: true\\\` too.

- **\\\`dev\\\` script uses \\\`tsx watch\\\`** — hot-reloads on file changes
- **\\\`start\\\` script uses \\\`node dist/index.js\\\`** — for production
- **Needs its own Dockerfile** if it deploys separately
- **Needs its own deploy workflow** if it deploys separately

### Frontend package (React app)

Examples: \\\`web\\\`, another SPA for a different audience.

\\\`\\\`\\\`json
// tsconfig.json — needs DOM libs and JSX
"compilerOptions": {
  "jsx": "react-jsx",
  "lib": ["ES2022", "DOM", "DOM.Iterable"]
}
\\\`\\\`\\\`

- **Built by Vite**, not \\\`tsc\\\` alone — \\\`"build": "tsc --noEmit && vite build"\\\`
- **References hooks and shared directly** (both listed in tsconfig \\\`references\\\`)
- **No \\\`composite: true\\\`** — nothing imports from a frontend app, so it doesn't need to be a project reference target. \\\`web\\\` correctly omits it.
- **Expo is different** — \\\`mobile\\\` does not use Vite, does not extend \\\`tsconfig.base.json\\\`, and does not use \\\`"type": "module"\\\`. Expo's own toolchain handles everything. See the exception note in step 1 above.

---

## Connecting to Other Packages

### Your new package imports from an existing one

1. Add the dependency to package.json:

\\\`\\\`\\\`json
"dependencies": {
  "@myapp/shared": "workspace:*"
}
\\\`\\\`\\\`

2. Add the reference to tsconfig.json:

\\\`\\\`\\\`json
"references": [
  { "path": "../shared" }
]
\\\`\\\`\\\`

3. Run \\\`pnpm install\\\` to wire it up.

### An existing package imports from your new one

1. Add your package as a dependency in the consumer's package.json:

\\\`\\\`\\\`json
// packages/api/package.json
"dependencies": {
  "@myapp/worker": "workspace:*"
}
\\\`\\\`\\\`

2. Add a reference in the consumer's tsconfig.json:

\\\`\\\`\\\`json
// packages/api/tsconfig.json
"references": [
  { "path": "../shared" },
  { "path": "../worker" }
]
\\\`\\\`\\\`

3. Make sure your package has \\\`"composite": true\\\` in tsconfig.json and \\\`"exports"\\\` in package.json.

4. Run \\\`pnpm install\\\`.

---

## Adding a Deploy Workflow

If the package runs as a separate service (not imported by an existing deployed package), it needs its own deploy workflow.

### Path filters

The deploy workflow should trigger when its own files or its dependencies change:

\\\`\\\`\\\`yaml
on:
  push:
    branches: [main]
    paths:
      - "packages/worker/**"
      - "packages/shared/**"    # if worker depends on shared
\\\`\\\`\\\`

The existing \\\`deploy-api.yml\\\` triggers on \\\`packages/api/**\\\` and \\\`packages/shared/**\\\`. The existing \\\`deploy-web.yml\\\` triggers on \\\`packages/web/**\\\`, \\\`packages/hooks/**\\\`, and \\\`packages/shared/**\\\`. Follow the same pattern — list your package and everything it imports from.

### CI workflow

The CI workflow (\\\`ci.yml\\\`) runs \\\`pnpm build\\\`, \\\`pnpm typecheck\\\`, and \\\`pnpm test\\\` across the entire monorepo. New packages are automatically included — turbo discovers all workspace packages. No CI changes needed unless you need a custom step.

---

## Turbo Pipeline

The existing \\\`turbo.json\\\` tasks (\\\`build\\\`, \\\`dev\\\`, \\\`test\\\`, \\\`typecheck\\\`) work for any new package automatically, as long as the package.json scripts use the same names.

If your package has a custom script (e.g., \\\`db:generate\\\` for a package with its own database), add it to turbo.json:

\\\`\\\`\\\`json
// turbo.json
"tasks": {
  "worker:process": {
    "dependsOn": ["^build"],
    "cache": false
  }
}
\\\`\\\`\\\`

Then run it from the root: \\\`turbo worker:process --filter=@myapp/worker\\\`.

---

## Checklist

- [ ] \\\`packages/<name>/package.json\\\` with \\\`name\\\`, \\\`type: module\\\`, \\\`exports\\\`, scripts
- [ ] \\\`packages/<name>/tsconfig.json\\\` extending \\\`../../tsconfig.base.json\\\`
- [ ] \\\`packages/<name>/src/index.ts\\\` barrel export
- [ ] \\\`composite: true\\\` in tsconfig if other packages will import from this one
- [ ] \\\`workspace:*\\\` dependency and tsconfig \\\`references\\\` for each internal package used
- [ ] \\\`pnpm install\\\` run to wire up the workspace
- [ ] \\\`pnpm build\\\` succeeds with correct ordering
- [ ] \\\`pnpm typecheck\\\` passes
- [ ] Tests added with \\\`vitest.config.ts\\\` if applicable
- [ ] Deploy workflow with correct path filters if the package deploys independently
- [ ] \\\`init.sh\\\` updated if the package needs env vars or deployment configuration`,
  },
  {
    name: 'Adding Middleware',
    description:
      'How to add cross-cutting behavior with Express HTTP middleware and tRPC procedure-level middleware: when to use each, composition patterns, procedure types, and testing.',
    content: `# Adding Middleware

How to add cross-cutting behavior — logic that runs across many requests or procedures without duplicating it in each handler. This project has two middleware systems that serve different purposes, and picking the wrong one means either missing the data you need or fighting the framework.

> **Note:** This is a step-by-step guide for future implementation. The example code shown below (such as \\\`requestId\\\` and \\\`strictLimiter\\\` for specific paths) does not exist in the codebase yet -- it is a worked example. To add middleware, follow the steps below and create each file as described.

## The Two Middleware Systems

### Express middleware

Runs on every HTTP request before tRPC sees it. Has access to the raw HTTP request and response — headers, IP address, method, path, status code. Knows nothing about tRPC procedures, user identity, or typed inputs.

\\\`\\\`\\\`
HTTP request -> Express middleware -> tRPC adapter -> procedure
\\\`\\\`\\\`

Already in the project:

| Middleware | File | What it does |
|---|---|---|
| \\\`cors()\\\` | \\\`src/index.ts\\\` | Sets CORS headers |
| \\\`getGlobalLimiter()\\\` | \\\`src/middleware/rateLimit.ts\\\` | 100 req/15min per IP |
| \\\`getRequestLogger()\\\` | \\\`src/middleware/requestLogger.ts\\\` | Logs every request with pino-http |

### tRPC middleware

Runs inside the tRPC procedure chain. Has access to the typed context — the authenticated user (\\\`ctx.user\\\`), the database (\\\`ctx.db\\\`), the pubsub instance, and the validated input. Knows nothing about HTTP headers or IP addresses.

\\\`\\\`\\\`
tRPC adapter -> context creation -> tRPC middleware -> procedure handler
\\\`\\\`\\\`

Already in the project:

| Middleware | File | What it does |
|---|---|---|
| \\\`protectedProcedure\\\` | \\\`src/trpc.ts\\\` | Rejects if no \\\`ctx.user\\\` (JWT required), resolves \\\`ctx.dbUser\\\` from \\\`sub\\\` |
| \\\`adminProcedure\\\` | \\\`src/middleware/requireRole.ts\\\` | Checks \\\`ctx.dbUser.role\\\`, rejects non-admins |

### How to decide which to use

| You need to... | Use | Why |
|---|---|---|
| Read or set HTTP headers | Express | tRPC middleware doesn't have access to the raw response |
| Rate-limit by IP address | Express | tRPC doesn't expose the client IP |
| Log raw request method/path/status | Express | These are HTTP-level concerns |
| Parse or transform the request body | Express | Before tRPC sees the request |
| Check if the user is authenticated | tRPC | \\\`ctx.user\\\` comes from context creation |
| Check the user's role or permissions | tRPC | Requires a DB lookup with \\\`ctx.db\\\` |
| Validate or transform procedure input | tRPC | Input is typed and available after Zod parsing |
| Log which procedure was called, by whom | tRPC | Express only sees \\\`/api/trpc\\\` — it doesn't know which procedure |
| Add data to the context for downstream procedures | tRPC | Express can't modify tRPC context |
| Apply logic to specific procedures or groups | tRPC | Express applies to all routes or a path prefix |

**Rule of thumb:** If it's about HTTP, use Express. If it's about the caller or the data, use tRPC.

---

## Adding Express Middleware

Express middleware is a function that takes \\\`(req, res, next)\\\`. Call \\\`next()\\\` to continue to the next middleware, or send a response to short-circuit.

### Example: Adding request ID tracking

Every request gets a unique ID in a header, available to all downstream code for log correlation.

\\\`\\\`\\\`typescript
// packages/api/src/middleware/requestId.ts
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = req.headers["x-request-id"] as string ?? crypto.randomUUID();
  req.headers["x-request-id"] = id;
  res.setHeader("x-request-id", id);
  next();
}
\\\`\\\`\\\`

Wire it in \\\`src/index.ts\\\`, before other middleware so the ID is available everywhere:

\\\`\\\`\\\`typescript
// packages/api/src/index.ts
import { requestId } from "./middleware/requestId.js";

app.use(requestId);              // <- add first
app.use(getGlobalLimiter());
app.use(getRequestLogger());
\\\`\\\`\\\`

### Example: Adding a stricter rate limit to a specific path

The template already has a \\\`strictLimiter\\\` (20 req/15min). Apply it to a specific route:

\\\`\\\`\\\`typescript
// packages/api/src/index.ts
import { strictLimiter } from "./middleware/rateLimit.js";

// Apply strict limiting to a specific path only
app.use("/api/trpc/auth", strictLimiter);
\\\`\\\`\\\`

Note: tRPC batches all procedure calls to \\\`/api/trpc\\\`, so path-based Express middleware has limited usefulness for targeting individual procedures. If you need per-procedure throttling, use tRPC middleware instead.

### Where Express middleware goes

\\\`\\\`\\\`typescript
// packages/api/src/index.ts — the order matters

app.use(cors({ ... }));          // 1. CORS (must be first for preflight)
app.use(requestId);              // 2. Request ID (before logging)
app.use(getGlobalLimiter());     // 3. Rate limiting (before any processing)
app.use(getRequestLogger());     // 4. Logging (after ID is set, so logs include it)

app.get("/api/health", ...);  // 5. Health check (before tRPC, so it's fast)

app.use("/api/trpc", ...);    // 6. tRPC adapter
\\\`\\\`\\\`

Order matters. Middleware runs top to bottom. Put cheap rejections (rate limiting) before expensive work (tRPC procedure routing).

### How to test Express middleware

Test it in isolation — call the function with mock req/res/next:

\\\`\\\`\\\`typescript
import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { requestId } from "./requestId.js";

describe("requestId", () => {
  it("adds a request ID when none exists", () => {
    const req = { headers: {} } as Request;
    const res = { setHeader: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    requestId(req, res, next);

    expect(req.headers["x-request-id"]).toBeDefined();
    expect(res.setHeader).toHaveBeenCalledWith("x-request-id", expect.any(String));
    expect(next).toHaveBeenCalled();
  });

  it("preserves existing request ID", () => {
    const req = { headers: { "x-request-id": "existing-id" } } as unknown as Request;
    const res = { setHeader: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    requestId(req, res, next);

    expect(req.headers["x-request-id"]).toBe("existing-id");
    expect(next).toHaveBeenCalled();
  });
});
\\\`\\\`\\\`

---

## Adding tRPC Middleware

tRPC middleware is a function passed to \\\`.use()\\\` on a procedure. It receives the context and input, and calls \\\`next()\\\` to continue (optionally extending the context with new data).

### How the existing chain works

\\\`\\\`\\\`typescript
// packages/api/src/trpc.ts
const t = initTRPC.context<Context>().create();

export const publicProcedure = t.procedure;
// Anyone can call this. Context has: { user: JWTPayload | null, db, pubsub }

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});
// Logged-in users only. Context now guarantees: { user: JWTPayload (non-null), db, pubsub }
\\\`\\\`\\\`

\\\`\\\`\\\`typescript
// packages/api/src/middleware/requireRole.ts
export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  // ... looks up user in DB, checks role ...
  return next({ ctx: { ...ctx, dbUser } });
});
// Admins only. Context now adds: { dbUser: the full user row from the database }
\\\`\\\`\\\`

Middleware chains. \\\`adminProcedure\\\` builds on \\\`protectedProcedure\\\`, which builds on \\\`publicProcedure\\\`. Each layer can reject the request or add data to the context.

### Example: Audit logging middleware

Log every mutation — who called it, what procedure, when. This is the kind of thing that feels like it should be Express middleware but can't be, because Express only sees \\\`POST /api/trpc\\\` — it doesn't know which procedure was called.

\\\`\\\`\\\`typescript
// packages/api/src/middleware/auditLog.ts
import { getLogger } from "../lib/logger.js";
import { protectedProcedure } from "../trpc.js";

export const auditedProcedure = protectedProcedure.use(async ({ ctx, path, type, next }) => {
  const start = Date.now();
  const result = await next();
  const durationMs = Date.now() - start;

  if (type === "mutation") {
    getLogger().info(
      {
        procedure: path,
        userEmail: ctx.user?.email,
        durationMs,
      },
      "Audit: mutation executed",
    );
  }

  return result;
});
\\\`\\\`\\\`

Use it in a router:

\\\`\\\`\\\`typescript
// packages/api/src/routers/post.ts
import { auditedProcedure } from "../middleware/auditLog.js";

export const postRouter = router({
  list: publicProcedure.query(/* ... */),
  create: auditedProcedure           // <- replaces protectedProcedure
    .input(CreatePostSchema)
    .mutation(/* ... */),
});
\\\`\\\`\\\`

The \\\`path\\\` parameter gives you the procedure name (e.g., \\\`post.create\\\`). The \\\`type\\\` is \\\`"query"\\\`, \\\`"mutation"\\\`, or \\\`"subscription"\\\`.

### Example: Owner-only middleware

Reusable middleware that checks if the caller owns a resource. Instead of duplicating the ownership check in every mutation, extract it:

\\\`\\\`\\\`typescript
// packages/api/src/middleware/requireOwner.ts
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure } from "../trpc.js";
import { users } from "../db/schema.js";

export const ownerProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const email = ctx.user?.email as string;

  const [dbUser] = await ctx.db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!dbUser) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  }

  return next({ ctx: { ...ctx, dbUser } });
});
\\\`\\\`\\\`

Now procedures can use \\\`ctx.dbUser\\\` without repeating the lookup:

\\\`\\\`\\\`typescript
update: ownerProcedure
  .input(UpdatePostSchema)
  .mutation(async ({ ctx, input }) => {
    const [post] = await ctx.db
      .select()
      .from(posts)
      .where(eq(posts.id, input.id))
      .limit(1);

    if (!post) throw new TRPCError({ code: "NOT_FOUND" });
    if (post.authorId !== ctx.user.sub && ctx.dbUser.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    // ... do the update
  }),
\\\`\\\`\\\`

### Example: Input transform middleware

Middleware that runs after Zod validation and normalizes the input — trimming strings, lowercasing emails, etc. This uses the \\\`rawInput\\\` option:

\\\`\\\`\\\`typescript
// packages/api/src/middleware/normalizeInput.ts
import { publicProcedure } from "../trpc.js";

export const normalizedProcedure = publicProcedure.use(async ({ rawInput, next }) => {
  // Trim all string values in the input
  if (rawInput && typeof rawInput === "object") {
    for (const [key, value] of Object.entries(rawInput)) {
      if (typeof value === "string") {
        (rawInput as Record<string, unknown>)[key] = value.trim();
      }
    }
  }
  return next();
});
\\\`\\\`\\\`

Note: In practice, do string normalization in the Zod schema with \\\`.transform()\\\` instead — it's more explicit and type-safe. Use middleware transforms for cross-cutting concerns that don't belong in individual schemas.

### Extending the context type

When middleware adds data to the context (like \\\`adminProcedure\\\` adds \\\`dbUser\\\`), downstream procedures see it as typed. This happens automatically because \\\`next({ ctx: { ...ctx, dbUser } })\\\` extends the context type.

If your middleware always adds a value, TypeScript infers it as present in downstream procedures. If it conditionally adds a value, use a type assertion or a branded type.

### How to test tRPC middleware

Test it through the procedure chain using \\\`createCaller\\\`, the same way you test routers:

\\\`\\\`\\\`typescript
import { describe, it, expect, vi } from "vitest";

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

import { appRouter } from "../routers/index.js";

describe("auditedProcedure", () => {
  it("allows authenticated users", async () => {
    const caller = appRouter.createCaller({
      user: { sub: "u1", email: "test@test.com" },
      db: mockDb as any,
      pubsub: mockPubsub as any,
    });
    // Should not throw
    await caller.post.create({ title: "Hi", body: "World" });
  });

  it("rejects unauthenticated users", async () => {
    const caller = appRouter.createCaller({
      user: null,
      db: mockDb as any,
      pubsub: mockPubsub as any,
    });
    await expect(
      caller.post.create({ title: "Hi", body: "World" }),
    ).rejects.toThrow("UNAUTHORIZED");
  });
});
\\\`\\\`\\\`

---

## Creating a New Procedure Type

When you find yourself applying the same tRPC middleware to many procedures, create a named procedure type. The template already does this with \\\`protectedProcedure\\\` and \\\`adminProcedure\\\`.

### The procedure hierarchy

\\\`\\\`\\\`
publicProcedure                    <- no auth, anyone can call
  +-- protectedProcedure           <- JWT required, ctx.user guaranteed
        |-- adminProcedure         <- role === "admin", ctx.dbUser added
        |-- ownerProcedure         <- ctx.dbUser added (for ownership checks)
        +-- auditedProcedure       <- logs mutations with caller identity
\\\`\\\`\\\`

Each level builds on the previous one. You never need to re-check auth in \\\`adminProcedure\\\` because \\\`protectedProcedure\\\` already did it.

### Where to define new procedure types

- Simple middleware (one check, no DB): add to \\\`src/trpc.ts\\\` alongside \\\`protectedProcedure\\\`
- Middleware that queries the DB or has complex logic: create a file in \\\`src/middleware/\\\`
- Middleware used by a single router: define it in that router file (no need to export it)

### Naming convention

Name the procedure type after what it requires, not what it does:

| Name | Meaning |
|---|---|
| \\\`protectedProcedure\\\` | Requires authentication |
| \\\`adminProcedure\\\` | Requires admin role |
| \\\`ownerProcedure\\\` | Requires the caller's DB user (for ownership checks) |
| \\\`auditedProcedure\\\` | Requires auth + logs the call (side effect) |

---

## Common Patterns

### Composing multiple middlewares

Chain \\\`.use()\\\` calls to compose multiple concerns:

\\\`\\\`\\\`typescript
export const auditedAdminProcedure = adminProcedure.use(async ({ ctx, path, type, next }) => {
  const result = await next();
  if (type === "mutation") {
    getLogger().info({ procedure: path, admin: ctx.dbUser.email }, "Admin action");
  }
  return result;
});
\\\`\\\`\\\`

### Middleware that runs after the handler

Call \\\`next()\\\` first, then do your work. Useful for logging, metrics, or cleanup:

\\\`\\\`\\\`typescript
export const timedProcedure = publicProcedure.use(async ({ path, next }) => {
  const start = Date.now();
  const result = await next();
  getLogger().info({ procedure: path, durationMs: Date.now() - start }, "Procedure timing");
  return result;
});
\\\`\\\`\\\`

### Middleware that catches errors

Wrap \\\`next()\\\` in a try/catch to handle errors from downstream procedures:

\\\`\\\`\\\`typescript
export const errorWrappedProcedure = publicProcedure.use(async ({ path, next }) => {
  try {
    return await next();
  } catch (err) {
    if (err instanceof TRPCError) throw err;  // let tRPC errors pass through
    getLogger().error({ procedure: path, err }, "Unexpected error in procedure");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Something went wrong" });
  }
});
\\\`\\\`\\\`

This prevents internal error details from leaking to the client while still logging them server-side.

---

## Checklist

**Express middleware**
- [ ] Function with \\\`(req, res, next)\\\` signature
- [ ] File in \\\`packages/api/src/middleware/\\\`
- [ ] Wired in \\\`src/index.ts\\\` with \\\`app.use()\\\` in the correct order
- [ ] Calls \\\`next()\\\` to continue (or sends a response to reject)
- [ ] Tested in isolation with mock req/res/next

**tRPC middleware**
- [ ] Built on the right base procedure (\\\`publicProcedure\\\`, \\\`protectedProcedure\\\`, etc.)
- [ ] File in \\\`packages/api/src/middleware/\\\` if reused, or inline if single-router
- [ ] Calls \\\`next()\\\` with extended context if adding data
- [ ] Throws \\\`TRPCError\\\` with the right code to reject
- [ ] Tested through \\\`createCaller\\\` with appropriate mock context

**Naming**
- [ ] Procedure types named after what they require (\\\`adminProcedure\\\`), not what they do
- [ ] Express middleware functions named after their effect (\\\`requestLogger\\\`, \\\`requestId\\\`)`,
  },
];
