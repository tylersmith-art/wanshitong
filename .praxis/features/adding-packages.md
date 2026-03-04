# Adding a Monorepo Package

How to add a new package to the monorepo — a shared library, a background worker, an email service, a CLI tool. This covers the pnpm workspace, TypeScript project references, turbo pipeline, and cross-package imports that make it all work.

## How the Monorepo Is Wired

```
pnpm-workspace.yaml     ← declares packages/* as workspaces
tsconfig.base.json      ← shared compiler options (all packages extend this)
turbo.json              ← build pipeline ordering
packages/
  shared/               ← Zod schemas, types, utilities (no runtime deps)
  api/                  ← Express + tRPC server (depends on shared)
  hooks/                ← React Query hooks + tRPC client (depends on shared, api types)
  web/                  ← React SPA (depends on hooks)
  mobile/               ← Expo app (depends on hooks)
```

### How dependencies flow

```
shared  ──→  api
shared  ·⊦→  hooks  ──→  web
api     ·⊦→  hooks  ──→  mobile
shared  ──→  mobile

──→  = runtime dependency (dependencies)
·⊦→  = type-only devDependency (devDependencies)
```

`shared` has no internal dependencies — it's the leaf. Everything else depends on it. `hooks` lists both `shared` and `api` as **devDependencies** — it only uses them for types at build time, not at runtime. `web` and `mobile` depend on `hooks` as a runtime dependency.

> **Client type export.** `api` exposes a `./client` subpath export (`@wanshitong/api/client`) that re-exports `AppRouter` without pulling in the server startup code from `src/index.ts`. `hooks/src/trpc.ts` imports from this subpath instead of reaching into `api` internals. The `./client` entry is defined in `api/package.json` under `exports` and backed by `src/client.ts`, which is a types-only barrel.

### How turbo knows what to build first

```json
// turbo.json
"build": {
  "dependsOn": ["^build"],  // build my dependencies first
  "outputs": ["dist/**"]
}
```

The `^build` means "build all packages I depend on before building me." So `pnpm build` automatically builds `shared` → `hooks` → `web` (and `shared` → `api`). You never need to specify the order manually.

### How TypeScript resolves cross-package imports

Two mechanisms work together:

1. **`workspace:*` in package.json** — pnpm symlinks the package into `node_modules`, so `import { UserSchema } from "@wanshitong/shared"` resolves at runtime.

2. **`references` in tsconfig.json** — TypeScript follows project references for type checking, so you get autocomplete and compile errors across packages.

```json
// packages/api/tsconfig.json
{
  "references": [
    { "path": "../shared" }   // TypeScript knows about shared's types
  ]
}
```

### How barrel exports work

Each package has an `src/index.ts` that re-exports its public API. Consumers import from the package name, never from internal paths:

```typescript
// YES — import from the package
import { UserSchema, type User } from "@wanshitong/shared";

// NO — reaching into internal files
import { UserSchema } from "@wanshitong/shared/src/schemas/user.js";
```

The `exports` field in package.json maps the package name to the built output:

```json
// packages/shared/package.json
"exports": {
  ".": {
    "import": "./dist/index.js",
    "types": "./dist/index.d.ts"
  }
}
```

---

## Adding a New Package

### 1. Create the directory and package.json

```bash
mkdir -p packages/worker/src
```

```json
// packages/worker/package.json
{
  "name": "@wanshitong/worker",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@wanshitong/shared": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

Key details:
- **`"type": "module"`** — all packages use ESM
- **`"private": true`** — monorepo packages aren't published to npm
- **`workspace:*`** — tells pnpm to use the local version of `@wanshitong/shared`
- **`exports`** — required for other packages to import from `@wanshitong/worker`

> **Exception: Expo apps** — The `mobile` package does not follow the standard ESM setup. Expo apps use their own conventions: no `"type": "module"`, no `"exports"` field, no `"build"` script, and `tsconfig.json` extends `expo/tsconfig.base` instead of the monorepo base. This is expected — Expo's toolchain handles bundling and TypeScript differently from Node.js library packages.

### 2. Create tsconfig.json

```json
// packages/worker/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  },
  "include": ["src"],
  "references": [
    { "path": "../shared" }
  ]
}
```

Key details:
- **`extends`** — inherits strict mode, ESM, source maps from `tsconfig.base.json`
- **`composite: true`** — only required for library packages that other packages import from (e.g., `shared`, or a `worker` that `api` imports from). Frontend apps like `web` and `mobile` don't need it since nothing imports from them — `web` correctly omits it.
- **`references`** — list every internal package this one imports from. If you use `@wanshitong/shared`, add `{ "path": "../shared" }`.

### 3. Create the barrel export

```typescript
// packages/worker/src/index.ts
export { processQueue } from "./queue.js";
export type { QueueJob } from "./types.js";
```

Only export what other packages need. Internal implementation stays unexported.

### 4. Add tests (if applicable)

```typescript
// packages/worker/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

### 5. Install dependencies

```bash
pnpm install
```

pnpm automatically picks up the new workspace package. No changes to `pnpm-workspace.yaml` needed — the glob `packages/*` already covers it.

### 6. Verify the build chain

```bash
pnpm build
```

Turbo should build `shared` first (because `worker` depends on it), then `worker`. Check the turbo output to confirm the order is correct.

---

## Package Types and What They Need

Not every package needs the same setup. Here's what differs:

### Library package (shared code, imported by others)

Examples: `shared`, a `utils` package, a `validation` package.

```json
// tsconfig.json — needs composite for project references
"compilerOptions": {
  "composite": true,
  "declaration": true,   // inherited from base, but worth noting
}
```

- **`composite: true`** — required so other packages can reference it
- **`exports` in package.json** — required so imports resolve
- **No `dev` script** — libraries don't run, they're built and imported. Use `"dev": "tsc --watch"` to rebuild on changes.

### Server package (runs as a process)

Examples: `api`, a background `worker`, a `cron` service.

```json
// tsconfig.json — doesn't need composite (nothing imports from it)
"compilerOptions": {
  "outDir": "./dist",
  "rootDir": "./src"
  // no composite, no declaration needed
}
```

> **Exception:** `api` has `composite: true` because it exports types via its `./client` subpath (`@wanshitong/api/client`). If your server package similarly exposes types consumed by other packages, it needs `composite: true` too.

- **`dev` script uses `tsx watch`** — hot-reloads on file changes
- **`start` script uses `node dist/index.js`** — for production
- **Needs its own Dockerfile** if it deploys separately
- **Needs its own deploy workflow** if it deploys separately

### Frontend package (React app)

Examples: `web`, another SPA for a different audience.

```json
// tsconfig.json — needs DOM libs and JSX
"compilerOptions": {
  "jsx": "react-jsx",
  "lib": ["ES2022", "DOM", "DOM.Iterable"]
}
```

- **Built by Vite**, not `tsc` alone — `"build": "tsc --noEmit && vite build"`
- **References hooks and shared directly** (both listed in tsconfig `references`)
- **No `composite: true`** — nothing imports from a frontend app, so it doesn't need to be a project reference target. `web` correctly omits it.
- **Expo is different** — `mobile` does not use Vite, does not extend `tsconfig.base.json`, and does not use `"type": "module"`. Expo's own toolchain handles everything. See the exception note in step 1 above.

---

## Connecting to Other Packages

### Your new package imports from an existing one

1. Add the dependency to package.json:

```json
"dependencies": {
  "@wanshitong/shared": "workspace:*"
}
```

2. Add the reference to tsconfig.json:

```json
"references": [
  { "path": "../shared" }
]
```

3. Run `pnpm install` to wire it up.

### An existing package imports from your new one

1. Add your package as a dependency in the consumer's package.json:

```json
// packages/api/package.json
"dependencies": {
  "@wanshitong/worker": "workspace:*"
}
```

2. Add a reference in the consumer's tsconfig.json:

```json
// packages/api/tsconfig.json
"references": [
  { "path": "../shared" },
  { "path": "../worker" }
]
```

3. Make sure your package has `"composite": true` in tsconfig.json and `"exports"` in package.json.

4. Run `pnpm install`.

---

## Adding a Deploy Workflow

If the package runs as a separate service (not imported by an existing deployed package), it needs its own deploy workflow.

### Path filters

The deploy workflow should trigger when its own files or its dependencies change:

```yaml
on:
  push:
    branches: [main]
    paths:
      - "packages/worker/**"
      - "packages/shared/**"    # if worker depends on shared
```

The existing `deploy-api.yml` triggers on `packages/api/**` and `packages/shared/**`. The existing `deploy-web.yml` triggers on `packages/web/**`, `packages/hooks/**`, and `packages/shared/**`. Follow the same pattern — list your package and everything it imports from.

### CI workflow

The CI workflow (`ci.yml`) runs `pnpm build`, `pnpm typecheck`, and `pnpm test` across the entire monorepo. New packages are automatically included — turbo discovers all workspace packages. No CI changes needed unless you need a custom step.

---

## Turbo Pipeline

The existing `turbo.json` tasks (`build`, `dev`, `test`, `typecheck`) work for any new package automatically, as long as the package.json scripts use the same names.

If your package has a custom script (e.g., `db:generate` for a package with its own database), add it to turbo.json:

```json
// turbo.json
"tasks": {
  "worker:process": {
    "dependsOn": ["^build"],
    "cache": false
  }
}
```

Then run it from the root: `turbo worker:process --filter=@wanshitong/worker`.

---

## Checklist

- [ ] `packages/<name>/package.json` with `name`, `type: module`, `exports`, scripts
- [ ] `packages/<name>/tsconfig.json` extending `../../tsconfig.base.json`
- [ ] `packages/<name>/src/index.ts` barrel export
- [ ] `composite: true` in tsconfig if other packages will import from this one
- [ ] `workspace:*` dependency and tsconfig `references` for each internal package used
- [ ] `pnpm install` run to wire up the workspace
- [ ] `pnpm build` succeeds with correct ordering
- [ ] `pnpm typecheck` passes
- [ ] Tests added with `vitest.config.ts` if applicable
- [ ] Deploy workflow with correct path filters if the package deploys independently
- [ ] `init.sh` updated if the package needs env vars or deployment configuration

---

## Related

- [Coding Guidelines](./coding-guidelines.md) — Naming, exports, file organization
- [CI/CD](./ci-cd.md) — How build + deploy workflows are structured
- [Testing](./testing.md) — Vitest configuration and patterns
- [Environment Validation](./env-validation.md) — Adding env vars to a new server package
