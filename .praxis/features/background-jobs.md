# Background Jobs

pg-boss provides a persistent job queue backed by the existing Postgres database. No Redis or additional infrastructure. Jobs survive server restarts and support scheduling, retries, and concurrency.

## How It's Wired

```typescript
// packages/api/src/jobs/index.ts
import PgBoss from "pg-boss";

let boss: PgBoss | null = null;

export async function initJobs(connectionString: string): Promise<void> {
  boss = new PgBoss(connectionString);
  boss.on("error", (error) => getLogger().error({ err: error }, "pg-boss error"));
  await boss.start();
  await boss.createQueue(EXAMPLE_JOB);  // pg-boss v10: required before work()/send()
  await registerExampleHandler(boss);
}

export async function enqueueJob<T extends object>(name: string, data: T): Promise<string | null> {
  if (!boss) throw new Error("pg-boss not initialized");
  return boss.send(name, data);
}
```

Lifecycle is managed in `api/src/index.ts`:

```typescript
async function start() {
  await initJobs(connectionString);  // starts pg-boss, registers handlers
  server.listen(env.PORT, () => { ... });
}

async function shutdown() {
  await closeJobs();  // graceful stop
}
```

## Example Job (Already Implemented)

```typescript
// packages/api/src/jobs/handlers/example.ts
export const EXAMPLE_JOB = "example-job";

export async function registerExampleHandler(boss: PgBoss): Promise<void> {
  await boss.work(EXAMPLE_JOB, async ([job]) => {
    getLogger().info({ jobId: job.id, data: job.data }, "Processing example job");
  });
}
```

Triggered via tRPC:

```typescript
// packages/api/src/routers/jobs.ts
enqueue: protectedProcedure
  .input(z.object({ message: z.string().optional() }))
  .mutation(async ({ input }) => {
    const jobId = await enqueueJob(EXAMPLE_JOB, {
      message: input.message ?? "hello from trpc",
      enqueuedAt: Date.now(),
    });
    return { jobId };
  }),
```

## How to Implement a New Job

### 1. Create the handler

```typescript
// packages/api/src/jobs/handlers/sendEmail.ts
import type PgBoss from "pg-boss";
import { getLogger } from "../../lib/logger.js";

export const SEND_EMAIL_JOB = "send-email";

type SendEmailPayload = {
  to: string;
  subject: string;
  body: string;
};

export async function registerSendEmailHandler(boss: PgBoss): Promise<void> {
  await boss.work(SEND_EMAIL_JOB, async ([job]) => {
    const { to, subject, body } = job.data as SendEmailPayload;
    getLogger().info({ jobId: job.id, to, subject }, "Sending email");

    // your email sending logic here
    // await sendgrid.send({ to, subject, html: body });

    getLogger().info({ jobId: job.id }, "Email sent");
  });
}
```

### 2. Register it

```typescript
// packages/api/src/jobs/index.ts
import { registerSendEmailHandler } from "./handlers/sendEmail.js";

export async function initJobs(connectionString: string): Promise<void> {
  // ...existing setup...
  await boss.createQueue(SEND_EMAIL_JOB);  // pg-boss v10: required before work()/send()
  await registerExampleHandler(boss);
  await registerSendEmailHandler(boss);  // add here
}
```

### 3. Enqueue from anywhere

```typescript
import { enqueueJob } from "../jobs/index.js";
import { SEND_EMAIL_JOB } from "../jobs/handlers/sendEmail.js";

await enqueueJob(SEND_EMAIL_JOB, {
  to: "user@example.com",
  subject: "Welcome!",
  body: "<h1>Hello</h1>",
});
```

### 4. (Optional) Expose via tRPC

```typescript
// packages/api/src/routers/email.ts
sendWelcome: protectedProcedure
  .input(z.object({ userId: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    const [user] = await ctx.db.select().from(users).where(eq(users.id, input.userId));
    const jobId = await enqueueJob(SEND_EMAIL_JOB, {
      to: user.email,
      subject: "Welcome!",
      body: `<h1>Hello ${user.name}</h1>`,
    });
    return { jobId };
  }),
```

## Advanced pg-boss Features

### Scheduled/delayed jobs

```typescript
await boss.send(SEND_EMAIL_JOB, data, {
  startAfter: 30,  // delay 30 seconds
});

// Or with a cron schedule
await boss.schedule(SEND_EMAIL_JOB, "0 9 * * *", data);  // daily at 9am
```

### Retries

```typescript
await boss.send(SEND_EMAIL_JOB, data, {
  retryLimit: 3,
  retryDelay: 60,  // 60 seconds between retries
});
```

### Concurrency

```typescript
await boss.work(SEND_EMAIL_JOB, { batchSize: 5 }, async (jobs) => {
  // processes up to 5 jobs at a time
  for (const job of jobs) { /* ... */ }
});
```

## How to Test

Mock `enqueueJob` in router tests:

```typescript
vi.mock("../jobs/index.js", () => ({
  enqueueJob: vi.fn().mockResolvedValue("job-123"),
}));

import { enqueueJob } from "../jobs/index.js";

it("enqueues a job", async () => {
  const caller = appRouter.createCaller({ user: { sub: "u1" }, db: mockDb, pubsub: mockPubsub });
  const result = await caller.jobs.enqueue({ message: "test" });

  expect(result.jobId).toBe("job-123");
  expect(enqueueJob).toHaveBeenCalledWith("example-job", expect.objectContaining({ message: "test" }));
});
```

For handler tests, call the handler function directly:

```typescript
import type PgBoss from "pg-boss";

it("processes the job", async () => {
  const mockBoss = { work: vi.fn() } as unknown as PgBoss;
  await registerSendEmailHandler(mockBoss);

  // Get the handler that was registered
  const handler = mockBoss.work.mock.calls[0][1] as Function;
  await handler([{ id: "job-1", data: { to: "a@b.com", subject: "Hi", body: "Hello" } }]);

  // Assert on side effects (email sent, logger called, etc.)
});
```

## How to Debug

- **Jobs not running?** Check that `initJobs()` completed successfully at startup (look for "pg-boss started" in logs). If it fails, pg-boss can't create its schema tables — check your DATABASE_URL.
- **Job stuck in "active"?** If the server crashes mid-job, pg-boss marks it as expired after a timeout (default 15 min). Check with: `SELECT * FROM pgboss.job WHERE name = 'your-job' AND state = 'active'`.
- **Job failed silently?** pg-boss catches handler errors and moves the job to "failed" state. Check: `SELECT * FROM pgboss.job WHERE name = 'your-job' AND state = 'failed'`.
- **pg-boss tables not created?** pg-boss auto-creates its `pgboss` schema on first `boss.start()`. If your DB user lacks CREATE SCHEMA permissions, it will fail.
- **Want to inspect the queue?** Use Drizzle Studio (`pnpm db:studio`) and look at the `pgboss.job` table, or query directly: `SELECT state, count(*) FROM pgboss.job GROUP BY state`.
