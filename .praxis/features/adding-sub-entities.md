# Adding Sub-Entities

How to add data that belongs to an existing entity — comments on a post, tasks in a project, line items on an invoice, notes on a user. The parent already exists; you're adding children that reference it with a foreign key.

This guide builds on [Adding a New Entity](./adding-entities.md). If the parent entity doesn't exist yet, do that first. This guide covers the parts that are different when there's a relationship: foreign keys, join queries, cascading deletes, nested Zod schemas, and what to publish for real-time sync.

This guide uses "notes that belong to a user" as the example. Replace with your entities throughout.

> **Note:** This is a step-by-step guide for future implementation. The example code shown below does not exist in the codebase yet -- it is a worked example. To add a sub-entity, follow the steps below and create each file as described.

## Overview of Files You'll Touch

Same set as adding any entity, plus you'll modify the parent's router and hook to expose the children.

```
packages/shared/src/schemas/note.ts       ← Zod schemas (references parent ID)
packages/shared/src/schemas/index.ts      ← Re-export
packages/api/src/db/schema.ts             ← Drizzle table with foreign key
packages/api/src/routers/note.ts          ← tRPC router (scoped to parent)
packages/api/src/routers/index.ts         ← Wire into appRouter
packages/hooks/src/hooks/useNotes.ts      ← React Query hook (takes parentId)
packages/hooks/src/index.ts               ← Re-export
packages/web/src/views/Notes.tsx          ← UI (or inline in parent view)
```

---

## Step 1: Define the Zod Schemas

The create schema takes the parent ID as a required field. This is how the client tells the API which parent the child belongs to.

```typescript
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
```

Re-export from the barrel:

```typescript
// packages/shared/src/schemas/index.ts — add these lines
export {
  CreateNoteSchema,
  NoteSchema,
  type Note,
  type CreateNote,
} from "./note.js";
```

Rebuild shared:

```bash
pnpm build --filter=@wanshitong/shared
```

**Should the create schema include the parent ID?** Yes. The alternative is passing the parent ID as a URL/path parameter and omitting it from the body schema, but tRPC doesn't have path parameters — everything goes through input. Including it in the schema also means the client gets type-checked at compile time.

---

## Step 2: Define the Database Table with a Foreign Key

```typescript
// packages/api/src/db/schema.ts — add below the users table
export const notes = pgTable("notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: varchar("content", { length: 5000 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

Generate and apply the migration:

```bash
pnpm db:generate
pnpm db:migrate
```

### Choosing `onDelete` behavior

This is the most important decision for a sub-entity. It determines what happens to children when the parent is deleted.

| Behavior | SQL | When to use |
|---|---|---|
| `cascade` | Children are deleted with the parent | Owned data that has no meaning without the parent (notes, line items, comments) |
| `set null` | Foreign key becomes `NULL` | Data that should survive (e.g., posts by a deleted user — keep the post, clear the author) |
| `restrict` | Parent delete is blocked if children exist | The parent shouldn't be deletable while children are active (e.g., can't delete a project with open tasks) |

Most sub-entities use `cascade`. If you're unsure, ask: "does this child make sense without its parent?" If no, cascade. If yes, set null or restrict.

For `set null`, the foreign key column must be nullable:

```typescript
userId: uuid("user_id")
  .references(() => users.id, { onDelete: "set null" }),  // no .notNull()
```

See [Database](./database.md) for Drizzle column types and migration commands.

---

## Step 3: Create the tRPC Router (Scoped to Parent)

The key difference from a standalone entity: **reads and writes are scoped to a parent ID**. The `list` procedure takes a parent ID input and filters by it. The `create` mutation attaches the parent ID to the insert.

```typescript
// packages/api/src/routers/note.ts
import { z } from "zod";
import { eq } from "drizzle-orm";
import { tracked } from "@trpc/server";
import {
  CreateNoteSchema,
  syncChannel,
  type SyncEvent,
  type Note,
} from "@wanshitong/shared";
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
```

Wire it into the app router:

```typescript
// packages/api/src/routers/index.ts
import { noteRouter } from "./note.js";

export const appRouter = router({
  user: userRouter,
  admin: adminRouter,
  jobs: jobsRouter,
  note: noteRouter,  // add here
});
```

### Should the router be nested under the parent?

You have two options:

**Flat (recommended for this template):** `trpc.note.list({ userId })` — a separate top-level router. Simpler routing, straightforward hook wiring.

**Nested:** `trpc.user.notes.list({ userId })` — a sub-router merged into the parent. Better conceptual grouping, but tRPC nested routers add complexity for marginal benefit.

This guide uses flat routing. If you prefer nested, create the note router the same way but merge it into the user router instead of the app router.

### What about ownership checks?

If only the parent's owner should manage children, add the same ownership check pattern from [Adding a New Entity — Step 3b](./adding-entities.md):

```typescript
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
```

See [Roles & Permissions](./roles-permissions.md) for admin bypass patterns.

---

## Step 4: Querying Parent + Children Together (Joins)

Sometimes you want to return children alongside their parent in a single query — e.g., listing users with their note count, or loading a user profile with their notes included.

### Count children per parent

```typescript
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
```

`leftJoin` ensures parents with zero children still appear. `innerJoin` would exclude them.

### Load a parent with all its children

```typescript
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
```

**Which approach to use?** Two queries is clearer and works well for loading a single parent with its children. The join approach is better when loading many parents with children (avoids N+1). For most sub-entity cases in this template, two queries is fine.

### Zod schema for the joined response

If you're returning nested data, add a schema for it:

```typescript
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
```

You don't always need this. If the joined response is only used by one procedure and never validated elsewhere, the TypeScript return type from the query is sufficient. Add the Zod schema when the nested shape is part of your public API contract or used in multiple places.

---

## Step 5: Real-Time Sync Decisions

When a child is created, updated, or deleted, you need to decide what to publish and who should care.

### Option A: Publish the child only (recommended for most cases)

```typescript
await ctx.pubsub.publish(syncChannel("note"), {
  action: "created",
  data: note,
  timestamp: Date.now(),
});
```

The child hook (`useNotes`) subscribes to `sync:note` and updates its own cache. The parent hook (`useUsers`) doesn't need to know.

**Use when:** The parent view doesn't show child data inline. Notes are viewed on a separate page or section.

### Option B: Publish the child AND invalidate the parent

```typescript
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
```

**Use when:** The parent view shows aggregated child info (counts, latest child, status derived from children). The parent hook receives the "updated" event and refetches.

### Option C: Publish the parent with children embedded

```typescript
const updatedUser = await ctx.db.select().from(users).where(eq(users.id, input.userId)).limit(1);
const userNotes = await ctx.db.select().from(notes).where(eq(notes.userId, input.userId));

await ctx.pubsub.publish(syncChannel("user"), {
  action: "updated",
  data: { ...updatedUser[0], notes: userNotes },
  timestamp: Date.now(),
});
```

**Use when:** Rarely. This increases message size and couples the parent and child sync channels. Usually Option A or B is better.

See [Real-Time Sync](./realtime-sync.md) for the full pubsub pattern.

---

## Step 6: Create the Client Hook (Scoped to Parent)

The hook takes a parent ID and passes it to the list query. The sync subscription filters events by parent ID on the client side.

```typescript
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
```

Re-export from the hooks barrel:

```typescript
// packages/hooks/src/index.ts — add this line
export { useNotes } from "./hooks/useNotes.js";
```

**Key differences from a top-level entity hook:**
- Uses `useSyncSubscription` (same as top-level hooks) but each callback filters by parent ID before updating the cache
- The hook takes `userId` as a parameter
- `listQuery` passes `{ userId }` to scope the query
- `setData` and `invalidate` pass `{ userId }` so React Query updates the right cache entry
- `createNote` wraps the mutation to auto-attach the `userId` so the caller only passes `content`

See [Real-Time Sync](./realtime-sync.md) for more on the subscription pattern.

---

## Step 7: Build the Frontend

Sub-entity views can be standalone pages (e.g., `/users/:userId/notes`) or inline sections within the parent view.

### As an inline section on the parent

```tsx
// Inside an existing view — e.g., a user detail page
import { useNotes } from "@wanshitong/hooks";

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
```

### As a standalone page with a route parameter

```tsx
// packages/web/src/views/UserNotes.tsx
import { useParams } from "react-router-dom";
import { useNotes } from "@wanshitong/hooks";

export function UserNotes() {
  const { userId } = useParams<{ userId: string }>();
  if (!userId) return <p>Missing user ID</p>;

  const { notes, isLoading, createNote, isCreating } = useNotes(userId);
  // ... same UI as above
}
```

```typescript
// packages/web/src/App.tsx — add route
<Route path="/users/:userId/notes" element={<UserNotes />} />
```

See [Web App](./web-app.md) for routing and styling patterns.

---

## Step 8: Cascading Deletes and Sync

If you used `onDelete: "cascade"` on the foreign key, Postgres automatically deletes children when the parent is deleted. But the client doesn't know about those cascaded deletes unless you handle it.

### Option A: Invalidate the child cache when the parent is deleted

In the parent's delete mutation, publish a sync event on the child's channel too:

```typescript
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
```

### Option B: Let the client handle it naturally

If the child view is only visible when the parent exists (e.g., it's a section on the parent's detail page), navigating away from the deleted parent unmounts the child hook. The stale cache entry is harmless and gets garbage-collected by React Query.

Option B is usually fine. Only use Option A if children are visible independently of the parent (e.g., a "recent notes" feed that includes notes from all users).

---

## Step 9: Write Tests

### Schema tests

```typescript
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
```

### Router tests

```typescript
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
```

Run all tests:

```bash
pnpm test
```

See [Testing](./testing.md) for mocking patterns and debugging test issues.

---

## Checklist

Everything from the [Adding a New Entity checklist](./adding-entities.md), plus:

**Relationship**
- [ ] Foreign key in Drizzle schema with appropriate `onDelete` behavior (`cascade`, `set null`, or `restrict`)
- [ ] Migration generated and applied
- [ ] Create schema includes the parent ID field (`userId`, `projectId`, etc.)

**API**
- [ ] `list` procedure takes parent ID as input and filters by it
- [ ] `create` mutation includes the parent ID in the insert
- [ ] Ownership check on mutations if only the parent's owner should manage children
- [ ] Cascading delete handling — either notify child channel or rely on view unmounting

**Client**
- [ ] Hook takes parent ID as parameter
- [ ] `listQuery`, `setData`, and `invalidate` all pass the parent ID to scope to the right cache entry
- [ ] Sync subscription filters events by parent ID (ignores events for other parents)
- [ ] `createNote` wrapper auto-attaches parent ID so callers only pass child fields

**Joins (if needed)**
- [ ] `leftJoin` for counts or optional children, `innerJoin` when children are required
- [ ] Joined response reshaped from flat rows into nested structure
- [ ] Zod schema for nested response if it's part of the public API contract

---

## Common Patterns

### Multiple children on the same parent

A user can have notes, tasks, and bookmarks. Each gets its own table, router, and hook — they all follow this same guide independently. They all reference `users.id` with their own foreign key.

### Grandchildren (nested sub-entities)

A project has tasks, a task has comments. Same pattern, one level deeper. The comment table references `tasks.id`, the comment router scopes by `taskId`, and the hook takes `taskId`. The cascading delete chain is: project deleted → tasks cascade-deleted → comments cascade-deleted.

### Many-to-many relationships

Users belong to multiple teams, teams have multiple users. This requires a join table:

```typescript
export const teamMembers = pgTable("team_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 50 }).notNull().default("member"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
});
```

The router needs `addMember` and `removeMember` mutations instead of `create` and `delete`. The hook queries through the join table. Everything else follows the same principles.

---

## Related

- [Adding a New Entity](./adding-entities.md) — Full walkthrough for adding a standalone entity (start here if the parent doesn't exist yet)
- [Database](./database.md) — Drizzle column types, joins, migrations, seed data
- [tRPC](./trpc.md) — Procedure types, router structure, type flow
- [Real-Time Sync](./realtime-sync.md) — PubSub pattern, subscription wiring, cache updates
- [Roles & Permissions](./roles-permissions.md) — Ownership checks, admin bypass
- [Testing](./testing.md) — Mocking patterns for routers, middleware, and schemas
