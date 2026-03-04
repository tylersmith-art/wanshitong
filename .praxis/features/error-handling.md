# Error Handling

How errors are thrown, caught, and displayed across the API and client. The system has three layers — Zod validation, tRPC procedure errors, and client-side React Query handling — and each layer has a specific job. Getting this right means users see clear messages, developers see useful logs, and internal details never leak.

## The Three Layers

```
Client (React)
  ← TRPCClientError with code + message
API (tRPC procedure)
  ← TRPCError with code
API (Zod .input())
  ← automatic BAD_REQUEST on invalid input
```

### Layer 1: Zod input validation

Zod schemas on `.input()` validate automatically. If validation fails, tRPC returns a `BAD_REQUEST` error with Zod's field-level messages. You never write this logic — it's handled by the framework:

```typescript
create: protectedProcedure
  .input(CreateUserSchema)  // invalid input → automatic BAD_REQUEST
  .mutation(async ({ ctx, input }) => {
    // input is already validated and typed — safe to use
  }),
```

The client receives an error with `code: "BAD_REQUEST"` and a message containing the Zod validation details. See [tRPC](./trpc.md) for how schemas flow through procedures.

### Layer 2: tRPC procedure errors

Business logic errors inside procedures use `TRPCError` with the appropriate code. These are the errors you write explicitly:

```typescript
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
```

### Layer 3: Client-side handling

React Query (via tRPC hooks) catches errors and exposes them on the query/mutation result. The client decides how to display them:

```typescript
const { data, error, isLoading } = trpc.user.list.useQuery();

// error is a TRPCClientError with .message and .data.code
if (error) {
  console.log(error.data?.code);  // "NOT_FOUND", "FORBIDDEN", etc.
  console.log(error.message);      // the message string from the server
}
```

---

## tRPC Error Codes

Use the right code — it determines both the HTTP status and the client behavior:

| Code | HTTP | When to use |
|---|---|---|
| `BAD_REQUEST` | 400 | Required data is missing or malformed in a way Zod can't catch (e.g., JWT has no email claim, a referenced ID is absent from the token). Not for business rule violations. |
| `UNAUTHORIZED` | 401 | No valid JWT. Already handled by `protectedProcedure` — you rarely throw this manually |
| `FORBIDDEN` | 403 | User is authenticated but the action is not allowed — wrong role, not the owner, or a business rule prevents it (e.g., "an admin already exists") |
| `NOT_FOUND` | 404 | The requested resource doesn't exist |
| `CONFLICT` | 409 | Action would create a duplicate or violate a uniqueness constraint |
| `INTERNAL_SERVER_ERROR` | 500 | Something unexpected broke — catch it, log it, throw a generic message |

Codes you almost never use directly: `UNAUTHORIZED` (middleware handles it), `METHOD_NOT_SUPPORTED`, `TIMEOUT`, `PARSE_ERROR` (framework handles these).

---

## Server-Side Patterns

### Throw TRPCError at the boundary

Procedures are the system boundary — they face the client. Throw `TRPCError` here:

```typescript
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
```

### Return result objects inside the API *(pattern — not yet used in the codebase)*

When you add adapters or service integrations (see [Adding an External Service](./adding-external-services.md)), functions that can fail should return result objects instead of throwing. This lets the procedure decide what to do with the failure:

```typescript
// In the adapter — returns a result, doesn't throw
async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const response = await fetch(url, { ... });
  if (!response.ok) {
    return { success: false, error: `API returned ${response.status}` };
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
```

See [Coding Guidelines](./coding-guidelines.md) for more on this pattern.

### Never leak internals

Log the details server-side, send a generic message to the client:

```typescript
// YES — log details, throw generic message
logger.error({ err, userId: input.userId }, "Failed to send welcome email");
throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to send email" });

// NO — stack trace, internal structure visible to client
throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.stack });
```

### Unhandled errors

If a procedure throws something that isn't a `TRPCError` (e.g., a database connection error, an unhandled null), tRPC automatically catches it and returns a generic `INTERNAL_SERVER_ERROR` to the client. The original error is written to stderr by tRPC's default handler. To route unhandled errors through pino, add an `onError` handler to `createExpressMiddleware()` in `index.ts`.

You don't need to wrap every procedure in try/catch for this reason. Only catch errors you can actually handle or where you need to add context to the log:

```typescript
// NO — catch and re-throw adds nothing
try {
  const [user] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1);
} catch (err) {
  throw err;
}

// YES — just let it propagate
const [user] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1);
```

---

## Client-Side Patterns

### Handling query errors

Queries expose errors on the result object. Display them inline:

```typescript
export function Users() {
  const { users, isLoading, error } = useUsers();

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div className="text-red-500">Error: {error}</div>;

  return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
}
```

The `useUsers` hook already extracts `error.message` as a string. For hooks that use raw tRPC, the error object has more detail:

```typescript
const { error } = trpc.user.list.useQuery();
// error.message — the human-readable message
// error.data?.code — "NOT_FOUND", "FORBIDDEN", etc.
```

### Handling mutation errors

Mutations can handle errors in two ways:

**Inline with `onError`** — for showing error messages next to the action:

```typescript
const [error, setError] = useState<string | null>(null);

const deleteMutation = trpc.user.delete.useMutation({
  onSuccess: () => utils.user.list.invalidate(),
  onError: (err) => setError(err.message),
});
```

**Checking `isPending` + error state** — for forms:

```typescript
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
```

### Reacting to specific error codes

When different errors need different UI treatment, check `error.data.code`:

```typescript
const { data, error, isLoading } = trpc.admin.listUsers.useQuery();

if (error?.data?.code === "FORBIDDEN") {
  return <div>You don't have admin permissions.</div>;
}

if (error) {
  return <div>Something went wrong: {error.message}</div>;
}
```

This pattern is used in `Admin.tsx` — a `FORBIDDEN` error shows a "Claim Admin" button instead of a generic error message.

### React Query retry behavior

The `TRPCProvider` configures React Query with `retry: 1` — failed queries retry once, then surface the error. This is set in `hooks/src/providers/TRPCProvider.tsx`:

```typescript
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
})
```

You generally don't need to change this. For mutations, React Query doesn't retry by default (mutations are not idempotent).

---

## Environment and Startup Errors

The API validates all required env vars at startup using Zod. If validation fails, it prints clear per-field errors and exits before starting the server:

```
Environment validation failed:
  DATABASE_URL: DATABASE_URL must be a valid URL
  AUTH0_AUDIENCE: Required
```

This is handled by `validateEnv()` in `api/src/lib/env.ts`. See [Environment Validation](./env-validation.md) for how to add new env vars.

---

## Summary: Where Each Error Type Is Handled

| Error type | Where it's thrown | Where it's caught | What the client sees |
|---|---|---|---|
| Invalid input | Zod (automatic) | tRPC framework | `BAD_REQUEST` + field errors |
| Not found | Procedure (`TRPCError`) | React Query | `NOT_FOUND` + your message |
| Not authorized | `protectedProcedure` middleware | React Query | `UNAUTHORIZED` |
| Not permitted | Procedure or middleware (`TRPCError`) | React Query | `FORBIDDEN` + your message |
| External service failure | Adapter (result object) | Procedure catches it, logs, rethrows as `TRPCError` | `INTERNAL_SERVER_ERROR` + generic message |
| Unexpected crash | Anywhere (unhandled throw) | tRPC framework | `INTERNAL_SERVER_ERROR` (generic) |
| Missing env var | `validateEnv()` at startup | Process exits | Server doesn't start |

---

## Related

- [Coding Guidelines](./coding-guidelines.md) — Result objects over thrown errors, never leak internals
- [tRPC](./trpc.md) — Procedure types, input validation, how errors flow to the client
- [Adding Middleware](./adding-middleware.md) — Error-wrapping middleware pattern
- [Structured Logging](./logging.md) — How errors are logged server-side
- [Adding an External Service](./adding-external-services.md) — Adapter result pattern
