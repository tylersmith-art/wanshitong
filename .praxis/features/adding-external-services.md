# Adding an External Service

> **Note:** This is a step-by-step guide for future implementation. The example code shown below does not exist in the codebase yet — it is a worked example showing the pattern to follow when adding your first external service.

How to integrate any external service (email, payments, storage, SMS, AI, etc.) using the adapter pattern. The adapter abstracts the provider so business logic never depends on a specific vendor. Providers can be swapped via env vars, database config, or at call time — without changing any calling code.

This guide uses email as the example. The pattern is the same for any external service.

## The Rule

**Every external service gets an adapter.** Even if you're only using one provider today. The adapter is a TypeScript type. Business logic calls the adapter. The adapter calls the provider. This is non-negotiable — it's how you avoid vendor lock-in and keep tests fast.

```
Business logic (routers, jobs)
  → calls adapter interface
    → adapter implementation calls provider SDK (SendGrid, Stripe, S3, etc.)
```

Adapters use factory functions, not classes — see [Coding Guidelines](./coding-guidelines.md) for why.

## Overview of Files You'll Create

```
packages/api/src/services/email/
  types.ts           ← Adapter type + shared types
  index.ts           ← Factory that returns the right implementation
  sendgrid.ts        ← SendGrid implementation
  console.ts         ← Dev/test implementation (logs to console)
  resend.ts          ← (future) Another provider, no other code changes
```

---

## Step 1: Define the Adapter Type

Create the adapter type file. This is the contract. Every implementation must satisfy it. Business logic only imports types and the factory -- never a specific provider.

```typescript
// Create: packages/api/src/services/email/types.ts

export type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
};

export type SendEmailResult = {
  success: boolean;
  messageId?: string;
  error?: string;
};

export type EmailAdapter = {
  send(params: SendEmailParams): Promise<SendEmailResult>;
};
```

**Guidelines for the type:**
- Keep it minimal — only the operations your app actually uses
- Use your own types for params and results, not the provider's types
- The type should make sense if you read it without knowing which provider backs it
- Don't leak provider-specific concepts (e.g., don't put "SendGrid template IDs" in the shared type)

---

## Step 2: Build the Dev/Console Implementation

Create this file first. This implementation logs to the console instead of sending real emails. It's what you use in development and tests.

```typescript
// Create: packages/api/src/services/email/console.ts
import { getLogger } from "../../lib/logger.js";
import type { EmailAdapter } from "./types.js";

export function createConsoleEmailAdapter(): EmailAdapter {
  return {
    async send(params) {
      getLogger().info(
        { to: params.to, subject: params.subject },
        "Email sent (console adapter — not actually delivered)",
      );
      return { success: true, messageId: `console-${Date.now()}` };
    },
  };
}
```

This means you can build and test the entire email flow before you have a provider account or API key.

---

## Step 3: Build the Real Implementation

Create the provider-specific implementation file.

```typescript
// Create: packages/api/src/services/email/sendgrid.ts
import { getLogger } from "../../lib/logger.js";
import type { EmailAdapter } from "./types.js";

export function createSendGridAdapter(config: {
  apiKey: string;
  fromAddress: string;
}): EmailAdapter {
  return {
    async send(params) {
      try {
        const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: params.to }] }],
            from: { email: config.fromAddress },
            subject: params.subject,
            content: [{ type: "text/html", value: params.html }],
            ...(params.replyTo && { reply_to: { email: params.replyTo } }),
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          getLogger().error({ status: response.status, body }, "SendGrid API error");
          return { success: false, error: `SendGrid error: ${response.status}` };
        }

        const messageId = response.headers.get("x-message-id") ?? undefined;
        return { success: true, messageId };
      } catch (err) {
        getLogger().error({ err }, "SendGrid request failed");
        return { success: false, error: (err as Error).message };
      }
    },
  };
}
```

**Key patterns:**
- Factory takes config — never reads env vars directly (the top-level factory does that)
- Returns a result object instead of throwing — let the caller decide how to handle failure
- Logs errors with structured data through Pino
- Uses only `fetch` — no provider SDK required (though you can use one if the API is complex)
- Config is available via closure — no `this`, no private fields

---

## Step 4: Create the Factory

Create the factory file. The factory decides which implementation to use. It reads configuration from env vars, but could also read from the database or accept runtime overrides.

```typescript
// Create: packages/api/src/services/email/index.ts
import { getEnv } from "../../lib/env.js";
import { getLogger } from "../../lib/logger.js";
import type { EmailAdapter } from "./types.js";
import { createConsoleEmailAdapter } from "./console.js";
import { createSendGridAdapter } from "./sendgrid.js";

export type { EmailAdapter, SendEmailParams, SendEmailResult } from "./types.js";

let instance: EmailAdapter | null = null;

export function getEmailAdapter(): EmailAdapter {
  if (instance) return instance;

  const env = getEnv();
  const provider = env.EMAIL_PROVIDER;  // "sendgrid" | "console" | undefined

  switch (provider) {
    case "sendgrid":
      getLogger().info("Email adapter: SendGrid");
      instance = createSendGridAdapter({
        apiKey: env.SENDGRID_API_KEY!,
        fromAddress: env.EMAIL_FROM!,
      });
      break;

    default:
      getLogger().info("Email adapter: console (no EMAIL_PROVIDER set)");
      instance = createConsoleEmailAdapter();
      break;
  }

  return instance;
}

// For tests: override the adapter
export function setEmailAdapter(adapter: EmailAdapter): void {
  instance = adapter;
}

// For tests: reset to force re-initialization
export function resetEmailAdapter(): void {
  instance = null;
}
```

---

## Step 5: Add the Env Vars

Add the following fields to the existing env schema.

```typescript
// Add to: packages/api/src/lib/env.ts — extend the existing schema
const envSchema = z.object({
  // ...existing vars...
  EMAIL_PROVIDER: z.string().optional(),     // "sendgrid", "resend", etc. Falls back to console.
  SENDGRID_API_KEY: z.string().optional(),   // Required when EMAIL_PROVIDER=sendgrid
  EMAIL_FROM: z.string().optional(),         // Required when EMAIL_PROVIDER is set
});
```

Keep provider-specific vars optional at the Zod level. Validate them inside the factory instead — this way the app boots fine in development without email credentials:

```typescript
// In the factory switch case:
case "sendgrid":
  if (!env.SENDGRID_API_KEY || !env.EMAIL_FROM) {
    throw new Error("EMAIL_PROVIDER=sendgrid requires SENDGRID_API_KEY and EMAIL_FROM");
  }
  instance = createSendGridAdapter({ apiKey: env.SENDGRID_API_KEY, fromAddress: env.EMAIL_FROM });
  break;
```

See [Environment Validation](./env-validation.md) for the full env setup.

---

## Step 6: Use the Adapter

### From a tRPC procedure

Add a procedure like this to an existing router.

```typescript
// Add to: packages/api/src/routers/user.ts
import { getEmailAdapter } from "../services/email/index.js";

sendWelcome: protectedProcedure
  .input(z.object({ email: z.string().email() }))
  .mutation(async ({ input }) => {
    const email = getEmailAdapter();
    const result = await email.send({
      to: input.email,
      subject: "Welcome!",
      html: "<h1>Welcome to the app</h1>",
    });

    if (!result.success) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to send email" });
    }

    return { messageId: result.messageId };
  }),
```

### From a background job (recommended for non-blocking sends)

Create a job handler file for the email send.

```typescript
// Create: packages/api/src/jobs/handlers/sendWelcomeEmail.ts
import type PgBoss from "pg-boss";
import { getLogger } from "../../lib/logger.js";
import { getEmailAdapter } from "../../services/email/index.js";

export const SEND_WELCOME_EMAIL = "send-welcome-email";

type Payload = {
  to: string;
  name: string;
};

export async function registerSendWelcomeEmailHandler(boss: PgBoss): Promise<void> {
  await boss.work(SEND_WELCOME_EMAIL, async ([job]) => {
    const { to, name } = job.data as Payload;
    const email = getEmailAdapter();

    const result = await email.send({
      to,
      subject: "Welcome!",
      html: `<h1>Hello ${name}</h1><p>Welcome to the app.</p>`,
    });

    if (!result.success) {
      getLogger().error({ to, error: result.error }, "Welcome email failed");
      throw new Error(result.error);  // pg-boss will retry
    }

    getLogger().info({ to, messageId: result.messageId }, "Welcome email sent");
  });
}
```

Then add the enqueue call to your mutation:

```typescript
// Add to your router file:
import { enqueueJob } from "../jobs/index.js";
import { SEND_WELCOME_EMAIL } from "../jobs/handlers/sendWelcomeEmail.js";

create: protectedProcedure
  .input(CreateUserSchema)
  .mutation(async ({ ctx, input }) => {
    const [user] = await ctx.db.insert(users).values({ ...input, role: "user" }).returning();

    // Non-blocking — returns immediately, email sends in background
    await enqueueJob(SEND_WELCOME_EMAIL, { to: user.email, name: user.name });

    return user;
  }),
```

See [Background Jobs](./background-jobs.md) for retries, scheduling, and concurrency.

---

## Step 7: Database-Driven Configuration (When Needed)

Sometimes the provider or its config comes from the database — e.g., per-tenant email settings in a multi-tenant app, or admin-configurable SMTP settings.

Add an overload to the factory file that accepts a config parameter:

```typescript
// Add to: packages/api/src/services/email/index.ts

export function createEmailAdapter(config: {
  provider: string;
  apiKey: string;
  fromAddress: string;
}): EmailAdapter {
  switch (config.provider) {
    case "sendgrid":
      return createSendGridAdapter({ apiKey: config.apiKey, fromAddress: config.fromAddress });
    default:
      return createConsoleEmailAdapter();
  }
}
```

Then in your procedure:

```typescript
sendNotification: protectedProcedure.mutation(async ({ ctx }) => {
  // Read config from DB (e.g., org-level settings)
  const [settings] = await ctx.db
    .select()
    .from(orgSettings)
    .where(eq(orgSettings.orgId, ctx.user.orgId))
    .limit(1);

  const email = createEmailAdapter({
    provider: settings.emailProvider,
    apiKey: settings.emailApiKey,
    fromAddress: settings.emailFrom,
  });

  await email.send({ to: "...", subject: "...", html: "..." });
}),
```

This way the same adapter type works whether config comes from env vars (singleton via `getEmailAdapter()`), the database (per-request via `createEmailAdapter()`), or passed in directly.

---

## Step 8: Adding a New Provider Later

This is the payoff. When you switch from SendGrid to Resend, create one new file and change one env var:

```typescript
// Create: packages/api/src/services/email/resend.ts
import { getLogger } from "../../lib/logger.js";
import type { EmailAdapter } from "./types.js";

export function createResendAdapter(config: {
  apiKey: string;
  fromAddress: string;
}): EmailAdapter {
  return {
    async send(params) {
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: config.fromAddress,
            to: params.to,
            subject: params.subject,
            html: params.html,
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          getLogger().error({ status: response.status, body }, "Resend API error");
          return { success: false, error: `Resend error: ${response.status}` };
        }

        const data = await response.json();
        return { success: true, messageId: data.id };
      } catch (err) {
        getLogger().error({ err }, "Resend request failed");
        return { success: false, error: (err as Error).message };
      }
    },
  };
}
```

Then add the new case to the factory:

```typescript
// Add to: packages/api/src/services/email/index.ts — extend the switch statement
case "resend":
  getLogger().info("Email adapter: Resend");
  instance = createResendAdapter({ apiKey: env.RESEND_API_KEY!, fromAddress: env.EMAIL_FROM! });
  break;
```

Change the env var:

```
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
```

No other code changes. Every mutation, job, and test that uses `getEmailAdapter()` now sends through Resend.

---

## How to Test

The adapter pattern makes testing trivial. You never mock HTTP calls or provider SDKs — you mock the adapter.

### Unit test with a mock adapter

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setEmailAdapter, resetEmailAdapter } from "../services/email/index.js";
import type { EmailAdapter } from "../services/email/types.js";

const mockEmail: EmailAdapter = {
  send: vi.fn().mockResolvedValue({ success: true, messageId: "test-123" }),
};

beforeEach(() => {
  vi.clearAllMocks();
  setEmailAdapter(mockEmail);
});

afterAll(() => resetEmailAdapter());

it("sends welcome email on user create", async () => {
  const caller = appRouter.createCaller({
    user: { sub: "u1", email: "test@test.com" },
    db: mockDb as any,
    pubsub: mockPubsub as any,
  });

  await caller.user.sendWelcome({ email: "new@test.com" });

  expect(mockEmail.send).toHaveBeenCalledWith(
    expect.objectContaining({ to: "new@test.com", subject: "Welcome!" }),
  );
});

it("throws on email failure", async () => {
  vi.mocked(mockEmail.send).mockResolvedValueOnce({ success: false, error: "API down" });

  const caller = appRouter.createCaller({ user: mockUser, db: mockDb as any, pubsub: mockPubsub as any });
  await expect(caller.user.sendWelcome({ email: "new@test.com" })).rejects.toThrow("INTERNAL_SERVER_ERROR");
});
```

### Testing a specific adapter implementation

```typescript
import { describe, it, expect, vi } from "vitest";
import { createSendGridAdapter } from "./sendgrid.js";

it("calls SendGrid API with correct payload", async () => {
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    headers: new Headers({ "x-message-id": "sg-123" }),
  });
  vi.stubGlobal("fetch", mockFetch);

  const adapter = createSendGridAdapter({ apiKey: "test-key", fromAddress: "from@test.com" });
  const result = await adapter.send({ to: "to@test.com", subject: "Hi", html: "<p>Hello</p>" });

  expect(result).toEqual({ success: true, messageId: "sg-123" });
  expect(mockFetch).toHaveBeenCalledWith(
    "https://api.sendgrid.com/v3/mail/send",
    expect.objectContaining({ method: "POST" }),
  );

  vi.unstubAllGlobals();
});
```

---

## How to Debug

- **Console adapter being used in production?** Check that `EMAIL_PROVIDER` is set in your env. If it's missing or empty, the factory defaults to console.
- **"SENDGRID_API_KEY is required" at startup?** You set `EMAIL_PROVIDER=sendgrid` but didn't provide the API key. Either set the key or remove `EMAIL_PROVIDER` to use the console adapter.
- **Email sent but not received?** Check the adapter's return value — `success: true` only means the API accepted the request. Check the provider's dashboard for delivery status. Also check spam folders.
- **Wrong provider being used?** The factory caches the adapter as a singleton. If you changed env vars after the first call, the old adapter is still cached. Restart the server.
- **Need to test with real emails in staging?** Set `EMAIL_PROVIDER=sendgrid` in the staging env. The same code, different config.

---

## Checklist

- [ ] Adapter type in `services/<name>/types.ts` with params, result, and adapter types
- [ ] Console/dev factory that logs instead of calling the real service
- [ ] Real factory with config accepted via parameter (closure, not class)
- [ ] Top-level factory in `services/<name>/index.ts` with `get<Name>Adapter()`, `set<Name>Adapter()`, `reset<Name>Adapter()`
- [ ] Provider-specific env vars added to `lib/env.ts` (optional at Zod level, validated in factory)
- [ ] Business logic calls the adapter, never the provider directly
- [ ] Heavy operations routed through background jobs (not blocking requests)
- [ ] Tests mock the adapter type, not the provider SDK
- [ ] Provider swap requires only: one new file + one factory case + env var change

---

## Applying This Pattern to Other Services

| Service | Adapter Methods | Implementations |
|---|---|---|
| **Payments** | `createCharge()`, `refund()`, `getBalance()` | Stripe, Square, console |
| **File Storage** | `upload()`, `download()`, `delete()`, `getUrl()` | S3, GCS, local filesystem |
| **SMS** | `send()` | Twilio, Vonage, console |
| **Push Notifications** | `send()`, `sendBatch()` | Expo Push, Firebase, console |
| **AI/LLM** | `complete()`, `embed()` | OpenAI, Anthropic, local/mock |
| **Search** | `index()`, `search()`, `delete()` | Algolia, Meilisearch, Postgres full-text |

The structure is always the same:
```
services/<name>/
  types.ts      ← adapter type
  index.ts      ← factory
  console.ts    ← dev/test factory
  <provider>.ts ← real factory(s)
```

---

## Related

- [Coding Guidelines](./coding-guidelines.md) — Why factory functions over classes, type conventions
- [Environment Validation](./env-validation.md) — Adding env vars for provider credentials
- [Background Jobs](./background-jobs.md) — Offloading external calls to non-blocking jobs
- [Structured Logging](./logging.md) — Logging adapter calls and errors
- [Testing](./testing.md) — Mocking patterns
