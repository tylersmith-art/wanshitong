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
];
