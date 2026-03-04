# Notifications Feature Plan

## Executive Summary
Add a complete push notification system to the trpc-template so every new app gets notifications out of the box after running `init.sh`. Includes mobile push (Expo), in-app toasts (web + mobile via real-time sync), a paginated notification history view in both web and mobile profiles, and a single `sendNotification()` function callable from anywhere in the API.

## Business Value
- **Problem:** Template lacks push notification capability, forcing every new project to build it from scratch
- **Stakeholders:** Developers using the template, AI agents building on top of it, end users of apps built from it
- **Business Impact:** Every new app gets notifications out of the box, reducing per-project effort to zero
- **Success Metric:** After running `init.sh`, an app can send a push notification with no additional setup

## User Benefits
- **End users:** Get timely notifications (push + in-app toasts) and a notification history view in their profile
- **Developers:** Get a ready-made notification system with a clean `sendNotification()` API -- no setup beyond `init.sh`
- **AI Agents:** Get a documented `.praxis/features/` guide so they can add new notification types by following the pattern
- **Pain points addressed:** No notification infrastructure exists in the template today; each project reinvents it
- **Example notification:** Welcome notification on registration -- "Thanks for registering for {{appName}}" -- exercises the full pipeline end-to-end

## Requirements

### Must-Have
- Data model: `id`, `userId`, `title`, `body`, `actionUrl` (nullable), `read` (boolean), `createdAt`
- API: `sendNotification(userId | userIds[], payload)` for single/multi user, `broadcastNotification(payload)` for all users
- One call persists to DB + triggers real-time sync + fires mobile push
- Delivery: Mobile push (native), web toast (real-time sync), in-app notification view (web + mobile, paginated)
- User actions: Mark read, mark unread, mark all read -- no delete
- Per-user push opt-out toggle (in-app toasts still appear)
- Welcome notification example on registration via pg-boss job
- Callable from tRPC procedures and pg-boss job handlers
- `.praxis/features/notifications.md` documentation
- `init.sh` integration with optional push credential flags
- README update with push notification setup section

### Out of Scope
- Browser push notifications (Web Push API / service workers)
- Notification categories/types (filtering, icons by type)
- Delete/dismiss notifications
- Email notifications
- Scheduled/delayed notifications (beyond what pg-boss already provides)
- Old notification cleanup job

## Technical Architecture

### Data Model
- `notifications` table: id, userId (FK users, cascade), title, body, actionUrl (nullable), read (default false), createdAt
- `push_tokens` table: id, userId (FK users, cascade), token (unique), createdAt
- `users` table: add `pushOptOut` boolean (default false)

### External Service (Adapter Pattern)
- `packages/api/src/services/push/` -- types.ts, index.ts, expo.ts, console.ts
- Console adapter default (dev works without credentials)
- Expo adapter when PUSH_PROVIDER=expo

### Notification Service
- `packages/api/src/services/notifications/index.ts`
- `sendNotification(db, pubsub, { userId | userIds }, payload)` -- explicit injection, not globals
- `broadcastNotification(db, pubsub, payload)`
- Handles: DB insert, SyncEvent publish, push token lookup, opt-out check, push delivery

### tRPC Router
- `notificationRouter`: list (paginated), unreadCount, markRead, markUnread, markAllRead, onSync, registerPushToken, updatePushOptOut

### Client Hooks
- `useNotifications()` -- paginated list + sync + mutations + unreadCount
- `useNotificationToast()` -- decoupled toast trigger on sync events

### UI
- Web: toast component, notification section in profile, unread badge in navbar
- Mobile: push token registration on launch, notification screen in profile, toast on foregrounded, push opt-out toggle

## Security Considerations
- All endpoints use protectedProcedure (JWT required)
- Users can only access their own notifications (filter by ctx.user.sub)
- markRead/markUnread verify ownership
- broadcastNotification is admin-only
- actionUrl validated to prevent open redirects
- Push tokens upserted, stale tokens cleaned on DeviceNotRegistered
- EXPO_ACCESS_TOKEN stored as K8s secret, never committed

## DevOps & Deployment
- No new infrastructure (uses existing Postgres + Expo hosted API)
- Migration additive (new tables + column) -- reversible
- New env vars: PUSH_PROVIDER (optional), EXPO_ACCESS_TOKEN (optional)
- Existing deploy pipelines handle everything
- Standard K8s rollback works

## init.sh Integration
- Optional flags: --expo-token, --apns-key-path, --apns-key-id, --apns-team-id, --google-services-path
- When credentials provided: runs eas project:init, uploads APNs key, copies google-services.json, sets PUSH_PROVIDER=expo
- When credentials absent: skips gracefully, console adapter (no push, toasts still work)
- No interactive prompts -- fully autonomous
