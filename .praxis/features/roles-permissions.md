# Roles & Permissions

Two roles: `user` (default) and `admin`. Roles live in the database on the `users` table, validated with Zod schemas, and enforced via tRPC middleware.

## How It Works

```
JWT (sub claim) → protectedProcedure resolves ctx.dbUser → adminProcedure checks role
```

The `protectedProcedure` middleware (in `trpc.ts`) resolves `ctx.dbUser` from the JWT `sub` claim on every authenticated request. The `adminProcedure` then simply checks the role:

```typescript
// packages/api/src/middleware/requireRole.ts
export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.dbUser || ctx.dbUser.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }

  return next({ ctx });
});
```

No redundant DB query — `ctx.dbUser` was already resolved by `protectedProcedure`.

## First Admin Setup

When the project is first deployed, no admin exists. The `claimAdmin` mutation lets the first authenticated user promote themselves.

Note: Both `claimAdmin` and `adminProcedure` use `BAD_REQUEST` for a missing email — a JWT without an email claim is a malformed request, not an access control issue. `FORBIDDEN` is reserved for authenticated users who lack the required role.

```typescript
// packages/api/src/routers/admin.ts
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
```

After that, admins manage roles via the `/admin` page or the `admin.updateRole` mutation.

## Existing Admin Endpoints

| Procedure | Access | What it does |
|---|---|---|
| `admin.claimAdmin` | `protectedProcedure` | Promotes caller to admin if no admin exists |
| `admin.listUsers` | `adminProcedure` | Returns all users with roles |
| `admin.updateRole` | `adminProcedure` | Sets a user's role by email |

## How to Implement a New Role

### 1. Add the role to the schema

```typescript
// packages/shared/src/schemas/user.ts
export const RoleSchema = z.enum(["user", "admin", "moderator"]);
```

### 2. Create a procedure middleware

```typescript
// packages/api/src/middleware/requireRole.ts
export const moderatorProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.dbUser || !["admin", "moderator"].includes(ctx.dbUser.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Moderator access required" });
  }

  return next({ ctx });
});
```

### 3. Use it in a router

```typescript
deleteComment: moderatorProcedure
  .input(z.object({ commentId: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    // only admins and moderators reach here
  }),
```

### 4. Update the admin panel

In `packages/web/src/views/Admin.tsx`, add the new role to the `ROLES` array:

```typescript
const ROLES = ["user", "moderator", "admin"] as const;
```

## How to Test

```typescript
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
```

## How to Debug

- **"Admin access required" but you are admin?** The middleware looks up the user by `sub` from the JWT. Make sure the `sub` column in the `users` table matches your Auth0 user ID. Decode your token at jwt.io to check the `sub` claim.
- **claimAdmin says "An admin already exists"?** Check `users` table for any row with `role = 'admin'`. Use Drizzle Studio: `pnpm db:studio`.
- **claimAdmin says "User not found"?** Your Auth0 account email must already exist in the `users` table. Create a user first (via the Users page) with the same email as your Auth0 login.
- **New role not showing in Admin panel?** Make sure you added it to the `ROLES` array in `Admin.tsx` and to `RoleSchema` in the shared package, then rebuild: `pnpm build`.
