# Plan: Convert Web to React + Add Expo Mobile App

## Context

The template currently has a Vue 3 web frontend. We're adding an Expo (React Native) mobile app targeting iOS with native capabilities (HealthKit, notifications, calendar, offline files). Since both web and mobile will use React, we're converting the web package from Vue to React and extracting shared hooks into a common package. The API and shared packages remain unchanged.

## Target Structure

```
packages/
  api/        (unchanged)
  shared/     (unchanged)
  hooks/      (NEW — shared tRPC + React Query hooks)
  web/        (REWRITE — Vue -> React + Vite + Tailwind)
  mobile/     (NEW — Expo + React Native)
```

---

## Step 1: Create `packages/hooks`

Shared React hooks package consumed by both web and mobile. The key design: `TRPCProvider` accepts a configurable `apiUrl` (web passes `"/api/trpc"`, mobile passes an absolute URL) and `getAccessToken` callback.

### Files to create:
- `packages/hooks/package.json` — deps: `@trpc/client`, `@trpc/react-query`, `@tanstack/react-query`, `react`; devDeps: `@wanshitong/api`, `@wanshitong/shared`, `@types/react`, `typescript`
- `packages/hooks/tsconfig.json` — extends base, `jsx: "react-jsx"`, composite, references shared + api
- `packages/hooks/src/trpc.ts` — `createTRPCReact<AppRouter>()` export (typed tRPC React hooks)
- `packages/hooks/src/providers/TRPCProvider.tsx` — wraps `trpc.Provider` + `QueryClientProvider`, accepts `apiUrl` and `getAccessToken` props, injects Bearer token via `httpBatchLink` headers
- `packages/hooks/src/hooks/useUsers.ts` — `useUsers()` hook using `trpc.user.list.useQuery()`, `trpc.user.create.useMutation()`, `trpc.user.delete.useMutation()` with cache invalidation via `trpc.useUtils()`
- `packages/hooks/src/index.ts` — barrel export of `trpc`, `TRPCProvider`, `useUsers`

### Verify:
- `pnpm install && pnpm --filter @wanshitong/hooks build` compiles cleanly

---

## Step 2: Convert `packages/web` from Vue to React

Functionally equivalent rewrite. Same 3 routes, same Auth0 integration, same tRPC usage — but now using React, `@auth0/auth0-react`, `react-router-dom`, and Tailwind CSS v4.

### Files to DELETE:
- `src/main.ts`, `src/App.vue`, `src/components/NavBar.vue`
- `src/views/Home.vue`, `src/views/Profile.vue`, `src/views/Users.vue`
- `src/lib/trpc.ts` (moved to hooks package)
- `src/router/index.ts` (routing is inline in App.tsx)

### Files to create/replace:
- `package.json` — remove vue/vue-router/@auth0/auth0-vue/vue-tsc/@vitejs/plugin-vue/@tanstack/vue-query; add react/react-dom/react-router-dom/@auth0/auth0-react/@wanshitong/hooks/@vitejs/plugin-react/tailwindcss/@tailwindcss/vite
- `tsconfig.json` — `jsx: "react-jsx"`, remove `.vue` includes, add `.tsx`, add hooks reference
- `vite.config.ts` — `@vitejs/plugin-react` + `@tailwindcss/vite` instead of vue plugin
- `env.d.ts` — same env vars, remove `*.vue` module declaration
- `index.html` — `id="root"`, `src="/src/main.tsx"`
- `src/main.tsx` — `ReactDOM.createRoot`, wrap with `Auth0Provider` + `BrowserRouter`
- `src/index.css` — `@import "tailwindcss"` (v4 entry point)
- `src/App.tsx` — `TRPCProvider` from hooks (apiUrl=`"/api/trpc"`, getAccessToken from `useAuth0`), `Routes` with 3 `Route` elements
- `src/components/AuthGuard.tsx` — replaces `createAuthGuard()`, redirects to login if not authenticated
- `src/components/NavBar.tsx` — nav links + login/logout using `useAuth0()`, Tailwind classes
- `src/views/Home.tsx` — feature cards, Tailwind styling
- `src/views/Profile.tsx` — Auth0 user info display
- `src/views/Users.tsx` — uses `useUsers()` from `@wanshitong/hooks` for CRUD

### Files to modify:
- `Dockerfile` — add `COPY packages/hooks/...` lines and `pnpm --filter @wanshitong/hooks build` step
- `web-server.js` — no changes needed

### Verify:
- `pnpm dev` — all 3 routes render, Auth0 login/logout works, tRPC CRUD works
- `docker build -f packages/web/Dockerfile .` — builds successfully

---

## Step 3: Update CI/CD and init.sh

### `.github/workflows/deploy-web.yml`:
- Add `packages/hooks/**` to paths trigger list

### `scripts/init.sh`:
- Add `.tsx` to the `find` command in Step 1 (template placeholder replacement)
- Add mobile scheme (`template-mobile://`) to Auth0 callback URLs in Step 5

---

## Step 4: Create `packages/mobile`

Expo React Native app with Expo Router (file-based routing, tab navigation).

### Initialize:
```bash
cd packages && npx create-expo-app@latest mobile --template blank-typescript
```

Then customize:

### Auth0 approach:
- Uses `expo-auth-session` (PKCE flow) + `expo-secure-store` for token storage — NOT `@auth0/auth0-react` (requires browser DOM)
- Same Auth0 SPA app as web — just add mobile scheme to allowed callback URLs
- `src/lib/auth.ts` — auth request config, code exchange, token refresh, secure storage
- `src/contexts/AuthContext.tsx` — `AuthProvider` + `useAuth()` hook wrapping the auth module

### Expo Router structure:
- `app/_layout.tsx` — root layout: `AuthProvider` > `TRPCProvider` (apiUrl = absolute project URL) > `Stack`
- `app/(tabs)/_layout.tsx` — tab navigator: Home, Users, Health, Profile
- `app/(tabs)/index.tsx` — home screen
- `app/(tabs)/users.tsx` — uses `useUsers()` from `@wanshitong/hooks` (shared with web)
- `app/(tabs)/health.tsx` — HealthKit via `react-native-healthkit` (request auth, read step count)
- `app/(tabs)/profile.tsx` — auth state, login/logout, user info

### Native capability modules:
- `src/lib/notifications.ts` — `expo-notifications`: permission request, push token registration, notification listeners
- `src/lib/calendar.ts` — `expo-calendar`: permission request, create app calendar, create events
- `src/lib/downloads.ts` — `expo-file-system`: download with progress, list/delete downloaded files

### Config files:
- `app.json` — bundle ID, iOS entitlements (HealthKit, background delivery), plugin config for expo-router/expo-notifications/react-native-healthkit/expo-calendar/expo-secure-store
- `eas.json` — development/preview/production build profiles
- `metro.config.js` — monorepo resolution (watchFolders = workspace root, nodeModulesPaths includes root)
- `tsconfig.json` — extends `expo/tsconfig.base` (NOT the monorepo base — Metro has different TS requirements)

### Key dependencies:
- `@wanshitong/hooks`, `@wanshitong/shared`
- `expo`, `expo-router`, `react`, `react-native`
- `expo-auth-session`, `expo-web-browser`, `expo-secure-store`, `expo-crypto`
- `expo-notifications`, `expo-calendar`, `expo-file-system`, `expo-constants`
- `react-native-healthkit` (requires dev build, not Expo Go)
- `react-native-safe-area-context`, `react-native-screens`

### Important note:
`react-native-healthkit` is a native module, so development must use **Expo dev builds** (`expo prebuild` + `eas build --profile development`), not Expo Go.

### Verify:
- `npx expo prebuild --platform ios` generates Xcode project
- `npx expo run:ios` runs on simulator
- Auth0 login flow completes
- tRPC calls work (user list, create)
- HealthKit permission prompt appears (simulator or device)

---

## Step 5: Mobile CI/CD (optional, can defer)

- `eas init` to create EAS project
- `eas build --platform ios --profile development` for first build
- Optionally add `.github/workflows/deploy-mobile.yml` using `eas update` for OTA JS updates (triggers on changes to mobile/hooks/shared)

---

## Key Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| tRPC client ownership | `hooks` package exports configurable `TRPCProvider` | Web uses relative `/api/trpc`, mobile uses absolute URL |
| Auth0 on web | `@auth0/auth0-react` (redirect) | Standard SPA pattern |
| Auth0 on mobile | `expo-auth-session` (PKCE) + `expo-secure-store` | Can't use browser-based SDK in React Native |
| Auth0 app | Same SPA app for both | Simpler; just add mobile scheme to callbacks |
| HealthKit | `react-native-healthkit` | Most mature iOS HealthKit lib for RN; `expo-health-connect` is Android-only |
| Web styling | Tailwind CSS v4 (`@tailwindcss/vite`) | Modern, utility-first |
| Mobile styling | React Native `StyleSheet` | Separate from web; no shared styles |
| Mobile navigation | Expo Router (file-based) | Expo's default, modern approach |
| Mobile builds | EAS Build (cloud) | Handles signing/provisioning; doesn't use self-hosted runner |

## Prerequisites

- Apple Developer Account ($99/year) for App Store / TestFlight
- EAS account (free tier: 15 iOS builds/month)
