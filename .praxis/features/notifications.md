# Notifications

Push notifications (mobile), in-app toasts (web + mobile), and a paginated notification history view. One function call persists to DB, publishes a real-time sync event, and fires mobile push — no separate steps.

## How It's Wired

```
sendNotification(db, pubsub, target, payload)
  → inserts into `notifications` table
  → publishes SyncEvent on "notification" channel (Postgres LISTEN/NOTIFY)
  → looks up push tokens for eligible users (opt-out check)
  → calls push adapter (Expo in prod, console in dev)
```

The notification service takes `db` and `pubsub` as explicit parameters (dependency injection). It can be called from tRPC procedures, pg-boss job handlers, or any server-side code that has access to a database connection and pubsub instance.

## Data Model

### `notifications` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK, auto-generated |
| `userId` | uuid | FK → users.id, cascade delete |
| `title` | varchar(255) | Required |
| `body` | varchar(2000) | Required |
| `actionUrl` | varchar(500) | Nullable — navigates on click |
| `read` | boolean | Default false |
| `createdAt` | timestamptz | Default now |

### `push_tokens` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK, auto-generated |
| `userId` | uuid | FK → users.id, cascade delete |
| `token` | varchar(255) | Unique — Expo push token |
| `createdAt` | timestamptz | Default now |

### `users` table addition

| Column | Type | Notes |
|--------|------|-------|
| `pushOptOut` | boolean | Default false — suppresses push only, toasts still appear |

Schema definition: `packages/api/src/db/schema.ts`

## Zod Schemas

All schemas live in `packages/shared/src/schemas/notification.ts` and are re-exported from `packages/shared/src/schemas/index.ts`.

```typescript
import {
  CreateNotificationSchema,  // { title, body, actionUrl? }
  NotificationSchema,        // full notification with id, userId, read, createdAt
  PushTokenSchema,           // { id, userId, token, createdAt }
  RegisterPushTokenSchema,   // { token }
  NotificationListInputSchema, // { cursor?, limit }
  UpdatePushOptOutSchema,    // { optOut }
  type Notification,
  type CreateNotification,
  type PushToken,
  type RegisterPushToken,
  type NotificationListInput,
  type UpdatePushOptOut,
} from "@wanshitong/shared";
```

## Sending Notifications

### From a tRPC procedure or job handler

```typescript
import { sendNotification } from "../../services/notifications/index.js";

// Single user
const result = await sendNotification(db, pubsub, { userId: "user-uuid" }, {
  title: "New comment",
  body: "Someone commented on your post",
  actionUrl: "/posts/123",
});

// Multiple users
const result = await sendNotification(db, pubsub, { userIds: ["id-1", "id-2"] }, {
  title: "Update available",
  body: "Version 2.0 is out",
});
```

### Broadcast to all users

```typescript
import { broadcastNotification } from "../../services/notifications/index.js";

const result = await broadcastNotification(db, pubsub, {
  title: "System maintenance",
  body: "Scheduled downtime tonight at 11pm",
});
```

### Return value

Both functions return:

```typescript
{
  notificationIds: string[];
  pushResults: { sent: number; skipped: number; failed: number };
}
```

- `sent` — push notifications delivered
- `skipped` — users who opted out of push
- `failed` — push delivery failures (stale tokens auto-cleaned)

### From a pg-boss job

The welcome notification job (`packages/api/src/jobs/handlers/sendWelcomeNotification.ts`) shows the pattern for calling `sendNotification` from a background job:

```typescript
import { sendNotification } from "../../services/notifications/index.js";
import { getDb, getConnectionString } from "../../db/index.js";
import { PgPubSub } from "../../pubsub.js";

// Inside a job handler:
const db = getDb();
const pubsub = new PgPubSub(getConnectionString());

try {
  await sendNotification(db, pubsub, { userId }, {
    title: "Thanks for registering!",
    body: "Welcome! Explore the app to get started.",
  });
} finally {
  await pubsub.close();  // always close the pubsub instance you created
}
```

Job handlers create their own `PgPubSub` instance because they run outside the HTTP request lifecycle. Always close it in a `finally` block.

## tRPC Router

`packages/api/src/routers/notification.ts` — all endpoints require authentication (`protectedProcedure`).

| Procedure | Type | Input | Description |
|-----------|------|-------|-------------|
| `list` | query | `{ cursor?, limit }` | Paginated list, newest first |
| `unreadCount` | query | — | Count of unread notifications |
| `markRead` | mutation | `{ id }` | Mark one notification as read (ownership checked) |
| `markUnread` | mutation | `{ id }` | Mark one notification as unread (ownership checked) |
| `markAllRead` | mutation | — | Mark all unread notifications as read |
| `onSync` | subscription | — | Real-time sync events for the notification channel |
| `registerPushToken` | mutation | `{ token }` | Upsert an Expo push token for the current user |
| `updatePushOptOut` | mutation | `{ optOut }` | Toggle push notification opt-out |

All queries and mutations scope to the authenticated user. `markRead`/`markUnread` verify notification ownership before updating.

## Push Adapter

The push system uses the adapter pattern (see [Adding an External Service](./adding-external-services.md)).

```
packages/api/src/services/push/
  types.ts      ← PushAdapter type, SendPushParams, SendPushResult
  console.ts    ← Dev adapter (logs to Pino, returns success)
  expo.ts       ← Expo Push API adapter (batches in chunks of 100)
  index.ts      ← Factory: getPushAdapter(), setPushAdapter(), resetPushAdapter()
```

### Adapter selection

- No `PUSH_PROVIDER` env var → console adapter (dev mode, no real pushes)
- `PUSH_PROVIDER=expo` → Expo adapter (requires `EXPO_ACCESS_TOKEN`)

### Stale token cleanup

When the Expo API returns `DeviceNotRegistered`, the notification service automatically deletes the stale push token from the `push_tokens` table. No manual cleanup needed.

## Client Hooks

Both hooks live in `packages/hooks/src/hooks/` and are re-exported from `packages/hooks/src/index.ts`.

### `useNotifications()`

```typescript
import { useNotifications } from "@wanshitong/hooks";

const {
  notifications,   // Notification[] — current page
  isLoading,       // boolean
  error,           // string | null
  hasNextPage,     // boolean
  fetchNextPage,   // () => void
  unreadCount,     // number
  markRead,        // (input: { id: string }) => Promise
  markUnread,      // (input: { id: string }) => Promise
  markAllRead,     // () => Promise
} = useNotifications();
```

Automatically syncs in real-time via `useSyncSubscription` — new notifications appear instantly, read/unread state updates propagate across tabs.

### `useNotificationToast(onNotification)`

```typescript
import { useNotificationToast } from "@wanshitong/hooks";

useNotificationToast((notification) => {
  // notification: { id, title, body, actionUrl }
  // Show a toast, Alert, or whatever your platform supports
});
```

Framework-agnostic — the callback receives the notification data and you decide how to display it. Fires only for `created` sync events (new notifications).

## UI Components

### Web

- **`NotificationToast`** (`packages/web/src/components/NotificationToast.tsx`) — Fixed-position toast stack in top-right. Auto-dismisses after 5 seconds. Click navigates to `actionUrl`. Rendered in `App.tsx` so it's always active.
- **`NotificationList`** (`packages/web/src/components/NotificationList.tsx`) — Paginated notification list with mark read/unread, mark all read, relative timestamps. Used in the Profile page.
- **Unread badge** — Navbar shows unread count badge when > 0.

### Mobile

- **Notifications tab** (`packages/mobile/app/(tabs)/notifications.tsx`) — FlatList with infinite scroll, long-press to toggle read/unread, tap to navigate to `actionUrl`, mark all as read button.
- **Push token registration** (`packages/mobile/app/_layout.tsx`) — Registers Expo push token on app launch via `registerPushToken` mutation. Uses a ref guard to prevent duplicate registrations.
- **Push opt-out toggle** (`packages/mobile/app/(tabs)/profile.tsx`) — Switch component calling `updatePushOptOut` mutation.
- **Toast on foreground** — Mobile shows an Alert when a notification arrives while the app is in the foreground.

## Welcome Notification (Example)

A built-in example that exercises the full pipeline end-to-end. When a user registers, a pg-boss job fires and sends:

> **Thanks for registering!**
> Welcome! Explore the app to get started.

Implementation:
- Job handler: `packages/api/src/jobs/handlers/sendWelcomeNotification.ts`
- Job registration: `packages/api/src/jobs/index.ts` (queue `welcome-notification` created and handler registered at startup)
- Trigger: `packages/api/src/routers/user.ts` — `create` mutation enqueues the job with `{ userId }` after inserting the user

## How to Add a New Notification Type

### 1. Send from server-side code

```typescript
import { sendNotification } from "../services/notifications/index.js";

// In a tRPC procedure:
await sendNotification(ctx.db, ctx.pubsub, { userId: targetUserId }, {
  title: "Order shipped",
  body: `Your order #${orderId} is on its way!`,
  actionUrl: `/orders/${orderId}`,
});
```

### 2. Send from a background job

Create a job handler following the [Background Jobs](./background-jobs.md) pattern:

```typescript
// packages/api/src/jobs/handlers/orderShipped.ts
import type PgBoss from "pg-boss";
import { getDb, getConnectionString } from "../../db/index.js";
import { PgPubSub } from "../../pubsub.js";
import { sendNotification } from "../../services/notifications/index.js";

export const ORDER_SHIPPED_JOB = "order-shipped";

export async function registerOrderShippedHandler(boss: PgBoss): Promise<void> {
  await boss.work(ORDER_SHIPPED_JOB, async ([job]) => {
    const { userId, orderId } = job.data as { userId: string; orderId: string };
    const db = getDb();
    const pubsub = new PgPubSub(getConnectionString());

    try {
      await sendNotification(db, pubsub, { userId }, {
        title: "Order shipped",
        body: `Your order #${orderId} is on its way!`,
        actionUrl: `/orders/${orderId}`,
      });
    } finally {
      await pubsub.close();
    }
  });
}
```

Then register it in `packages/api/src/jobs/index.ts`:

```typescript
import { registerOrderShippedHandler, ORDER_SHIPPED_JOB } from "./handlers/orderShipped.js";

// In initJobs():
await boss.createQueue(ORDER_SHIPPED_JOB);
await registerOrderShippedHandler(boss);
```

### 3. Enqueue from anywhere

```typescript
import { enqueueJob } from "../jobs/index.js";
import { ORDER_SHIPPED_JOB } from "../jobs/handlers/orderShipped.js";

await enqueueJob(ORDER_SHIPPED_JOB, { userId, orderId });
```

That's it. The notification service handles persistence, real-time sync, push delivery, opt-out checking, and stale token cleanup automatically.

## Push Notification Setup

Push notifications require credentials from Apple and Google, configured through Expo's EAS Build system.

### Prerequisites (manual, one-time)

1. **Apple Developer Account** — Required for APNs (Apple Push Notification service)
   - Generate an APNs key (.p8 file) in the Apple Developer portal
   - Note the Key ID and Team ID

2. **Google Firebase project** — Required for FCM (Firebase Cloud Messaging)
   - Create a Firebase project and download `google-services.json`
   - Enable Cloud Messaging API

3. **Expo account** — Required to proxy push through Expo's service
   - Create a project at expo.dev
   - Generate an access token: `npx eas-cli login && npx eas-cli credentials:configure`

### init.sh integration

On first run, init.sh prompts for shared push credentials alongside Auth0 and GoDaddy:

| Credential | Saved where | Per-app? |
|---|---|---|
| Expo access token | macOS Keychain (`trpc-template-godaddy` service) | Shared |
| APNs key (.p8 file) | `~/.config/trpc-template/apns-key.p8` | Shared |
| APNs Key ID | `~/.config/trpc-template/defaults.env` | Shared |
| Apple Team ID | `~/.config/trpc-template/defaults.env` | Shared |
| `google-services.json` | Not saved — must be passed per project | **Per-app** |

All subsequent projects reuse the saved credentials automatically. Only `google-services.json` needs to be passed:

```bash
./scripts/init.sh my-app --google-services-path "/path/to/google-services.json"
```

CLI flags override saved defaults if provided:

```bash
./scripts/init.sh my-app \
  --expo-token "override-token" \
  --apns-key-path "/different/AuthKey.p8" \
  --apns-key-id "XXXXXXXXXX" \
  --apns-team-id "XXXXXXXXXX" \
  --google-services-path "/path/to/google-services.json"
```

When no push credentials are configured (first-time prompts skipped): push is skipped gracefully. The console adapter logs notifications instead of delivering them. In-app toasts and the notification history view still work without push credentials. To configure later, delete `~/.config/trpc-template/defaults.env` and re-run init.sh.

### Env vars

| Variable | Required | Description |
|----------|----------|-------------|
| `PUSH_PROVIDER` | No | Set to `expo` to enable real push delivery |
| `EXPO_ACCESS_TOKEN` | When `PUSH_PROVIDER=expo` | Expo push service access token |

## How to Test

### Schema tests

```typescript
// packages/shared/src/schemas/notification.test.ts
// 18 tests covering all Zod schemas — validation, defaults, edge cases
```

### Service tests

```typescript
// packages/api/src/services/notifications/index.test.ts
// 7 tests: single/multi/broadcast, opt-out, no tokens, DeviceNotRegistered cleanup, push failure resilience
```

### Router tests

```typescript
// packages/api/src/routers/notification.test.ts
// 16 tests: pagination, auth, ownership, upsert, opt-out, unread count
```

### Push adapter tests

```typescript
// packages/api/src/services/push/*.test.ts
// 11 tests: console (2), expo (6), factory (3)
```

### Job handler tests

```typescript
// packages/api/src/jobs/handlers/sendWelcomeNotification.test.ts
// 3 tests: happy path, pubsub cleanup, error handling
```

Mock `sendNotification` in your own tests:

```typescript
vi.mock("../../services/notifications/index.js", () => ({
  sendNotification: vi.fn().mockResolvedValue({
    notificationIds: ["notif-1"],
    pushResults: { sent: 1, skipped: 0, failed: 0 },
  }),
}));
```

## How to Debug

- **Notifications not appearing?** Check that `sendNotification()` was called — look for the DB insert in Drizzle Studio (`pnpm db:studio`, `notifications` table).
- **Toasts not showing?** Verify the `NotificationToast` component is mounted in your app layout and that the WebSocket subscription is connected (check browser DevTools network tab for WS frames on the `notification` channel).
- **Push not delivered?** Check logs for "Push adapter: console" — means `PUSH_PROVIDER` is not set. For Expo, look for "Expo Push API error" or "Expo push ticket error" in logs.
- **Push delivered but not received on device?** Verify the device token is in the `push_tokens` table. Check that `pushOptOut` is `false` for the user. On iOS, ensure push permissions were granted.
- **Stale tokens?** They're cleaned automatically when Expo returns `DeviceNotRegistered`. Check logs for "Deleted stale push tokens".
- **Welcome notification not sent on registration?** Check that the `welcome-notification` queue was created in `initJobs()` and that `enqueueJob` is called in the user `create` mutation. Check pg-boss job state: `SELECT * FROM pgboss.job WHERE name = 'welcome-notification'`.
