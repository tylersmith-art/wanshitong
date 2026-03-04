# Features

Catalog of every pattern and system in this project. Read the description and "use when" to find the right page for your task, then follow the detailed guide for implementation, testing, and debugging.

---

### [Coding Guidelines](./coding-guidelines.md)
How code should be written in this project. Functional-first (functions and factory closures, not classes), Zod schemas as the single source of truth for types, named exports, result objects over thrown errors, configuration via injection not globals. Covers naming conventions, file organization, error handling patterns, and anti-patterns to avoid.

**Use when:** Writing any new code or reviewing existing code. Also reference when deciding between a class vs a factory function, `type` vs `interface`, or where to put error handling logic.

---

### [Error Handling](./error-handling.md)
How errors are thrown, caught, and displayed across the three layers: Zod input validation (automatic `BAD_REQUEST`), tRPC procedure errors (`TRPCError` with codes like `NOT_FOUND`, `FORBIDDEN`), and client-side React Query handling. Covers which error code to use when, result objects for internal functions, never leaking internals, and client-side patterns for displaying errors and reacting to specific codes.

**Use when:** Throwing an error from a procedure, handling errors in a React component, deciding between `FORBIDDEN` vs `UNAUTHORIZED` vs `NOT_FOUND`, or figuring out how an external service failure should surface to the user.

---

### [Adding a Monorepo Package](./adding-packages.md)
How to add a new package to the pnpm workspace — a shared library, a background worker, a CLI tool. Covers package.json setup (`type: module`, `exports`, `workspace:*`), TypeScript project references (`composite`, `references`), turbo pipeline ordering, barrel exports, and deploy workflow path filters.

**Use when:** Creating a new `packages/` directory for shared utilities, a background worker, a second API, or any new standalone unit. Also reference when connecting an existing package to a new one (adding cross-package imports).

---

### [Project Setup](./project-setup.md)
The one-button setup principle: `./scripts/init.sh <project-name>` takes a fresh template clone to a fully deployed application. Covers what each of the 10 steps does, when to update the script (new env vars, new external services, new deploy targets), and the design goal that no manual configuration should be required.

**Use when:** Initializing a new project from the template, or when adding a feature that requires new configuration (env vars, credentials, DNS, ingress rules) — any configuration the app needs to work must be added to init.sh.

---

### [Adding a New Entity](./adding-entities.md)
End-to-end walkthrough for adding a new data entity (e.g., posts, comments, invoices). Covers every layer: Zod schemas, Drizzle table, tRPC router with real-time sync, client hook, frontend view, role-based access control, and tests. Includes a completion checklist.

**Use when:** Adding any new "thing" to the app that needs a database table, API endpoints, and a UI. This is the most common workflow — start here and it references the specific feature pages for deeper context.

---

### [Adding Sub-Entities](./adding-sub-entities.md)
How to add data that belongs to an existing entity — comments on a post, tasks in a project, notes on a user. Covers foreign keys with `onDelete` behavior, parent-scoped queries, join queries (counts, nested data), cascading delete handling, parent-scoped client hooks with filtered sync events, and the many-to-many join table pattern.

**Use when:** An entity already exists and you need to add children that belong to it. The parent has a table and router; you're adding a new table with a foreign key pointing back to it. Also covers the decisions around joins, nested responses, and what to publish for real-time sync when parent-child data changes.

---

### [Adding an External Service](./adding-external-services.md)
Adapter pattern for integrating any third-party service (email, payments, storage, SMS, AI). Defines a TypeScript type, builds a dev/console implementation and a real provider implementation, and wires them through a factory that reads config from env vars, the database, or runtime parameters. Providers can be swapped with one new file and one env var change.

**Use when:** Integrating any external API or SaaS product — sending emails, processing payments, uploading files, sending SMS, calling an LLM, or indexing into a search engine. Also use when you need to swap providers or support multiple providers for the same capability.

---

### [Adding a Scheduled Job](./adding-scheduled-jobs.md)
How to add recurring work that runs on a cron schedule — daily emails, hourly syncs, nightly cleanup. Uses pg-boss's built-in cron scheduler with no extra infrastructure. Covers cron expressions, timezone handling, idempotency patterns, retry/dead-letter configuration, monitoring that jobs actually ran, cleanup of accumulated data, and removing old schedules.

**Use when:** You need work to happen automatically on a recurring basis — daily reports, periodic data syncs, expiring stale records, health-checking external APIs, or cleaning up temporary data. Builds on the one-off background jobs pattern.

---

### [Migrations and Seeding](../.plan/migrations-and-seeding.md) *(planned — not yet implemented)*
How to change the database schema, apply changes across environments, and populate tables with the data they need. Covers the full Drizzle migration workflow (generate → review → apply → commit), dev seed data vs production reference data, data migrations for backfilling existing rows, destructive change handling, and three strategies for running migrations in production (K8s init container, app startup, or deploy workflow step).

**Use when:** You've added or changed a table and need to get those changes into every environment. Also covers seeding new entities with development data, inserting reference/lookup data that production needs, and recovering from migration issues.

---

### [Adding Middleware](./adding-middleware.md)
How to add cross-cutting behavior that runs across many requests or procedures. Covers the two middleware systems — Express (HTTP-level: headers, IP, rate limiting) and tRPC (procedure-level: auth, roles, audit logging, input transforms) — when to use which, how to create reusable procedure types, and how to compose and test both kinds.

**Use when:** You need logic that applies across multiple endpoints — audit logging, ownership checks, input normalization, request ID tracking, timing, error wrapping, or custom rate limiting. Also use when deciding whether a concern belongs at the HTTP layer or the procedure layer.

---

### [tRPC (End-to-End Type Safety)](./trpc.md)
Zod schemas defined once in `packages/shared` flow through tRPC routers to React Query hooks with zero codegen. Three procedure types: `publicProcedure`, `protectedProcedure` (JWT required), `adminProcedure` (role check).

**Use when:** Adding any API endpoint, modifying request/response shapes, creating a new router, or connecting a new client-side query or mutation.

---

### [Real-Time Sync](./realtime-sync.md)
Postgres LISTEN/NOTIFY broadcasts data changes through tRPC WebSocket subscriptions. Mutations publish `SyncEvent`s, subscriptions yield them to all connected clients, and client hooks update the React Query cache optimistically.

**Use when:** Building a feature where multiple users need to see each other's changes in real time — collaborative lists, live dashboards, activity feeds, or any entity that should sync across browser tabs or devices without polling.

---

### [Authentication](./authentication.md)
Auth0 integrated on web (`@auth0/auth0-react`), mobile (`expo-auth-session` with PKCE + SecureStore), and API (`jose` JWKS verification). Tokens are attached to tRPC calls automatically. The verified JWT payload is available as `ctx.user` in every procedure.

**Use when:** Adding a login/logout flow, protecting a page or API endpoint, reading the current user's identity (email, sub, name), or changing how tokens are managed.

---

### [Roles & Permissions](./roles-permissions.md)
Two roles (`user`, `admin`) stored on the `users` table. `protectedProcedure` resolves the DB user from the JWT `sub` claim; `adminProcedure` checks `ctx.dbUser.role`. First admin is claimed via a self-service mutation; subsequent roles managed through an admin panel.

**Use when:** Restricting an endpoint to certain users, adding a new role (e.g., moderator), building admin-only pages, or implementing any authorization logic beyond "is logged in."

---

### [Rate Limiting](./rate-limiting.md)
Express middleware (`express-rate-limit`) applied globally at 100 req/15min per IP. A stricter 20 req/15min limiter is available for sensitive endpoints. Configurable via `RATE_LIMIT_MAX` env var. Standard `RateLimit-*` headers on every response.

**Use when:** Adding a sensitive endpoint that needs tighter throttling (login attempts, password resets, file uploads), adjusting global limits, or adding per-user rate limiting.

---

### [Environment Validation](./env-validation.md)
Zod schema validates all required env vars (`DATABASE_URL`, `AUTH0_ISSUER_BASE_URL`, `AUTH0_AUDIENCE`) at startup before anything else runs. Prints clear per-field errors and exits on failure. `getEnv()` provides type-safe access to validated values.

**Use when:** Adding a new env var (API key, feature flag, external service URL), changing defaults, or diagnosing startup crashes from misconfiguration.

---

### [Structured Logging](./logging.md)
Pino logger with pretty-printed output in development and JSON lines in production. `pino-http` middleware logs every request with status-based log levels (5xx=error, 4xx=warn). Health checks excluded.

**Use when:** Adding log statements to new code, changing log levels, filtering log output, or integrating with a log aggregator (Datadog, Loki, CloudWatch).

---

### [Background Jobs](./background-jobs.md)
pg-boss job queue backed by the existing Postgres database. Jobs are persistent, survive restarts, and support scheduling, retries, and concurrency. Handlers registered at startup. `enqueueJob()` dispatches from anywhere in the API.

**Use when:** Building anything that shouldn't block a request — sending emails, processing uploads, generating reports, syncing with external APIs, or running scheduled tasks.

---

### [Notifications](./notifications.md)
Push notifications (mobile via Expo), in-app toasts (web + mobile via real-time sync), and a paginated notification history view. One `sendNotification()` call persists to DB, publishes a real-time sync event, and fires mobile push. Includes per-user push opt-out, a welcome notification example, and init.sh integration for push credentials.

**Use when:** Sending notifications to users from any server-side code (tRPC procedures, background jobs). Adding new notification types. Configuring push credentials for a new project. Building notification-related UI.

---

### [Database](./database.md)
Drizzle ORM with PostgreSQL. Typed schema in `packages/api/src/db/schema.ts`, automatic migration generation, and a seed script for development data. Accessed via `ctx.db` in all tRPC procedures.

**Use when:** Adding a table, adding a column, writing queries, changing relationships, seeding data, or debugging schema drift.

---

### [Testing](./testing.md)
Vitest for `api` and `shared` packages. Tests colocated with source code (`*.test.ts`). Established patterns for schema validation tests, router tests (via `createCaller()` with mocked db/pubsub), and middleware tests (mocked `jose`, `vi.hoisted()` for env vars).

**Use when:** Writing tests for a new feature, understanding how to mock the database or auth layer, adding test coverage, or debugging test failures.

---

### [CI/CD](./ci-cd.md)
GitHub Actions CI runs build + typecheck + test on every PR to `main`. Three deploy workflows trigger on push to `main` with path filters: `deploy-api.yml` (Docker + K8s), `deploy-web.yml` (Docker + K8s), `deploy-infra.yml` (K8s). All on a self-hosted runner.

**Use when:** Adding a CI step (lint, e2e tests), creating a deploy workflow for a new package, debugging failed deployments, or understanding the deploy pipeline.

---

### [Web App](./web-app.md)
React 19 SPA built with Vite + TailwindCSS v4. React Router v7 for navigation. `AuthGuard` component protects routes. tRPC hooks from `@wanshitong/hooks` for all data fetching. Views: Home, Users, Profile, Admin.

**Use when:** Adding a page, adding a nav link, building a form that calls the API, protecting a route behind auth, or styling with Tailwind.

---

### [Mobile App](./mobile-app.md)
Expo Router (React Native) with tab navigation. Auth0 via `expo-auth-session` with SecureStore tokens. Shares the same `@wanshitong/hooks` tRPC hooks as web. Scaffolds for push notifications, calendar access, and file downloads.

**Use when:** Adding a mobile screen, integrating a native API (camera, location, contacts), setting up push notifications, or debugging auth/token issues on device.

---

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Starts all packages in watch mode |
| `pnpm build` | Builds everything |
| `pnpm test` | Runs all tests |
| `pnpm typecheck` | Type-checks all packages (no emit) |
| `pnpm docker:init` | Starts Postgres + runs migrations |
| `pnpm docker:reset` | Wipes Postgres data and restarts |
| `pnpm db:generate` | Generates a Drizzle migration from schema changes |
| `pnpm db:migrate` | Applies pending migrations |
| `pnpm db:seed` | Seeds the database with example data |
| `pnpm db:studio` | Opens Drizzle Studio |
