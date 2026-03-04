# Database

Drizzle ORM with PostgreSQL. Schema defined in TypeScript. Migrations generated automatically from schema changes.

## Current Schema

```typescript
// packages/api/src/db/schema.ts
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
```

## Database Connection

```typescript
// packages/api/src/db/index.ts
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
```

The context factory calls `getDb()` each time it creates a context, but the underlying connection is cached after the first call. See `packages/api/src/context.ts` for the full context setup.

## How to Implement

### Add a new table

```typescript
// packages/api/src/db/schema.ts
export const posts = pgTable("posts", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  body: varchar("body", { length: 10000 }).notNull(),
  authorId: uuid("author_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

Then generate and apply the migration:

```bash
pnpm db:generate   # creates SQL migration file in packages/api/drizzle/
pnpm db:migrate    # applies it to the database
```

### Add a column to an existing table

```typescript
// packages/api/src/db/schema.ts — add to users
export const users = pgTable("users", {
  // ...existing columns...
  avatarUrl: varchar("avatar_url", { length: 500 }),  // nullable by default
});
```

Then: `pnpm db:generate && pnpm db:migrate`

### Keep Zod schemas in sync

If the change is visible to clients, update the shared Zod schema too:

```typescript
// packages/shared/src/schemas/user.ts
export const UserSchema = CreateUserSchema.extend({
  id: z.string().uuid(),
  role: RoleSchema.default("user"),
  avatarUrl: z.string().url().nullable().default(null),  // match the DB column
  lastLoginAt: z.date().nullable().default(null),
  createdAt: z.date(),
});
```

### Query examples

```typescript
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
```

### Seed data

```typescript
// packages/api/src/db/seed.ts
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
```

Run with: `pnpm db:seed`

To add seed data, edit `packages/api/src/db/seed.ts` and add to the array.

## How to Test

Mock the database in router tests:

```typescript
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
```

The mock needs to be chainable — each method returns `this` (via `mockReturnThis()`), except terminal methods like `orderBy` or `returning` which return the final data.

Reset between tests:

```typescript
beforeEach(() => {
  vi.clearAllMocks();
  mockDb.select.mockReturnThis();
  mockDb.from.mockReturnThis();
  // ...reset all chain methods
});
```

## How to Debug

- **"relation does not exist"?** Run `pnpm db:migrate`. The migration hasn't been applied.
- **Migration fails?** Check the generated SQL in `packages/api/drizzle/`. Drizzle generates incremental migrations — if you edited a migration file manually, it may be out of sync.
- **Schema drift?** If the database is out of sync with your schema, use `pnpm db:studio` (Drizzle Studio) to inspect the actual table structure.
- **Reset everything:** `pnpm docker:reset` wipes Postgres data entirely. Then: `pnpm db:migrate && pnpm db:seed`.
- **Connection refused?** Make sure Docker is running: `pnpm docker:up`. Check `DATABASE_URL` points to `localhost:5432`.
- **Drizzle Studio:** `pnpm db:studio` opens a browser-based GUI to browse tables, run queries, and inspect data.
