# trpc-template

Full-stack TypeScript monorepo template for personal projects, designed to go from `init.sh` to deployed on a self-hosted Kubernetes cluster in one push.

## Stack

- **API**: tRPC + Express, Drizzle ORM (PostgreSQL), Auth0 JWT validation
- **Web**: Vue 3 + Vite, tRPC client (end-to-end type safety), Auth0 SPA SDK
- **Shared**: Zod schemas used by both API and Web (single source of truth for types)
- **Infra**: Docker, Kubernetes (self-hosted Mac mini), GitHub Actions CI/CD

## How It Works

```
packages/
  shared/    Zod schemas -> exported types used everywhere
  api/       tRPC backend -> consumes schemas as .input() validators
  web/       Vue frontend -> gets full type inference via AppRouter type
```

Types flow from shared Zod schemas through tRPC procedures to the frontend with zero codegen. Change a schema and TypeScript catches mismatches everywhere.

## Creating a New Project

```bash
gh repo create tylersmith-art/my-app --template tylersmith-art/trpc-template --clone --private
cd my-app
./scripts/init.sh my-app
```

The init script handles everything:
1. Replaces `@template/` placeholders with `@my-app/` across all source files, Dockerfiles, and manifests
2. Generates a strong database password
3. Creates `.env` files (local dev + deployment)
4. SCPs deployment env files to the self-hosted runner (`homebase.local`)
5. Adds the project domain to the shared Auth0 SPA allowed URLs
6. Creates a GoDaddy DNS A record for `my-app.tylermakes.art`
7. Adds a `template` git remote for pulling future updates

Then start locally:

```bash
docker compose up -d     # PostgreSQL
pnpm install
pnpm db:generate         # Generate migration files from schema
pnpm db:migrate          # Apply migrations
pnpm dev                 # API on :3001, Web on :3000
```

## Deployment

Push to `main` and three GitHub Actions workflows handle the rest:

| Workflow | Triggers on | What it does |
|----------|------------|--------------|
| `deploy-infra` | `.k8s/**` | Creates postgres secret, deploys PostgreSQL |
| `deploy-api` | `packages/api/**`, `packages/shared/**` | Builds API image, creates API secret, deploys API |
| `deploy-web` | `packages/web/**`, `packages/shared/**` | Builds web image with VITE_ env vars baked in, deploys web |

The API deployment includes an init container that waits for PostgreSQL to be ready before starting, so the first deploy works without crash loops.

All workflows run on a self-hosted GitHub Actions runner on the Mac mini. Docker images are built locally (no registry), and Kubernetes pulls them with `imagePullPolicy: Never`.

## Push Notifications

The template includes a complete notification system: mobile push (via Expo), in-app toasts, and a paginated notification history view in both web and mobile.

**Without any setup**, notifications work in development mode — the console adapter logs push events and in-app toasts + notification history work fully via real-time sync.

**To enable real push delivery**, the first time you run init.sh it will prompt for shared push credentials (Expo token, APNs key). These are saved alongside your Auth0 and GoDaddy credentials and reused for all future projects.

Only `google-services.json` is per-app — pass it per project:

```bash
./scripts/init.sh my-app --google-services-path "/path/to/google-services.json"
```

Prerequisites (one-time):
1. An **Apple Developer Account** with an APNs key (.p8 file)
2. A **Google Firebase project** with `google-services.json` (per-app)
3. An **Expo account** with an access token

When push credentials aren't configured, init.sh skips gracefully — the console adapter logs notifications and in-app toasts still work. See [`.praxis/features/notifications.md`](.praxis/features/notifications.md) for the full guide.

## Pulling Template Updates

```bash
git fetch template
git merge template/main
```

## Full Setup Guide

See [SETUP.md](SETUP.md) for detailed instructions including Auth0, GoDaddy, and server configuration.
