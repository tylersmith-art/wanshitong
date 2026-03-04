# Environment Validation

All required env vars are validated at startup with Zod before anything else runs. If a variable is missing or invalid, the server prints field-level errors and exits immediately.

## What's Validated

```typescript
// packages/api/src/lib/env.ts
const envSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
  AUTH0_ISSUER_BASE_URL: z.string().url("AUTH0_ISSUER_BASE_URL must be a valid URL"),
  AUTH0_AUDIENCE: z.string().url("AUTH0_AUDIENCE must be a valid URL"),
  PORT: z.string().default("3001"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  RATE_LIMIT_MAX: z.string().default("100"),
  NODE_ENV: z.string().default("development"),
  LOG_LEVEL: z.string().default("info"),
});
```

Called at the very top of `api/src/index.ts`, before any other imports:

```typescript
import "dotenv/config";
import { validateEnv } from "./lib/env.js";
const env = validateEnv();
// everything else uses env.PORT, env.CORS_ORIGIN, etc.
```

On failure, you get clear output:

```
Environment validation failed:
  DATABASE_URL: DATABASE_URL must be a valid URL
  AUTH0_ISSUER_BASE_URL: Required
```

## How to Implement

### Add a new env var

```typescript
// packages/api/src/lib/env.ts
const envSchema = z.object({
  // ...existing vars...
  STRIPE_SECRET_KEY: z.string().min(1, "STRIPE_SECRET_KEY is required"),
  SENDGRID_API_KEY: z.string().optional(),  // optional — won't block startup
});
```

Then use it anywhere in the API:

```typescript
import { getEnv } from "../lib/env.js";

const env = getEnv();
const stripe = new Stripe(env.STRIPE_SECRET_KEY);
```

### Add it to your .env

```
STRIPE_SECRET_KEY=sk_test_...
```

### Add it to K8s secrets

Update your env file at `/Users/tylersmith/envs/<repo-name>.env` and redeploy.

## How to Test

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateEnv } from "./env.js";

describe("validateEnv", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns parsed env for valid input", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db");
    vi.stubEnv("AUTH0_ISSUER_BASE_URL", "https://example.auth0.com");
    vi.stubEnv("AUTH0_AUDIENCE", "https://api.example.com");

    const env = validateEnv();
    expect(env.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/db");
    expect(env.PORT).toBe("3001");          // default
    expect(env.CORS_ORIGIN).toBe("http://localhost:3000");  // default
  });

  it("exits on missing required vars", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AUTH0_ISSUER_BASE_URL", "");
    vi.stubEnv("AUTH0_AUDIENCE", "");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => validateEnv()).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
```

Key pattern: mock `process.exit` to throw (so the test doesn't actually exit), then assert it was called with `1`.

## How to Debug

- **Server exits immediately on startup?** Check the console output for "Environment validation failed" and the specific field errors. Most common: missing `.env` file or a var not set.
- **"validateEnv() must be called first" error?** Something is calling `getEnv()` before `validateEnv()` runs. Make sure `validateEnv()` is the first thing in `index.ts` after `dotenv/config`.
- **Valid URL but still failing?** Zod's `z.string().url()` requires a full URL with protocol. `example.com` fails — it needs `https://example.com`.
- **Different behavior locally vs production?** Check that your K8s secret has all required vars. Use `kubectl get secret <name> -o jsonpath='{.data}'` and base64-decode to inspect.
