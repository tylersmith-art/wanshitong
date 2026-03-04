# Adding Middleware

How to add cross-cutting behavior — logic that runs across many requests or procedures without duplicating it in each handler. This project has two middleware systems that serve different purposes, and picking the wrong one means either missing the data you need or fighting the framework.

> **Note:** This is a step-by-step guide for future implementation. The example code shown below (such as `requestId` and `strictLimiter` for specific paths) does not exist in the codebase yet -- it is a worked example. To add middleware, follow the steps below and create each file as described.

## The Two Middleware Systems

### Express middleware

Runs on every HTTP request before tRPC sees it. Has access to the raw HTTP request and response — headers, IP address, method, path, status code. Knows nothing about tRPC procedures, user identity, or typed inputs.

```
HTTP request → Express middleware → tRPC adapter → procedure
```

Already in the project:

| Middleware | File | What it does |
|---|---|---|
| `cors()` | `src/index.ts` | Sets CORS headers |
| `getGlobalLimiter()` | `src/middleware/rateLimit.ts` | 100 req/15min per IP |
| `getRequestLogger()` | `src/middleware/requestLogger.ts` | Logs every request with pino-http |

### tRPC middleware

Runs inside the tRPC procedure chain. Has access to the typed context — the authenticated user (`ctx.user`), the database (`ctx.db`), the pubsub instance, and the validated input. Knows nothing about HTTP headers or IP addresses.

```
tRPC adapter → context creation → tRPC middleware → procedure handler
```

Already in the project:

| Middleware | File | What it does |
|---|---|---|
| `protectedProcedure` | `src/trpc.ts` | Rejects if no `ctx.user` (JWT required), resolves `ctx.dbUser` from `sub` |
| `adminProcedure` | `src/middleware/requireRole.ts` | Checks `ctx.dbUser.role`, rejects non-admins |

### How to decide which to use

| You need to... | Use | Why |
|---|---|---|
| Read or set HTTP headers | Express | tRPC middleware doesn't have access to the raw response |
| Rate-limit by IP address | Express | tRPC doesn't expose the client IP |
| Log raw request method/path/status | Express | These are HTTP-level concerns |
| Parse or transform the request body | Express | Before tRPC sees the request |
| Check if the user is authenticated | tRPC | `ctx.user` comes from context creation |
| Check the user's role or permissions | tRPC | Requires a DB lookup with `ctx.db` |
| Validate or transform procedure input | tRPC | Input is typed and available after Zod parsing |
| Log which procedure was called, by whom | tRPC | Express only sees `/api/trpc` — it doesn't know which procedure |
| Add data to the context for downstream procedures | tRPC | Express can't modify tRPC context |
| Apply logic to specific procedures or groups | tRPC | Express applies to all routes or a path prefix |

**Rule of thumb:** If it's about HTTP, use Express. If it's about the caller or the data, use tRPC.

---

## Adding Express Middleware

Express middleware is a function that takes `(req, res, next)`. Call `next()` to continue to the next middleware, or send a response to short-circuit.

### Example: Adding request ID tracking

Every request gets a unique ID in a header, available to all downstream code for log correlation.

```typescript
// packages/api/src/middleware/requestId.ts
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = req.headers["x-request-id"] as string ?? crypto.randomUUID();
  req.headers["x-request-id"] = id;
  res.setHeader("x-request-id", id);
  next();
}
```

Wire it in `src/index.ts`, before other middleware so the ID is available everywhere:

```typescript
// packages/api/src/index.ts
import { requestId } from "./middleware/requestId.js";

app.use(requestId);              // ← add first
app.use(getGlobalLimiter());
app.use(getRequestLogger());
```

### Example: Adding a stricter rate limit to a specific path

The template already has a `strictLimiter` (20 req/15min). Apply it to a specific route:

```typescript
// packages/api/src/index.ts
import { strictLimiter } from "./middleware/rateLimit.js";

// Apply strict limiting to a specific path only
app.use("/api/trpc/auth", strictLimiter);
```

Note: tRPC batches all procedure calls to `/api/trpc`, so path-based Express middleware has limited usefulness for targeting individual procedures. If you need per-procedure throttling, use tRPC middleware instead.

### Where Express middleware goes

```typescript
// packages/api/src/index.ts — the order matters

app.use(cors({ ... }));          // 1. CORS (must be first for preflight)
app.use(requestId);              // 2. Request ID (before logging)
app.use(getGlobalLimiter());     // 3. Rate limiting (before any processing)
app.use(getRequestLogger());     // 4. Logging (after ID is set, so logs include it)

app.get("/api/health", ...);  // 5. Health check (before tRPC, so it's fast)

app.use("/api/trpc", ...);    // 6. tRPC adapter
```

Order matters. Middleware runs top to bottom. Put cheap rejections (rate limiting) before expensive work (tRPC procedure routing).

### How to test Express middleware

Test it in isolation — call the function with mock req/res/next:

```typescript
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
```

---

## Adding tRPC Middleware

tRPC middleware is a function passed to `.use()` on a procedure. It receives the context and input, and calls `next()` to continue (optionally extending the context with new data).

### How the existing chain works

```typescript
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
```

```typescript
// packages/api/src/middleware/requireRole.ts
export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  // ... looks up user in DB, checks role ...
  return next({ ctx: { ...ctx, dbUser } });
});
// Admins only. Context now adds: { dbUser: the full user row from the database }
```

Middleware chains. `adminProcedure` builds on `protectedProcedure`, which builds on `publicProcedure`. Each layer can reject the request or add data to the context.

### Example: Audit logging middleware

Log every mutation — who called it, what procedure, when. This is the kind of thing that feels like it should be Express middleware but can't be, because Express only sees `POST /api/trpc` — it doesn't know which procedure was called.

```typescript
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
```

Use it in a router:

```typescript
// packages/api/src/routers/post.ts
import { auditedProcedure } from "../middleware/auditLog.js";

export const postRouter = router({
  list: publicProcedure.query(/* ... */),
  create: auditedProcedure           // ← replaces protectedProcedure
    .input(CreatePostSchema)
    .mutation(/* ... */),
});
```

The `path` parameter gives you the procedure name (e.g., `post.create`). The `type` is `"query"`, `"mutation"`, or `"subscription"`.

### Example: Owner-only middleware

Reusable middleware that checks if the caller owns a resource. Instead of duplicating the ownership check in every mutation (as shown in [Adding a New Entity — Step 3b](./adding-entities.md)), extract it:

```typescript
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
```

Now procedures can use `ctx.dbUser` without repeating the lookup:

```typescript
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
```

### Example: Input transform middleware

Middleware that runs after Zod validation and normalizes the input — trimming strings, lowercasing emails, etc. This uses the `rawInput` option:

```typescript
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
```

Note: In practice, do string normalization in the Zod schema with `.transform()` instead — it's more explicit and type-safe. Use middleware transforms for cross-cutting concerns that don't belong in individual schemas.

### Extending the context type

When middleware adds data to the context (like `adminProcedure` adds `dbUser`), downstream procedures see it as typed. This happens automatically because `next({ ctx: { ...ctx, dbUser } })` extends the context type.

If your middleware always adds a value, TypeScript infers it as present in downstream procedures. If it conditionally adds a value, use a type assertion or a branded type.

### How to test tRPC middleware

Test it through the procedure chain using `createCaller`, the same way you test routers:

```typescript
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
```

---

## Creating a New Procedure Type

When you find yourself applying the same tRPC middleware to many procedures, create a named procedure type. The template already does this with `protectedProcedure` and `adminProcedure`.

### The procedure hierarchy

```
publicProcedure                    ← no auth, anyone can call
  └── protectedProcedure           ← JWT required, ctx.user guaranteed
        ├── adminProcedure         ← role === "admin", ctx.dbUser added
        ├── ownerProcedure         ← ctx.dbUser added (for ownership checks)
        └── auditedProcedure       ← logs mutations with caller identity
```

Each level builds on the previous one. You never need to re-check auth in `adminProcedure` because `protectedProcedure` already did it.

### Where to define new procedure types

- Simple middleware (one check, no DB): add to `src/trpc.ts` alongside `protectedProcedure`
- Middleware that queries the DB or has complex logic: create a file in `src/middleware/`
- Middleware used by a single router: define it in that router file (no need to export it)

### Naming convention

Name the procedure type after what it requires, not what it does:

| Name | Meaning |
|---|---|
| `protectedProcedure` | Requires authentication |
| `adminProcedure` | Requires admin role |
| `ownerProcedure` | Requires the caller's DB user (for ownership checks) |
| `auditedProcedure` | Requires auth + logs the call (side effect) |

---

## Common Patterns

### Composing multiple middlewares

Chain `.use()` calls to compose multiple concerns:

```typescript
export const auditedAdminProcedure = adminProcedure.use(async ({ ctx, path, type, next }) => {
  const result = await next();
  if (type === "mutation") {
    getLogger().info({ procedure: path, admin: ctx.dbUser.email }, "Admin action");
  }
  return result;
});
```

### Middleware that runs after the handler

Call `next()` first, then do your work. Useful for logging, metrics, or cleanup:

```typescript
export const timedProcedure = publicProcedure.use(async ({ path, next }) => {
  const start = Date.now();
  const result = await next();
  getLogger().info({ procedure: path, durationMs: Date.now() - start }, "Procedure timing");
  return result;
});
```

### Middleware that catches errors

Wrap `next()` in a try/catch to handle errors from downstream procedures:

```typescript
export const errorWrappedProcedure = publicProcedure.use(async ({ path, next }) => {
  try {
    return await next();
  } catch (err) {
    if (err instanceof TRPCError) throw err;  // let tRPC errors pass through
    getLogger().error({ procedure: path, err }, "Unexpected error in procedure");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Something went wrong" });
  }
});
```

This prevents internal error details from leaking to the client while still logging them server-side. See the error handling section in [tRPC](./trpc.md).

---

## Checklist

**Express middleware**
- [ ] Function with `(req, res, next)` signature
- [ ] File in `packages/api/src/middleware/`
- [ ] Wired in `src/index.ts` with `app.use()` in the correct order
- [ ] Calls `next()` to continue (or sends a response to reject)
- [ ] Tested in isolation with mock req/res/next

**tRPC middleware**
- [ ] Built on the right base procedure (`publicProcedure`, `protectedProcedure`, etc.)
- [ ] File in `packages/api/src/middleware/` if reused, or inline if single-router
- [ ] Calls `next()` with extended context if adding data
- [ ] Throws `TRPCError` with the right code to reject
- [ ] Tested through `createCaller` with appropriate mock context

**Naming**
- [ ] Procedure types named after what they require (`adminProcedure`), not what they do
- [ ] Express middleware functions named after their effect (`requestLogger`, `requestId`)

---

## Related

- [tRPC](./trpc.md) — Procedure types, router structure, how context flows
- [Authentication](./authentication.md) — How `ctx.user` gets populated (context creation, not middleware)
- [Roles & Permissions](./roles-permissions.md) — `adminProcedure` and custom role middleware
- [Rate Limiting](./rate-limiting.md) — Express-level rate limiting with `express-rate-limit`
- [Structured Logging](./logging.md) — pino-http request logging (Express) and structured logs (tRPC)
- [Testing](./testing.md) — Mocking patterns for both Express and tRPC middleware
