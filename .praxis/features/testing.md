# Testing

> **Note:** `@template` is a placeholder package scope. When you run `scripts/init.sh <project-name>`, it replaces every `@template/` reference (including in these docs) with `@<project-name>/`.

Vitest runs tests in the `api` and `shared` packages. Tests live next to the code they test (`*.test.ts`). The `hooks` and `web` packages have placeholder scripts (React test infra can be added later).

## Running Tests

```bash
pnpm test                              # all packages
cd packages/api && pnpm test           # just API
cd packages/shared && pnpm test        # just shared schemas
pnpm --filter @template/api test       # alternative filter syntax
```

Vitest runs in single-run mode (`vitest run`). For watch mode during development:

```bash
cd packages/api && npx vitest          # re-runs on file changes
```

## Existing Tests

| File | What it covers |
|---|---|
| `shared/src/schemas/user.test.ts` | CreateUserSchema, UserSchema, RoleSchema, UpdateUserRoleSchema |
| `shared/src/schemas/sync.test.ts` | SyncActionSchema, SyncEventSchema, syncChannel |
| `api/src/lib/env.test.ts` | validateEnv success and exit-on-failure |
| `api/src/middleware/auth.test.ts` | verifyToken valid/invalid (jose mocked) |
| `api/src/routers/user.test.ts` | user.list, user.create (auth + insert), user.delete (auth check) |

## How to Implement

### Schema tests

The simplest pattern — test Zod validation directly:

```typescript
// packages/shared/src/schemas/post.test.ts
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
```

### Router tests

Use `createCaller()` to test tRPC procedures without HTTP. Mock the database and pubsub:

```typescript
// packages/api/src/routers/post.test.ts
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
```

### Middleware tests

For modules that call `getEnv()` (like `auth.ts`), mock the `env` module so `getEnv()` returns test values, and mock `jose` so no real JWKs are fetched:

```typescript
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
```

**`vi.stubEnv()` for env validation tests:** When testing `validateEnv()` directly (rather than middleware that calls `getEnv()`), prefer `vi.stubEnv()` to stub `process.env` values instead of mocking the entire module:

```typescript
// Preferred for env var tests — directly stub process.env values
vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/testdb");
vi.stubEnv("AUTH0_ISSUER_BASE_URL", "https://test.auth0.com");
vi.stubEnv("AUTH0_AUDIENCE", "https://api.test.com");
```

Use `vi.stubEnv()` when you want `validateEnv()` to parse real `process.env` values through Zod. Use `vi.mock()` on the env module (as shown above) when you need to control what `getEnv()` returns in middleware or router tests where the env module is imported as a dependency.

Then in the test, import the mocked function and use `mockResolvedValueOnce` to control each call:

```typescript
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
```

`vi.mock()` is hoisted to the top of the file. If you need setup before the mock factory runs, use `vi.hoisted()`. Regular code runs after both.

### Testing process.exit

```typescript
it("exits on invalid env", () => {
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit called");
  });
  vi.spyOn(console, "error").mockImplementation(() => {});

  expect(() => validateEnv()).toThrow("process.exit called");
  expect(exitSpy).toHaveBeenCalledWith(1);
});
```

## Config

```typescript
// packages/api/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

Same config for `packages/shared/vitest.config.ts`.

## How to Debug

- **"Cannot find module" in tests?** Tests import source `.ts` files (Vitest transforms them), not compiled `.js`. But local imports still need `.js` extensions because the project uses ESM.
- **External calls during tests?** `db/index.ts` and `auth.ts` use lazy initialization, but their exported functions (`getDb()`, `verifyToken()`) will make real connections when called during tests. Always mock these modules with `vi.mock()`.
- **Mocks not working?** `vi.mock()` is hoisted to the top of the file. If you need setup before the mock factory runs, use `vi.hoisted()`. If mocking a default export, return `{ default: ... }`.
- **Test isolation issues?** Use `beforeEach(() => vi.clearAllMocks())` to reset mock call counts. Use `vi.restoreAllMocks()` if you used `spyOn`.
- **Want to run a single test?** `cd packages/api && npx vitest run src/routers/user.test.ts` or use `.only`: `it.only("my test", ...)`.
