# Adding a Scheduled Job

How to add recurring work that runs on a schedule — daily report emails, hourly data syncs, nightly cleanup of expired records, periodic health checks against external APIs. Uses pg-boss's built-in cron scheduling, which runs inside the existing API process with no extra infrastructure.

This guide builds on [Background Jobs](./background-jobs.md). If you haven't read that yet, start there — it covers how pg-boss is wired up, how to create handlers, and how to enqueue one-off jobs. This guide covers the parts that are different for scheduled work: cron expressions, idempotency, monitoring, and cleanup.

This guide uses "a nightly job that deletes users who haven't logged in for 90 days" as the example. Replace with your use case.

> **Note:** This guide covers scheduled (cron) job implementation. pg-boss is already wired up in the codebase and one-off job handlers work -- see [Background Jobs](./background-jobs.md) for the existing infrastructure. However, the scheduled job examples below (cron scheduling, timezones, idempotency patterns) do not yet exist in the codebase. They are worked examples showing the pattern to follow when adding your first scheduled job.

## How pg-boss Scheduling Works

pg-boss has a built-in cron scheduler. When you call `boss.schedule()`, it stores the schedule in a `pgboss.schedule` table. A clock monitor inside pg-boss checks this table and automatically enqueues a job at each cron tick. You register a `work()` handler for the same job name, and it processes each enqueued instance.

```
boss.schedule("delete-stale-users", "0 3 * * *")
  → pg-boss clock monitor fires at 3:00 AM
    → enqueues a job named "delete-stale-users"
      → your work() handler picks it up and runs
```

Key behaviors:
- Schedules survive server restarts — they're stored in Postgres
- If the server is down when a cron tick fires, pg-boss enqueues the job when it starts back up (within one cron interval)
- On multi-instance deployments, pg-boss leader election ensures only one instance runs the scheduler — no duplicate jobs
- `schedule()` is idempotent — calling it again with the same name updates the existing schedule

---

## Step 1: Create the Handler

The handler is the same as any one-off job handler. The only difference is what's inside: scheduled jobs typically query the database, do bulk operations, and log what they did.

```typescript
// Create: packages/api/src/jobs/handlers/deleteStaleUsers.ts
import type PgBoss from "pg-boss";
import { eq, lt, isNotNull } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { getLogger } from "../../lib/logger.js";

export const DELETE_STALE_USERS = "delete-stale-users";

export async function registerDeleteStaleUsersHandler(boss: PgBoss): Promise<void> {
  await boss.work(DELETE_STALE_USERS, async ([job]) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    const staleUsers = await getDb()
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(lt(users.lastLoginAt, cutoff));

    if (staleUsers.length === 0) {
      getLogger().info({ jobId: job.id }, "No stale users to delete");
      return;
    }

    for (const user of staleUsers) {
      await getDb()
        .delete(users)
        .where(eq(users.id, user.id));
    }

    getLogger().info(
      { jobId: job.id, count: staleUsers.length },
      "Deleted stale users",
    );
  });

  getLogger().info(`Registered handler for ${DELETE_STALE_USERS}`);
}
```

**Why does the handler import `getDb` directly instead of using `ctx.db`?** Scheduled jobs run outside of tRPC request context — there's no HTTP request and no `ctx`. The handler imports the database connection directly via `getDb()`. This is the one place in the codebase where that's normal.

---

## Step 2: Register the Handler and Schedule

Add both the handler registration and the schedule call to `initJobs`. The schedule tells pg-boss *when* to enqueue; the handler tells it *what to do* when the job arrives.

```typescript
// Add to: packages/api/src/jobs/index.ts
import { registerDeleteStaleUsersHandler, DELETE_STALE_USERS }
  from "./handlers/deleteStaleUsers.js";

export async function initJobs(connectionString: string): Promise<void> {
  boss = new PgBoss(connectionString);
  boss.on("error", (error) => getLogger().error({ err: error }, "pg-boss error"));
  await boss.start();
  getLogger().info("pg-boss started");

  // Create queues (required in pg-boss v10 before work()/send())
  await boss.createQueue(EXAMPLE_JOB);
  await boss.createQueue(DELETE_STALE_USERS);

  // Register handlers
  await registerExampleHandler(boss);
  await registerDeleteStaleUsersHandler(boss);

  // Register schedules
  await boss.schedule(DELETE_STALE_USERS, "0 3 * * *");
  getLogger().info("Registered schedule: delete-stale-users at 0 3 * * *");
}
```

`schedule()` is idempotent. If the schedule already exists with the same name and cron expression, it's a no-op. If the cron expression changed, it updates the existing schedule. This means it's safe to call on every server startup.

### Cron expression reference

```
┌───────── minute (0-59)
│ ┌─────── hour (0-23)
│ │ ┌───── day of month (1-31)
│ │ │ ┌─── month (1-12)
│ │ │ │ ┌─ day of week (0-7, 0 and 7 are Sunday)
│ │ │ │ │
* * * * *
```

Common patterns:

| Schedule | Cron | When it runs |
|---|---|---|
| Every hour | `0 * * * *` | :00 of every hour |
| Every 15 minutes | `*/15 * * * *` | :00, :15, :30, :45 |
| Daily at 3 AM | `0 3 * * *` | 3:00 AM |
| Daily at midnight | `0 0 * * *` | 12:00 AM |
| Weekdays at 9 AM | `0 9 * * 1-5` | Mon–Fri at 9:00 AM |
| Weekly on Sunday | `0 0 * * 0` | Sunday at midnight |
| First of every month | `0 0 1 * *` | 1st at midnight |

### Timezone

By default, cron expressions evaluate in UTC. To use a different timezone, pass the `tz` option:

```typescript
await boss.schedule(DELETE_STALE_USERS, "0 3 * * *", null, {
  tz: "America/New_York",
});
```

The third argument is `data` (pass `null` if you don't need static data attached to each scheduled job instance).

---

## Step 3: Make It Idempotent

Scheduled jobs can run more than once for the same logical time window — retries, clock skew, a deploy that re-triggers the schedule, or a bug that runs the same handler twice. The handler must produce the same result regardless of how many times it runs.

### The rule

**If you ran the handler twice in a row, the second run should be a no-op (or at least not cause harm).**

### Common idempotency patterns

**Deletes are naturally idempotent.** Deleting the same record twice is safe — the first run removes it, the second run finds nothing to delete. This is one reason deletion-based cleanup is simpler than flag-based approaches:

```typescript
// Deleting stale users is inherently idempotent — if the user was already
// deleted by a previous run, the WHERE clause simply matches zero rows.
const staleUsers = await getDb()
  .select({ id: users.id })
  .from(users)
  .where(lt(users.lastLoginAt, cutoff));
```

**Use `ON CONFLICT DO NOTHING` for inserts.** If the job creates records (e.g., generating monthly invoices), use upserts to avoid duplicates:

```typescript
await getDb()
  .insert(invoices)
  .values({ userId: user.id, month: currentMonth, amount: 29.99 })
  .onConflictDoNothing({ target: [invoices.userId, invoices.month] });
```

**Use a job key for deduplication.** pg-boss can prevent duplicate scheduled instances using `singletonKey`:

```typescript
await boss.schedule(MONTHLY_REPORT, "0 9 1 * *", null, {
  singletonKey: `monthly-report-${new Date().toISOString().slice(0, 7)}`,  // "monthly-report-2026-02"
});
```

If a job with that key already exists in the queue, pg-boss won't create another.

**Log what was skipped.** So you can tell the difference between "ran but nothing to do" and "didn't run at all":

```typescript
if (staleUsers.length === 0) {
  getLogger().info({ jobId: job.id }, "No stale users to delete — skipping");
  return;
}
```

---

## Step 4: Passing Static Data to Scheduled Jobs

If every scheduled run needs the same configuration, pass it as the third argument to `schedule()`:

```typescript
await boss.schedule(
  DELETE_STALE_USERS,
  "0 3 * * *",
  { daysThreshold: 90, dryRun: false },  // attached to every enqueued job
);
```

Then read it in the handler:

```typescript
await boss.work(DELETE_STALE_USERS, async ([job]) => {
  const { daysThreshold, dryRun } = job.data as { daysThreshold: number; dryRun: boolean };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysThreshold);

  // ... use dryRun to log instead of mutating
});
```

This is useful for:
- Making thresholds configurable without code changes (update the schedule data)
- Adding a `dryRun` flag during rollout
- Passing env-specific configuration (different thresholds in staging vs production)

---

## Step 5: Monitoring That It Actually Ran

A scheduled job that silently stops running is worse than a job that fails loudly. You need to know both that it ran and what it did.

### Structured logging (minimum viable monitoring)

Every scheduled handler should log at the start and end with enough context to answer "did it run?" and "what did it do?":

```typescript
await boss.work(DELETE_STALE_USERS, async ([job]) => {
  getLogger().info({ jobId: job.id, scheduledFor: job.data }, "Starting delete-stale-users");

  // ... do the work ...

  getLogger().info(
    { jobId: job.id, deleted: staleUsers.length, durationMs: Date.now() - start },
    "Finished delete-stale-users",
  );
});
```

In production, pipe these logs to your aggregator (Datadog, Loki, CloudWatch) and set an alert for "no log line matching `Finished delete-stale-users` in 25 hours" — slightly more than the cron interval.

### Query pg-boss tables directly

pg-boss stores job history in Postgres. You can inspect it with Drizzle Studio (`pnpm db:studio`) or raw SQL:

```sql
-- Did the job run recently?
SELECT id, state, created_on, started_on, completed_on
FROM pgboss.job
WHERE name = 'delete-stale-users'
ORDER BY created_on DESC
LIMIT 5;

-- What schedules are registered?
SELECT * FROM pgboss.schedule;

-- How many jobs by state?
SELECT state, count(*)
FROM pgboss.job
WHERE name = 'delete-stale-users'
GROUP BY state;
```

Job states: `created` → `active` → `completed` (or `failed`, `cancelled`, `expired`).

### Expose via a tRPC admin endpoint (optional)

If you want to check job status from the admin panel without database access, you can add an endpoint like this. This requires a `getBoss()` export that doesn't exist yet in `jobs/index.ts` (which currently only exports `initJobs`, `closeJobs`, and `enqueueJob`). The code to add it is shown below.

```typescript
// Add to: packages/api/src/routers/admin.ts
import { getBoss } from "../jobs/index.js";

jobStatus: adminProcedure
  .input(z.object({ name: z.string() }))
  .query(async ({ input }) => {
    const boss = getBoss();
    const size = await boss.getQueueSize(input.name);
    const schedules = await boss.getSchedules();
    const schedule = schedules.find((s) => s.name === input.name);

    return {
      queueSize: size,
      cron: schedule?.cron ?? null,
      tz: schedule?.options?.tz ?? "UTC",
    };
  }),
```

To support this, add a `getBoss()` getter to `jobs/index.ts`:

```typescript
// Add to: packages/api/src/jobs/index.ts
export function getBoss(): PgBoss {
  if (!boss) throw new Error("pg-boss not initialized");
  return boss;
}
```

---

## Step 6: Cleanup Patterns

Scheduled jobs often accumulate data — completed job records in pg-boss tables, stale application data, or temporary artifacts. Plan for cleanup from the start.

### pg-boss auto-cleanup

pg-boss automatically deletes completed/failed jobs after a retention period. The default is 30 days. You can configure it per-queue:

```typescript
await boss.createQueue(DELETE_STALE_USERS, {
  retentionDays: 7,  // keep job history for 7 days
});
```

Or per-schedule:

```typescript
await boss.schedule(DELETE_STALE_USERS, "0 3 * * *", null, {
  retentionDays: 7,
});
```

### Application-level cleanup jobs

If your scheduled job creates temporary data, add a companion cleanup job. For example, if you had a `reports` table and generated daily reports that are only needed for 30 days:

> **Note:** The `reports` table used in this example does not exist in the current schema. This is a hypothetical example to illustrate the cleanup pattern. You would need to add a `reports` table to `packages/api/src/db/schema.ts` before using this code.

```typescript
// Create: packages/api/src/jobs/handlers/cleanupOldReports.ts
import { getDb } from "../../db/index.js";
import { getLogger } from "../../lib/logger.js";

export const CLEANUP_OLD_REPORTS = "cleanup-old-reports";

export async function registerCleanupOldReportsHandler(boss: PgBoss): Promise<void> {
  await boss.work(CLEANUP_OLD_REPORTS, async ([job]) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const result = await getDb()
      .delete(reports)
      .where(lt(reports.createdAt, cutoff));

    getLogger().info({ jobId: job.id, deleted: result.rowCount }, "Cleaned up old reports");
  });
}
```

```typescript
// Add to: packages/api/src/jobs/index.ts — in initJobs()
await boss.schedule(CLEANUP_OLD_REPORTS, "0 4 * * *");  // 4 AM, after the report job
```

### Pattern: pair a generator with its cleaner

| Generator | Cleaner | Schedule |
|---|---|---|
| `generate-daily-report` (3 AM) | `cleanup-old-reports` (4 AM) | Keep 30 days |
| `sync-external-data` (every hour) | `cleanup-stale-sync-cache` (daily) | Keep 7 days |
| `send-digest-email` (weekly) | N/A — no artifacts to clean | N/A |

Run the cleaner after the generator to avoid a window where both are fighting over the same data.

---

## Step 7: Retries and Dead Letters

Scheduled jobs should be resilient to transient failures (database timeouts, external API blips). Configure retries on the queue or the schedule.

### On the queue (applies to all jobs in that queue)

```typescript
await boss.createQueue(DELETE_STALE_USERS, {
  retryLimit: 3,
  retryDelay: 60,       // 60 seconds between retries
  retryBackoff: true,   // exponential backoff: 60s, 120s, 240s
  deadLetter: "failed-jobs",  // after all retries exhausted, move here
});
```

### On the schedule (applies to each enqueued instance)

```typescript
await boss.schedule(DELETE_STALE_USERS, "0 3 * * *", null, {
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
});
```

### Dead letter queue

A dead letter queue catches jobs that failed all retries. Register a handler that logs or alerts:

```typescript
// Create: packages/api/src/jobs/handlers/deadLetterHandler.ts
export async function registerDeadLetterHandler(boss: PgBoss): Promise<void> {
  await boss.createQueue("failed-jobs");

  await boss.work("failed-jobs", async ([job]) => {
    getLogger().error(
      { originalJob: job.data, jobId: job.id },
      "Job exhausted all retries and moved to dead letter queue",
    );
    // Optionally: send an alert, post to Slack, increment a metric
  });
}
```

---

## Step 8: Removing a Schedule

When you no longer need a scheduled job, call `unschedule()` during initialization:

```typescript
// Add to: packages/api/src/jobs/index.ts — in initJobs()
await boss.unschedule("old-job-name");
```

Or remove it from the `pgboss.schedule` table directly:

```sql
DELETE FROM pgboss.schedule WHERE name = 'old-job-name';
```

Don't just remove the `schedule()` call from code — the existing schedule persists in Postgres. You must explicitly unschedule it or it will keep enqueuing jobs (which will fail if the handler is gone).

---

## Step 9: Write Tests

### Test the handler logic directly

Don't test the pg-boss scheduling machinery — test your handler's business logic.

```typescript
// Create: packages/api/src/jobs/handlers/deleteStaleUsers.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/index.js", () => ({ getDb: vi.fn() }));

import type PgBoss from "pg-boss";

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue([
    { id: "user-1", email: "stale@test.com" },
  ]),
  delete: vi.fn().mockReturnThis(),
};

// Replace the getDb import with our mock
vi.doMock("../../db/index.js", () => ({ getDb: () => mockDb }));

import { registerDeleteStaleUsersHandler } from "./deleteStaleUsers.js";

describe("deleteStaleUsers", () => {
  it("registers the handler", async () => {
    const mockBoss = { work: vi.fn() } as unknown as PgBoss;
    await registerDeleteStaleUsersHandler(mockBoss);
    expect(mockBoss.work).toHaveBeenCalledWith("delete-stale-users", expect.any(Function));
  });

  it("deletes stale users", async () => {
    const mockBoss = { work: vi.fn() } as unknown as PgBoss;
    await registerDeleteStaleUsersHandler(mockBoss);

    // Extract the handler that was registered
    const handler = (mockBoss.work as any).mock.calls[0][1] as Function;
    await handler([{ id: "job-1", data: {} }]);

    expect(mockDb.delete).toHaveBeenCalled();
  });

  it("skips when no stale users found", async () => {
    mockDb.where.mockResolvedValueOnce([]);  // no results

    const mockBoss = { work: vi.fn() } as unknown as PgBoss;
    await registerDeleteStaleUsersHandler(mockBoss);

    const handler = (mockBoss.work as any).mock.calls[0][1] as Function;
    await handler([{ id: "job-1", data: {} }]);

    expect(mockDb.delete).not.toHaveBeenCalled();
  });
});
```

### Test that schedules are registered at startup

```typescript
// Create: packages/api/src/jobs/index.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("pg-boss", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      start: vi.fn(),
      on: vi.fn(),
      work: vi.fn(),
      schedule: vi.fn(),
    })),
  };
});

vi.mock("./handlers/example.js", () => ({
  registerExampleHandler: vi.fn(),
}));
vi.mock("./handlers/deleteStaleUsers.js", () => ({
  DELETE_STALE_USERS: "delete-stale-users",
  registerDeleteStaleUsersHandler: vi.fn(),
}));

import { initJobs } from "./index.js";
import PgBoss from "pg-boss";

it("registers scheduled jobs on startup", async () => {
  await initJobs("postgresql://mock");

  const bossInstance = (PgBoss as unknown as vi.Mock).mock.results[0].value;
  expect(bossInstance.schedule).toHaveBeenCalledWith(
    "delete-stale-users",
    "0 3 * * *",
  );
});
```

Run all tests:

```bash
pnpm test
```

See [Testing](./testing.md) for mocking patterns.

---

## Checklist

**Handler**
- [ ] Handler file in `packages/api/src/jobs/handlers/` with exported job name constant
- [ ] Handler imports `getDb` directly (not from tRPC context)
- [ ] Handler is idempotent — safe to run twice for the same time window
- [ ] Handler logs at start and finish with `jobId`, result counts, and duration
- [ ] Handler registered in `initJobs()`

**Schedule**
- [ ] `boss.schedule()` called in `initJobs()` with the correct cron expression
- [ ] Timezone set via `tz` option if the schedule should follow local time, not UTC
- [ ] Old/removed schedules cleaned up with `boss.unschedule()`

**Resilience**
- [ ] Retries configured (3 retries with backoff is a good default)
- [ ] Dead letter queue set up if failures need human attention
- [ ] Cleanup job exists for any temporary data the scheduled job creates

**Monitoring**
- [ ] Structured log lines at start and finish of every run
- [ ] Alert or check for "job hasn't run in > expected interval" (log aggregator or admin endpoint)

**Tests**
- [ ] Handler business logic tested by extracting and calling the registered function
- [ ] Schedule registration verified in `initJobs` test
- [ ] Idempotency tested — handler called twice produces correct results

---

## Common Scheduled Job Patterns

| Job | Schedule | Key concerns |
|---|---|---|
| **Delete stale accounts** | Daily | Idempotent (deletes are safe to repeat), log count |
| **Send digest emails** | Daily/weekly | Use external service adapter, offload to background job handler |
| **Sync external data** | Hourly | Idempotent (upsert), handle API rate limits, partial failure |
| **Generate reports** | Daily/monthly | Pair with a cleanup job, store results with a date key |
| **Expire temporary tokens** | Hourly | `DELETE WHERE expires_at < NOW()`, log count |
| **Refresh materialized views** | Every 15 min | Postgres `REFRESH MATERIALIZED VIEW CONCURRENTLY` |
| **Health check external APIs** | Every 5 min | Log status, alert on consecutive failures |

---

## Related

- [Background Jobs](./background-jobs.md) — How pg-boss is wired up, creating handlers, enqueuing one-off jobs
- [Adding an External Service](./adding-external-services.md) — Adapter pattern for calling external APIs from job handlers
- [Database](./database.md) — Drizzle queries, transactions, bulk operations
- [Structured Logging](./logging.md) — Logging patterns for job output
- [Testing](./testing.md) — Mocking patterns for job handlers
