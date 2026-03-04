# Rate Limiting

Per-IP request throttling using `express-rate-limit`. Applied globally to all Express routes. A stricter limiter is available for sensitive endpoints.

## What's Configured

```typescript
// packages/api/src/middleware/rateLimit.ts
import rateLimit from "express-rate-limit";
import { getEnv } from "../lib/env.js";

let cachedGlobalLimiter: ReturnType<typeof rateLimit> | null = null;

export function getGlobalLimiter() {
  if (!cachedGlobalLimiter) {
    cachedGlobalLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,  // 15 minutes
      max: parseInt(getEnv().RATE_LIMIT_MAX, 10),
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Too many requests, please try again later." },
    });
  }
  return cachedGlobalLimiter;
}

export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});
```

The global limiter is applied in `api/src/index.ts` after CORS:

```typescript
app.use(getGlobalLimiter());
```

Every response includes standard rate limit headers. With `express-rate-limit` v7 and `standardHeaders: true`, the library uses the IETF draft-6 combined `RateLimit` header format. The exact header names depend on the installed version — v7 may send a single `RateLimit` header instead of three separate `RateLimit-*` headers.

## How to Implement

### Apply strict limiting to a specific route

```typescript
// packages/api/src/index.ts
import { strictLimiter } from "./middleware/rateLimit.js";

app.use("/api/trpc/admin.updateRole", strictLimiter);
```

### Create a custom limiter

```typescript
import rateLimit from "express-rate-limit";

export const authLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 5,               // 5 attempts per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts." },
});
```

### Adjust the global limit

Set `RATE_LIMIT_MAX` in your `.env` file:

```
RATE_LIMIT_MAX=200
```

## How to Test

Rate limiting is Express middleware, not tRPC middleware, so it doesn't show up in `createCaller()` tests. Test it with HTTP requests:

```typescript
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { getGlobalLimiter } from "./rateLimit.js";

describe("getGlobalLimiter", () => {
  const app = express();
  app.use(getGlobalLimiter());
  app.get("/test", (_req, res) => res.json({ ok: true }));

  it("includes rate limit headers", async () => {
    const res = await request(app).get("/test");
    expect(res.headers["ratelimit-limit"]).toBeDefined();
    expect(res.headers["ratelimit-remaining"]).toBeDefined();
  });
});
```

Or verify headers manually with curl:

```bash
curl -i http://localhost:3001/api/health
# Look for RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset headers
```

## How to Debug

- **Rate limit headers missing?** Make sure `getGlobalLimiter()` is applied before the tRPC middleware in `index.ts`. Express middleware runs in order.
- **Getting rate limited in development?** Increase `RATE_LIMIT_MAX` in your `.env` or set it to a high value like `10000` for local development.
- **Rate limiting doesn't work behind a proxy?** By default, `express-rate-limit` uses `req.ip`. If behind nginx or a load balancer, set `app.set('trust proxy', 1)` in `index.ts` so it reads `X-Forwarded-For`.
- **429 errors in tests?** Rate limit state persists across requests within the same test process. Create a fresh Express app per test or use a separate limiter instance.
