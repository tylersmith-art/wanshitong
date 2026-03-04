# Structured Logging

All API logging uses Pino. Pretty-printed in development, JSON in production. Request logging is automatic.

## Setup

```typescript
// packages/api/src/lib/logger.ts
import pino from "pino";
import { getEnv } from "./env.js";

let cachedLogger: pino.Logger | null = null;

export function getLogger() {
  if (!cachedLogger) {
    const env = getEnv();
    cachedLogger = pino({
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV !== "production" && {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
    });
  }
  return cachedLogger;
}
```

Request logging via pino-http:

```typescript
// packages/api/src/middleware/requestLogger.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import pinoHttp from "pino-http";
import type { HttpLogger } from "pino-http";
import { getLogger } from "../lib/logger.js";

let cachedRequestLogger: HttpLogger | null = null;

export function getRequestLogger(): HttpLogger {
  if (!cachedRequestLogger) {
    cachedRequestLogger = pinoHttp({
      logger: getLogger(),
      customLogLevel(_req: IncomingMessage, res: ServerResponse, err: Error | undefined) {
        if (res.statusCode >= 500 || err) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
      autoLogging: {
        ignore(req: IncomingMessage) {
          return req.url === "/api/health";  // skip health checks
        },
      },
    });
  }
  return cachedRequestLogger;
}
```

## How to Implement

### Use the logger in your code

```typescript
import { getLogger } from "../lib/logger.js";

// Structured data as first arg, message as second
getLogger().info({ userId: "abc", action: "login" }, "User logged in");
getLogger().warn({ attempts: 3 }, "Rate limit approaching");
getLogger().error({ err, requestId }, "Failed to process payment");
```

**Do not use `console.log`** in API code. Use `getLogger()` for consistent structured output.

### Log levels

| Level | When to use |
|---|---|
| `error` | Something broke. Needs attention. |
| `warn` | Unexpected but handled. Worth monitoring. |
| `info` | Normal operations. User actions, lifecycle events. |
| `debug` | Detailed troubleshooting info. Not shown by default. |
| `trace` | Very verbose. Function entry/exit, data dumps. |

### Change log level at runtime

Set `LOG_LEVEL` env var:

```
LOG_LEVEL=debug  # shows debug + info + warn + error
LOG_LEVEL=warn   # shows only warn + error
```

### Child loggers for context

```typescript
const jobLogger = getLogger().child({ module: "jobs", jobType: "email" });
jobLogger.info({ to: "user@test.com" }, "Sending email");
// output includes module and jobType on every line
```

## Development Output

```
[10:32:15.123] INFO: API server listening on http://localhost:3001
[10:32:15.124] INFO: WebSocket server listening on ws://localhost:3001/api/trpc
[10:32:16.456] INFO: POST /api/trpc/user.create 200 12ms
[10:32:17.789] WARN: GET /api/trpc/admin.listUsers 403 3ms
```

## Production Output

```json
{"level":30,"time":1707600735123,"msg":"API server listening on http://localhost:3001"}
{"level":30,"time":1707600736456,"req":{"method":"POST","url":"/api/trpc/user.create"},"res":{"statusCode":200},"responseTime":12,"msg":"request completed"}
```

Pipe to any JSON log aggregator (Datadog, Grafana Loki, CloudWatch, etc.).

## How to Test

Logger output doesn't need to be tested directly. For code that uses the logger, either:

1. Let it log (Vitest captures stdout)
2. Mock it if you want to assert on log calls:

```typescript
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

vi.mock("../lib/logger.js", () => ({
  getLogger: () => mockLogger,
}));

import { getLogger } from "../lib/logger.js";

it("logs job processing", async () => {
  // ... trigger the code ...
  expect(getLogger().info).toHaveBeenCalledWith(
    expect.objectContaining({ jobId: expect.any(String) }),
    "Processing example job",
  );
});
```

## How to Debug

- **No log output?** Check `LOG_LEVEL`. If set to `warn`, `info` messages won't appear. Default is `info`.
- **Logs are JSON in development?** `pino-pretty` is a devDependency. Make sure `NODE_ENV` is not set to `production` in your `.env`. If unset, it defaults to `development`.
- **Request logs show "undefined" for URL?** Make sure `getRequestLogger()` middleware is applied before route handlers in `index.ts`.
- **Health check spam in logs?** The request logger already ignores `/api/health`. If you add other health/readiness endpoints, add them to the `ignore` function in `requestLogger.ts`.
- **Want to see debug logs?** Set `LOG_LEVEL=debug` in your `.env` and restart.
