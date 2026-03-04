# Mobile App

Expo Router (React Native) with Auth0, tRPC hooks (shared with web), and scaffolds for push notifications, calendar, and file downloads.

## Structure

```
packages/mobile/
  app/
    _layout.tsx              — Root layout: AuthProvider + TRPCProvider
    (tabs)/
      _layout.tsx            — Tab navigator
      index.tsx              — Home tab
      users.tsx              — Users tab (same data as web)
      profile.tsx            — Profile tab
      health.tsx             — HealthKit tab (Apple Health step data)
  src/
    contexts/AuthContext.tsx  — Auth state + getAccessToken
    lib/
      auth.ts                — Auth0 PKCE flow, token storage, refresh
      notifications.ts       — Push notification registration + listeners
      calendar.ts            — Calendar access scaffold
      downloads.ts           — File download scaffold
```

## How It's Wired

The mobile app shares the same `@wanshitong/hooks` package as the web app:

```typescript
// packages/mobile/app/_layout.tsx
import { TRPCProvider } from "@wanshitong/hooks";
import { AuthProvider, useAuth } from "../src/contexts/AuthContext";

function AppInner() {
  const { getAccessToken } = useAuth();
  return (
    <TRPCProvider apiUrl={API_URL} getAccessToken={getAccessToken}>
      <Stack />
    </TRPCProvider>
  );
}
```

This means all tRPC queries, mutations, and subscriptions work identically on mobile. `useUsers()`, `trpc.admin.listUsers.useQuery()`, etc. — same hooks, same types.

## Authentication

PKCE flow via `expo-auth-session` + `expo-secure-store` (no Auth0-specific SDK). The mobile app implements the OAuth2 PKCE authorization code flow directly against Auth0 endpoints using Expo's generic auth session library:

```typescript
// packages/mobile/src/lib/auth.ts

// Get a valid token (auto-refreshes if expired)
const token = await getValidAccessToken();

// Clear all tokens (logout)
await clearTokens();

// Exchange auth code for tokens (after login redirect)
const tokens = await exchangeCodeForTokens(code, codeVerifier);
```

The `AuthContext` wraps the app and exposes auth state:

```typescript
const { isAuthenticated, isLoading, user, login, logout, getAccessToken } = useAuth();
```

## How to Implement

### Add a new tab

#### 1. Create the screen

Note: Expo Router requires `export default` for route files. This is the one exception to the project's "named exports only" guideline — it's a framework requirement. Non-route files (contexts, lib, hooks) use named exports as usual.

```typescript
// packages/mobile/app/(tabs)/settings.tsx
import { View, Text } from "react-native";
import { trpc } from "@wanshitong/hooks";

export default function Settings() {
  // Same tRPC hooks as web
  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 24, fontWeight: "bold" }}>Settings</Text>
    </View>
  );
}
```

#### 2. Add to the tab layout

Icons use Ionicons from `@expo/vector-icons` (bundled with Expo, no extra install needed). Browse available icon names at [icons.expo.fyi](https://icons.expo.fyi).

```typescript
// packages/mobile/app/(tabs)/_layout.tsx
import Ionicons from "@expo/vector-icons/Ionicons";

<Tabs.Screen
  name="settings"
  options={{
    title: "Settings",
    tabBarIcon: ({ color, size }) => (
      <Ionicons name="cog" size={size} color={color} />
    ),
  }}
/>
```

### Use push notifications

The client-side utilities in `packages/mobile/src/lib/notifications.ts` are ready to use -- they handle permission requests, token retrieval, and notification listeners. You'll need to create the server-side procedure to store tokens.

```typescript
import { registerForPushNotifications, addNotificationListeners } from "../lib/notifications";
import { useEffect } from "react";

function App() {
  useEffect(() => {
    registerForPushNotifications().then((token) => {
      if (token) {
        // TODO: registerPushToken does not exist yet -- you'll need to create
        // this mutation in the user router (or a dedicated notifications router).
        trpc.user.registerPushToken.mutate({ token });
      }
    });

    const cleanup = addNotificationListeners();
    return cleanup;
  }, []);
}
```

### Use calendar

The calendar scaffold (`packages/mobile/src/lib/calendar.ts`) creates a dedicated "Template App" calendar with platform-specific source handling for iOS (iCloud) vs Android (local account):

```typescript
import { getCalendarPermission, createEvent } from "../lib/calendar";

async function addMeeting() {
  const granted = await getCalendarPermission();
  if (!granted) return;

  // createEvent uses getOrCreateAppCalendar() under the hood, which:
  // - Looks for an existing "Template App" calendar
  // - If not found, creates one using the iCloud source on iOS
  //   or a local account source on Android
  const eventId = await createEvent(
    "Meeting",
    new Date(),
    new Date(Date.now() + 60 * 60 * 1000),
  );
}
```

### Use file downloads

```typescript
import { Paths, File, Directory } from "expo-file-system/next";

const DOWNLOAD_DIR = new Directory(Paths.document, "downloads");

async function downloadFile(url: string, filename: string): Promise<string> {
  if (!DOWNLOAD_DIR.exists) DOWNLOAD_DIR.create();
  const file = new File(DOWNLOAD_DIR, filename);

  const response = await fetch(url);
  if (!response.ok) throw new Error("Download failed");

  const blob = await response.blob();
  file.write(new Uint8Array(await blob.arrayBuffer()));

  return file.uri;
}
```

## Building to a Physical Device

Running on a physical iPhone requires a one-time setup of Xcode signing and device configuration. After that, builds are fast and unlimited (no EAS credits needed).

### One-time setup (per machine)

#### 1. Xcode signing certificate

Open Xcode (just the app, no project needed):

1. **Xcode > Settings > Accounts** (Cmd+,)
2. Click **+** to add your Apple Developer account if not already added
3. Select your account, click **Manage Certificates**
4. Click **+** and choose **Apple Development**

#### 2. Enable Developer Mode on your iPhone

On your iPhone:

1. **Settings > Privacy & Security**
2. Scroll to the bottom, toggle **Developer Mode** on
3. Phone restarts — confirm the prompt after restart

#### 3. Register your device to your Apple Developer account

When Xcode builds, it creates a provisioning profile for your app. Your iPhone must be registered in that profile:

1. Open the `.xcworkspace` in Xcode (generated by `npx expo prebuild`)
2. Select the project > target > **Signing & Capabilities**
3. Ensure **Automatically manage signing** is checked and your team is selected
4. If Xcode shows an error about the device not being registered, click it — Xcode offers to register automatically
5. Alternatively: plug in your phone, go to **Window > Devices and Simulators**, and add it there

#### 4. Trust the developer certificate on your iPhone

After your first build installs, your phone may block it:

1. **Settings > General > VPN & Device Management**
2. Tap your developer account under "Developer App"
3. Tap **Trust**

### One-time setup (per project)

#### 5. Install expo-dev-client

Development builds (as opposed to Expo Go) require the `expo-dev-client` package. This enables the custom dev client that supports native modules like push notifications:

```bash
cd packages/mobile
npx expo install expo-dev-client
```

#### 6. Generate the native iOS project

```bash
cd packages/mobile
npx expo prebuild --platform ios
```

This creates the `ios/` directory with an Xcode workspace. If you ever need to regenerate it (e.g., after adding a new native plugin), run `npx expo prebuild --clean`.

#### 7. Configure signing in Xcode

```bash
open ios/*.xcworkspace
```

In Xcode:
1. Select the **project** in the left sidebar (top item)
2. Select your **app target** under Targets
3. Go to **Signing & Capabilities** tab
4. Check **Automatically manage signing**
5. Select your **Team** from the dropdown (the Apple Developer account with your APNs key)
6. If Xcode shows a device registration error, click it to register your device automatically
7. Close Xcode

### Build and run

Plug your iPhone in via USB, then:

```bash
cd packages/mobile
npx expo run:ios --device
```

This builds the native app, installs it on your phone, and starts the development server. First build takes a few minutes (compiling native modules). Subsequent builds are fast.

After the app installs and launches, it connects to the dev server automatically. If it shows "no development servers found", the dev server may not have started — run it manually:

```bash
cd packages/mobile
npx expo start --dev-client
```

Then scan the QR code shown in the terminal with your phone's camera to connect.

### If you build from Xcode directly

If you build and run from Xcode (instead of `npx expo run:ios --device`), the dev server does **not** start automatically. You must start it yourself:

```bash
cd packages/mobile
npx expo start --dev-client
```

Then open the app on your phone and scan the QR code, or the app will find the server on the local network automatically.

### Development workflow

| Command | What it does |
|---|---|
| `npx expo start` | Start dev server — use with Expo Go (no push notifications) |
| `npx expo start --dev-client` | Start dev server — use with development builds (push works) |
| `npx expo run:ios --device` | Build + install + start dev server on plugged-in iPhone |
| `npx expo run:ios` | Build + run on iOS Simulator (no push notifications) |
| `npx eas-cli build --profile development --platform ios` | Cloud build via EAS (30 free/month) |

**Which to use:**

- **Day-to-day UI work**: `npx expo start` with Expo Go — instant reload, no build step, but no native modules (no push notifications, no HealthKit)
- **Testing push notifications or native features**: `npx expo run:ios --device` — builds to your phone with full native module support
- **Already built, just need to reconnect**: `npx expo start --dev-client` — starts the dev server without rebuilding; the app on your phone finds it automatically or via QR code

## How to Test

Mobile testing typically uses:
- **Jest + React Native Testing Library** for component tests
- **Detox** or **Maestro** for E2E tests on simulators

The mobile package doesn't have test infra set up yet. To add it:

```bash
pnpm --filter @wanshitong/mobile add -D jest @testing-library/react-native
```

For tRPC logic, test the shared hooks in the `hooks` package instead — the mobile app consumes them identically to web.

## How to Debug

- **"No development servers found"?** The dev server isn't running. Run `npx expo start --dev-client` in the mobile package directory. If on a different network, try `npx expo start --dev-client --tunnel`.
- **"Network request failed"?** The API URL in `app.json` must be reachable from the device/simulator. For local dev, use your machine's LAN IP (not `localhost`), e.g., `http://192.168.1.100:3001/api/trpc`.
- **Auth redirect not returning to app?** Check that the custom scheme (`TEMPLATE_SCHEME`) matches what's configured in Auth0 callback URLs and in `app.json`.
- **Token refresh failing?** `getValidAccessToken()` tries to refresh silently. If the refresh token is expired, it throws. Catch it and re-trigger the login flow.
- **Push notifications not working on iOS simulator?** Push notifications don't work on iOS simulators — you must test on a physical device. See [Building to a Physical Device](#building-to-a-physical-device) above.
- **Build fails with "no code signing certificates"?** Open Xcode > Settings > Accounts, select your account, Manage Certificates, and create an Apple Development certificate.
- **Build fails with "Developer Mode disabled"?** On your iPhone: Settings > Privacy & Security > Developer Mode > toggle on. Phone will restart.
- **Build fails with "device not in provisioning profile"?** Open the `.xcworkspace` in Xcode, go to Signing & Capabilities, and Xcode will offer to register the device. See step 3 in per-machine setup.
- **App installs but won't open ("Untrusted Developer")?** On your iPhone: Settings > General > VPN & Device Management > tap your developer account > Trust.
- **Expo prebuild issues?** Run `pnpm mobile:prebuild` to regenerate native projects. If that fails, try `npx expo prebuild --clean`.
- **Types out of date?** The mobile app imports from `@wanshitong/hooks` which imports types from `@wanshitong/api`. Run `pnpm build` to rebuild the type chain.
