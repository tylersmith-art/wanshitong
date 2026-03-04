# Migrations and Seeding

How to change the database schema, get those changes applied in every environment, and populate tables with the data they need to function. This comes up every time you add an entity, add a column, or change a relationship — and doing it wrong means either a broken deploy or an app that boots with empty lookup tables.

## How It Works End-to-End

```
1. Edit schema.ts        ← you change the TypeScript schema
2. pnpm db:generate      ← Drizzle compares schema to last snapshot, writes SQL migration
3. pnpm db:migrate       ← migrate.ts applies pending SQL files to Postgres
4. Commit the migration  ← SQL file goes into version control
5. Deploy                ← production runs the same migrate.ts against its database
```

The migration files in `packages/api/drizzle/` are the source of truth for database state. Drizzle Kit generates them by diffing your TypeScript schema against its internal snapshot. You never write SQL by hand unless you need a data migration (more on that below).

### Key files

```
packages/api/src/db/schema.ts        ← TypeScript schema (what you edit)
packages/api/drizzle.config.ts       ← Drizzle Kit config (points to schema + output dir)
packages/api/drizzle/                ← Generated SQL migration files (committed to git; starts empty, populated by db:generate)
packages/api/src/db/migrate.ts       ← Runs pending migrations against DATABASE_URL
packages/api/src/db/seed.ts          ← Populates tables with development/reference data
```

---

## Creating a Migration

### Step 1: Edit the schema

Make your change in `packages/api/src/db/schema.ts`. This could be a new table, a new column, a changed type, or a dropped column.

```typescript
// Adding a column to an existing table
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  role: varchar("role", { length: 50 }).notNull().default("user"),
  avatarUrl: varchar("avatar_url", { length: 500 }),  // ← new column
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

### Step 2: Generate the migration

```bash
pnpm db:generate
```

This runs `drizzle-kit generate`, which:
1. Reads your current `schema.ts`
2. Compares it against its internal snapshot (stored in `drizzle/meta/`)
3. Writes a new SQL file in `packages/api/drizzle/` with the diff

The output looks like:

```
packages/api/drizzle/
  0000_initial.sql              ← first migration (creates tables)
  0001_add_avatar_url.sql       ← your new migration
  meta/
    _journal.json               ← tracks which migrations exist
    0000_snapshot.json           ← schema state after first migration
    0001_snapshot.json           ← schema state after your migration
```

### Step 3: Review the generated SQL

Always look at the generated file before applying it:

```bash
cat packages/api/drizzle/0001_add_avatar_url.sql
```

```sql
ALTER TABLE "users" ADD COLUMN "avatar_url" varchar(500);
```

Drizzle generates correct migrations most of the time, but review for:
- **Destructive changes** — dropping columns, changing types, removing constraints. Drizzle will generate the SQL but won't warn you about data loss.
- **Missing defaults** — a new `NOT NULL` column without a default will fail if the table has existing rows. Either add a default in the schema or add a manual `UPDATE` before the `ALTER` (see data migrations below).
- **Index names** — Drizzle auto-names indexes. If you rename a column, it may drop and recreate the index rather than rename it.

### Step 4: Apply the migration

```bash
pnpm db:migrate
```

This runs `packages/api/src/db/migrate.ts`, which:
1. Connects to the database specified by `DATABASE_URL`
2. Checks the `drizzle.__drizzle_migrations` table for which migrations have already run
3. Applies any pending SQL files in order
4. Records each applied migration so it won't run again

### Step 5: Commit the migration files

```bash
git add packages/api/drizzle/
git add packages/api/src/db/schema.ts
```

The generated SQL files and the meta snapshots must be committed. They are how every other environment (teammates' machines, CI, staging, production) gets the same database state.

---

## Seeding Data

Seeding is about getting data into the database after the schema exists. There are two kinds of seed data, and they have different rules.

### Development seed data

Fake data for local development — test users, sample posts, dummy records. This makes the app usable during development without manually creating everything through the UI.

This lives in `packages/api/src/db/seed.ts` and runs with:

```bash
pnpm db:seed
```

The current seed script:

```typescript
// packages/api/src/db/seed.ts
const seedUsers = [
  { name: "Admin User", email: "admin@example.com", role: "admin" as const },
  { name: "Alice", email: "alice@example.com", role: "user" as const },
  { name: "Bob", email: "bob@example.com", role: "user" as const },
];

for (const user of seedUsers) {
  const existing = await db.select().from(users).where(eq(users.email, user.email)).limit(1);
  if (existing.length === 0) {
    await db.insert(users).values(user);
    console.log(`  Created: ${user.email} (${user.role})`);
  } else {
    console.log(`  Skipped: ${user.email} (already exists)`);
  }
}
```

**Rules for dev seed data:**
- Always idempotent — check before inserting, skip if exists
- Use obvious fake data (`admin@example.com`, not real email addresses)
- Include at least one of each role (admin, user) so you can test permission flows
- Log what was created vs skipped so you can tell what happened

### Adding seed data for a new entity

When you add a new table, add seed data in the same script. Import the new table and add a block below the existing seeds:

```typescript
// packages/api/src/db/seed.ts — add after the users block
import { posts } from "./schema.js";

const seedPosts = [
  { title: "Welcome", body: "First post.", authorEmail: "admin@example.com" },
  { title: "Getting Started", body: "How to use the app.", authorEmail: "alice@example.com" },
];

for (const post of seedPosts) {
  const existing = await db.select().from(posts).where(eq(posts.title, post.title)).limit(1);
  if (existing.length === 0) {
    await db.insert(posts).values(post);
    console.log(`  Created post: ${post.title}`);
  } else {
    console.log(`  Skipped post: ${post.title} (already exists)`);
  }
}
```

**Ordering matters** when entities have foreign keys. Seed parents before children. If posts reference users by ID, you need to look up the user after inserting them:

```typescript
// Seed users first (already above)...

// Then seed posts, looking up the author
const adminUser = await db.select().from(users).where(eq(users.email, "admin@example.com")).limit(1);
if (adminUser.length > 0) {
  const seedPosts = [
    { title: "Welcome", body: "First post.", userId: adminUser[0].id },
  ];

  for (const post of seedPosts) {
    const existing = await db.select().from(posts).where(eq(posts.title, post.title)).limit(1);
    if (existing.length === 0) {
      await db.insert(posts).values(post);
      console.log(`  Created post: ${post.title}`);
    }
  }
}
```

### Reference data (needed in all environments)

Some data isn't "fake" — it's required for the app to function. Examples: role definitions, status enums stored in a lookup table, default configuration records, system accounts. This data needs to exist in production too, not just development.

**Don't put reference data in `seed.ts`.** The seed script is a development tool — it's never run in production. Instead, put reference data in a migration so it's applied automatically everywhere.

Create the migration by hand (Drizzle Kit only generates DDL, not DML):

```bash
# Create the migration file manually
touch packages/api/drizzle/0002_seed_roles.sql
```

```sql
-- packages/api/drizzle/0002_seed_roles.sql
-- Reference data: roles lookup table
INSERT INTO roles (name, description) VALUES ('user', 'Standard user')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO roles (name, description) VALUES ('admin', 'Administrator')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO roles (name, description) VALUES ('moderator', 'Content moderator')
  ON CONFLICT (name) DO NOTHING;
```

**Important:** If you create a migration file by hand, you also need to update the Drizzle meta journal so it knows about the file. The easiest way: run `pnpm db:generate` after creating the file (even if there are no schema changes — it will pick up the new file), or add the entry to `drizzle/meta/_journal.json` manually.

Alternatively, keep reference data in the seed script but run `pnpm db:seed` as part of your deploy process (see "Production" below).

### When to use which approach

| Data type | Where it lives | When it runs |
|---|---|---|
| Fake users, sample posts | `seed.ts` | `pnpm db:seed` (manual, dev only) |
| Lookup table rows (roles, statuses) | SQL migration or `seed.ts` with production flag | Automatically on deploy or as part of deploy script |
| One-time data transforms | Custom SQL migration | Automatically on deploy |

---

## How It Works in Each Environment

### Local development

```bash
# First time setup
pnpm docker:init    # starts Postgres, generates + applies migrations

# After pulling changes that include new migrations
pnpm db:migrate     # applies any pending migrations

# After adding seed data
pnpm db:seed        # populates tables with dev data

# Nuclear reset (wipes everything)
pnpm docker:reset   # removes Postgres data volume, restarts container
pnpm db:migrate     # re-apply all migrations from scratch
pnpm db:seed        # re-seed
```

`docker:init` is shorthand for `docker compose up -d && sleep 2 && pnpm db:generate && pnpm db:migrate`. It starts Postgres, waits for it to be ready, then runs `db:generate` to create SQL migration files from the current TypeScript schema (so the `drizzle/` directory is populated even on a fresh clone), followed by `db:migrate` to apply those migrations to the database. Seeding is separate because not everyone wants it on every reset.

### CI (pull requests)

CI currently runs `pnpm build && pnpm typecheck && pnpm test`. It does **not** run migrations because there's no Postgres instance in the CI environment. Tests mock the database layer.

If you add integration tests that need a real database, you'd need to:
1. Add a Postgres service to the CI workflow
2. Run `pnpm db:migrate` before tests
3. Optionally run `pnpm db:seed` if tests depend on seed data

### Production (K8s on homebase)

Currently, migrations are **not** automatically applied during deploy. The deploy workflow builds a Docker image and rolls out the K8s deployment, but the API container just runs `node dist/index.js` — it doesn't run migrations first.

The migration files are included in the Docker image (`COPY --from=build /app/packages/api/drizzle packages/api/drizzle/`), so the container has everything it needs. There are several ways to trigger them.

#### Option A: Init container (recommended)

Add a Kubernetes init container that runs migrations before the API starts. This is the safest approach — if the migration fails, the pod never starts and the old version keeps running.

```yaml
# .k8s/api-deployment.yml — add to initContainers (after wait-for-postgres)
- name: run-migrations
  image: <IMAGE_NAME>
  command: ['node', 'dist/db/migrate.js']
  envFrom:
    - secretRef:
        name: <REPO_NAME>-secret
  workingDir: /app/packages/api
```

This requires that `migrate.ts` is compiled to `dist/db/migrate.js` during the Docker build. Check that it's included in the TypeScript build output.

#### Option B: Run at app startup

Import and run migrations at the top of `src/index.ts` before the server starts listening:

```typescript
// packages/api/src/index.ts — add before initJobs
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./db/index.js";

async function start() {
  // Run pending migrations
  await migrate(db, { migrationsFolder: "./drizzle" });
  logger.info("Migrations applied");

  await initJobs(connectionString);
  server.listen(env.PORT, () => { ... });
}
```

Simpler than an init container but riskier: if migrations fail, the app crashes and K8s restarts it in a loop. Also, if you're running multiple replicas, they all try to migrate at once (Drizzle uses a lock table to prevent conflicts, but it's still noisy).

#### Option C: Manual step in the deploy workflow

Add a step to `deploy-api.yml` that runs migrations via `kubectl exec` or a one-off Job before the rollout:

```yaml
- name: Run migrations
  run: |
    kubectl run ${{ env.REPO_NAME }}-migrate \
      --image=${{ env.REPO_NAME }}-api:${{ env.GIT_SHA }} \
      --restart=Never \
      --env-from=secret/${{ env.REPO_NAME }}-secret \
      --command -- node packages/api/dist/db/migrate.js
    kubectl wait --for=condition=complete job/${{ env.REPO_NAME }}-migrate --timeout=60s
    kubectl delete pod ${{ env.REPO_NAME }}-migrate
```

Most control but most ceremony. Good if you want to gate deploys on migration success.

#### Running seed data in production

If you have reference data in `seed.ts` that needs to exist in production, add a similar step after migrations. But be careful: the seed script should only insert reference data, not fake development users. Guard it with an environment check:

```typescript
// packages/api/src/db/seed.ts
const isProd = process.env.NODE_ENV === "production";

// Always seed reference data (lookup tables, system config)
await seedRoles(db);
await seedDefaultSettings(db);

// Only seed fake data in development
if (!isProd) {
  await seedDevUsers(db);
  await seedSamplePosts(db);
}
```

---

## Data Migrations (Backfilling Existing Rows)

Sometimes a schema change requires updating existing data — not just adding a column but filling it in. Drizzle Kit generates the DDL (ALTER TABLE) but not the DML (UPDATE).

### Example: Adding a required column with data

You want to add a `displayName` column to `users` that's NOT NULL, derived from the existing `name` column.

**Step 1:** Add the column as nullable first:

```typescript
// schema.ts
displayName: varchar("display_name", { length: 255 }),  // nullable for now
```

```bash
pnpm db:generate   # generates: ALTER TABLE "users" ADD COLUMN "display_name" varchar(255);
pnpm db:migrate
```

**Step 2:** Create a manual SQL migration to backfill:

Add a new SQL file to `packages/api/drizzle/` (increment the number from the last generated file):

```sql
-- packages/api/drizzle/0002_backfill_display_name.sql
UPDATE users SET display_name = name WHERE display_name IS NULL;
ALTER TABLE users ALTER COLUMN display_name SET NOT NULL;
```

**Step 3:** Apply and update the schema:

```bash
pnpm db:migrate    # runs the backfill + adds NOT NULL constraint
```

Then update `schema.ts` to reflect the column is now NOT NULL:

```typescript
displayName: varchar("display_name", { length: 255 }).notNull(),
```

Run `pnpm db:generate` to sync Drizzle's snapshot (it should generate an empty migration since the DB already matches).

### Why two steps?

You can't add a NOT NULL column without a default to a table that has existing rows — Postgres rejects it. The two-step approach (add nullable → backfill → set NOT NULL) works with any amount of existing data.

---

## Handling Destructive Changes

Some schema changes destroy data. Drizzle Kit will generate the SQL, but it won't warn you.

### Dropping a column

```sql
ALTER TABLE "users" DROP COLUMN "avatar_url";
```

Data in that column is gone. If you might need it later, rename instead of drop:

```typescript
// schema.ts — rename instead of removing
avatarUrl_deprecated: varchar("avatar_url_deprecated", { length: 500 }),
```

Then remove it in a later migration after you've confirmed no code reads it.

### Changing a column type

```sql
ALTER TABLE "users" ALTER COLUMN "role" TYPE integer USING role::integer;
```

This can fail if existing data can't be cast. Test the migration against a copy of production data first.

### Renaming a table or column

Drizzle Kit may interpret a rename as a drop + create. Check the generated SQL. If it drops and recreates instead of renaming, write the migration by hand:

```sql
ALTER TABLE "old_name" RENAME TO "new_name";
-- or
ALTER TABLE "users" RENAME COLUMN "old_col" TO "new_col";
```

---

## Resetting Everything

### Local: full reset

```bash
pnpm docker:reset    # wipes Postgres data volume, restarts container
pnpm db:migrate      # re-apply all migrations
pnpm db:seed         # re-seed dev data
```

### Local: re-seed without resetting

```bash
pnpm db:seed         # idempotent — skips existing records
```

### Inspecting the database

```bash
pnpm db:studio       # opens Drizzle Studio in the browser
```

Or query the migration table directly to see what's been applied:

```sql
SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at;
```

---

## Troubleshooting

- **"relation does not exist"** — Migrations haven't been applied. Run `pnpm db:migrate`.
- **"column already exists"** — You're trying to re-apply a migration. Check `drizzle.__drizzle_migrations` — if the migration is listed but the column doesn't exist, the migration table is out of sync. Easiest fix: `pnpm docker:reset`.
- **`pnpm db:generate` produces nothing** — Your schema matches the last snapshot. If you edited a migration file manually, Drizzle Kit doesn't know about it. Only edit `schema.ts`, never the generated SQL (except for data migrations).
- **New NOT NULL column fails on existing data** — Add it as nullable first, backfill, then set NOT NULL (see data migrations above).
- **Migration works locally, fails in production** — Your local database might have different data. Test migrations against a copy of production data when possible. For destructive changes, always do a two-step deploy: first deploy the code that stops using the column, then deploy the migration that removes it.
- **Drizzle meta out of sync** — If you manually added SQL files, the `_journal.json` may not include them. Run `pnpm db:generate` to re-sync, or add the entry to the journal manually.
- **pg-boss tables missing after reset** — pg-boss auto-creates its `pgboss` schema on `boss.start()`. After a database reset, restart the API and it will recreate them.

---

## Checklist

**Schema change**
- [ ] Edit `schema.ts` with the change
- [ ] `pnpm db:generate` — review the generated SQL
- [ ] `pnpm db:migrate` — apply locally
- [ ] Update Zod schemas in `packages/shared` if the change is visible to clients
- [ ] Commit the migration files (`packages/api/drizzle/`)

**Seed data**
- [ ] Dev seed data added to `seed.ts` (idempotent, check-before-insert)
- [ ] Foreign key dependencies seeded in order (parents before children)
- [ ] Reference data either in a SQL migration or guarded with `NODE_ENV` check in seed script

**Production readiness**
- [ ] Migration tested against realistic data (not just an empty database)
- [ ] Destructive changes split into two deploys (remove code usage first, then remove column)
- [ ] Data migration backfills existing rows before adding NOT NULL constraints
- [ ] Migration strategy chosen for deploy (init container, app startup, or workflow step)

---

## Related

- [Adding a New Entity](./adding-entities.md) — Full walkthrough that includes the migration step in context
- [Adding Sub-Entities](./adding-sub-entities.md) — Foreign keys and `onDelete` behavior
- [Database](./database.md) — Drizzle queries, connection, and Drizzle Studio
- [CI/CD](./ci-cd.md) — Deploy workflows and how to add migration steps
