# Setup Guide

Full-stack TypeScript template: **tRPC + Vue 3 + Drizzle ORM + Auth0**

## Prerequisites

Install these before your first project:

| Tool | Install | Verify |
|------|---------|--------|
| Node.js 20+ | https://nodejs.org | `node --version` |
| pnpm | `corepack enable` | `pnpm --version` |
| Docker Desktop | https://docker.com/products/docker-desktop | `docker --version` |
| GitHub CLI | `brew install gh` | `gh auth status` |
| Auth0 CLI | `brew install auth0-cli` | `auth0 tenants list` |

---

## First-Time Setup: External Services

The `init.sh` script will prompt for these credentials on first run and save them for all future projects. Here's where to find each one.

### Auth0 (Authentication)

You need **one shared SPA application** that all projects use.

1. **Sign up / Log in** at https://manage.auth0.com
2. **Find your Auth0 Domain:**
   - It's shown in the top-left of the Auth0 Dashboard
   - Or go to **Settings** (gear icon, bottom-left) → **General** → **Tenant Details**
   - Format: `dev-xxxxxxxx.us.auth0.com`
3. **Create a shared SPA Application** (only once):
   - Go to **Applications** → **Applications** → **+ Create Application**
   - Name: `shared-spa` (or any name)
   - Type: **Single Page Web Applications**
   - Click **Create**
   - On the **Settings** tab, find:
     - **Domain** → this is your `Auth0 Domain`
     - **Client ID** → this is your `Auth0 SPA Client ID`
   - Leave Allowed URLs blank for now — the init script adds them automatically per project
4. **Create an API** (only once):
   - Go to **Applications** → **APIs** → **+ Create API**
   - Name: `shared-api`
   - Identifier: `https://api.tylermakes.art` (this becomes your audience base URL)
   - Click **Create**
5. **Auth0 CLI login** (for the init script to update allowed URLs):
   ```bash
   auth0 login
   ```
   - Select your tenant
   - Authorize in the browser

**What the init script asks:**
| Prompt | Where to find it | Example |
|--------|-----------------|---------|
| Auth0 Domain | Dashboard top-left, or Application Settings → Domain | `dev-ahpx1ju0tyq2wgl7.us.auth0.com` |
| Auth0 SPA Client ID | Applications → your shared app → Settings → Client ID | `zNBGz3tkdnXY1DEJK0NYs6XV8jBIaTjV` |
| Auth0 Audience base URL | APIs → your shared API → Identifier | `https://api.tylermakes.art` |

### GoDaddy (DNS)

The init script creates an A record for `<project>.tylermakes.art` via the GoDaddy API.

1. **Log in** at https://developer.godaddy.com
2. **Create an API Key:**
   - Go to https://developer.godaddy.com/keys
   - Click **Create New API Key**
   - Environment: **Production**
   - Click **Next**
   - You'll see:
     - **Key** → this is your `GoDaddy API Key`
     - **Secret** → this is your `GoDaddy API Secret` (shown only once — copy it now)
3. The secret is stored in **macOS Keychain** (not in plaintext files)

**What the init script asks:**
| Prompt | Where to find it |
|--------|-----------------|
| GoDaddy API Key | https://developer.godaddy.com/keys → your key |
| GoDaddy API Secret | Shown once when you create the key |

### Server IP (DNS Target)

The A record needs to point to your server's public IPv4 address.

- The init script **auto-detects your public IP** and suggests it as the default
- If your server is a different machine (e.g., the Mac mini), enter that IP instead
- You can override per-project with `--ip`: `./scripts/init.sh my-app --ip 203.0.113.50`
- To find your server's public IP, run this on the server: `curl ifconfig.me`

---

## Quick Start

### 1. Create a New Project

```bash
gh repo create tylersmith-art/my-app --template tylersmith-art/trpc-template --clone --private
cd my-app
./scripts/init.sh my-app
```

The init script will:
1. Replace all template placeholders
2. Generate a strong database password
3. Create local `.env` and deployment env files
4. SCP env files to `tylersmith@homebase.local:~/envs/`
5. Add your project domain to the shared Auth0 SPA allowed URLs
6. Create a GoDaddy A record for `my-app.tylermakes.art`
7. Add ingress rules to the `k8s-ingress` repo and push (auto-deploys)
8. Add the template as a git remote for future updates

### 2. Start PostgreSQL

```bash
docker compose up -d
```

### 3. Install & Run

```bash
pnpm install
pnpm db:generate    # Generate migration files from schema
pnpm db:migrate     # Apply migrations to database
pnpm dev            # Start API (:3001) and Web (:3000)
```

Open http://localhost:3000

---

## Project Structure

```
packages/
  shared/    Zod schemas shared by API and Web (source of truth for types)
  api/       tRPC + Express backend, Drizzle ORM, Auth0 JWT validation
  web/       Vue 3 + Vite frontend, tRPC client, Auth0 SPA SDK
```

## How Types Flow

1. Define a **Zod schema** in `packages/shared/src/schemas/`
2. Use it as `.input()` on a **tRPC procedure** in `packages/api/src/routers/`
3. The frontend **automatically gets types** via the `AppRouter` type — full autocomplete, no codegen

---

## Adding a New Feature

### 1. Define the schema

```typescript
// packages/shared/src/schemas/post.ts
import { z } from "zod";

export const CreatePostSchema = z.object({
  title: z.string().min(1),
  content: z.string(),
});

export type CreatePost = z.infer<typeof CreatePostSchema>;
```

Export it from `packages/shared/src/schemas/index.ts` and `packages/shared/src/index.ts`.

### 2. Add the database table

```typescript
// packages/api/src/db/schema.ts
export const posts = pgTable("posts", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

Run `pnpm db:generate` then `pnpm db:migrate`.

### 3. Create the tRPC router

```typescript
// packages/api/src/routers/post.ts
import { CreatePostSchema } from "@wanshitong/shared";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import { posts } from "../db/schema.js";

export const postRouter = router({
  list: publicProcedure.query(({ ctx }) =>
    ctx.db.select().from(posts)
  ),
  create: protectedProcedure
    .input(CreatePostSchema)
    .mutation(({ ctx, input }) =>
      ctx.db.insert(posts).values(input).returning()
    ),
});
```

Add it to `packages/api/src/routers/index.ts`:
```typescript
import { postRouter } from "./post.js";

export const appRouter = router({
  user: userRouter,
  post: postRouter,  // <-- add here
});
```

### 4. Use it in the frontend

```typescript
// In any Vue component
import { trpc } from "../lib/trpc.js";

const posts = await trpc.post.list.query();              // fully typed
await trpc.post.create.mutate({ title: "Hi", content: "..." }); // validated + typed
```

---

## Deployment

### Kubernetes (Self-Hosted)

Each project gets its own PostgreSQL instance with a PersistentVolumeClaim on the Mac mini.

The init script creates all env files automatically. For reference:

**`~/envs/<project>.env`** — API secrets:
- `DATABASE_URL` — points to the K8s postgres service
- `AUTH0_ISSUER_BASE_URL`, `AUTH0_AUDIENCE` — Auth0 config
- `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE` — passed to web build
- `PORT`, `CORS_ORIGIN`

**`~/envs/<project>-postgres.env`** — PostgreSQL container:
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`

### Workflows

| Workflow | Triggers on | Deploys |
|----------|------------|---------|
| `deploy-api.yml` | `packages/api/**`, `packages/shared/**` | API only |
| `deploy-web.yml` | `packages/web/**`, `packages/shared/**` | Web only |
| `deploy-infra.yml` | `.k8s/**` | PostgreSQL only |

### Ingress

Ingress rules are automatically added to the `k8s-ingress` repo by `init.sh`. The script clones the repo, inserts the TLS hostname and routing rules for your project, then pushes to `main` — which triggers a GitHub Actions workflow that runs `kubectl apply`.

---

## Dedicated Auth0 App (Optional)

By default, all projects share one Auth0 SPA application. To give a project its own isolated Auth0 app:

```bash
./scripts/create-auth0-app.sh my-app
```

This creates a dedicated SPA application and API in Auth0 and updates all env files.

---

## Useful Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start API + Web in parallel |
| `pnpm build` | Build all packages |
| `pnpm db:generate` | Generate Drizzle migration from schema changes |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:studio` | Open Drizzle Studio (database GUI) |
| `docker compose up -d` | Start local PostgreSQL |
| `docker compose down` | Stop local PostgreSQL |

## Pulling Template Updates

The init script adds the template as a remote automatically. To pull updates:

```bash
git fetch template
git merge template/main
```

## Resetting First-Time Setup

If you need to re-enter your credentials:

```bash
# Delete saved defaults (Auth0 domain, client ID, server IP)
rm ~/.config/trpc-template/defaults.env

# Delete GoDaddy credentials from Keychain
security delete-generic-password -s trpc-template-godaddy -a api-key
security delete-generic-password -s trpc-template-godaddy -a api-secret
```

Then run `./scripts/init.sh` again and it will re-prompt for everything.
