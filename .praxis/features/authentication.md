# Authentication

Auth0 is integrated across all three platforms. The web and mobile apps handle login flows and token management. The API verifies JWTs on every request.

## Architecture

```
Web (Auth0 React SDK)  ─── Bearer token ──→  API (jose JWKS verification)
Mobile (expo-auth-session) ─── Bearer token ──→  API
```

Tokens are audience-scoped JWTs signed by Auth0. The API fetches Auth0's JWKS to verify signatures — no shared secret needed.

## Web Authentication

Auth0Provider wraps the entire app in `packages/web/src/main.tsx`:

```typescript
<Auth0Provider
  domain={import.meta.env.VITE_AUTH0_DOMAIN}
  clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
  cacheLocation="localstorage"
  authorizationParams={{
    redirect_uri: window.location.origin,
    audience: import.meta.env.VITE_AUTH0_AUDIENCE,
  }}
>
```

`cacheLocation="localstorage"` ensures tokens persist across page redirects (the Auth0 login callback). Without it, tokens are stored in-memory and lost during the redirect, causing a race condition where `getAccessTokenSilently()` fails immediately after login.

The `TRPCProvider` attaches tokens to every request and uses a `splitLink` to route subscriptions over WebSocket and queries/mutations over HTTP:

```typescript
// hooks/src/providers/TRPCProvider.tsx
const wsClient = createWSClient({
  url: deriveWsUrl(apiUrl),
  connectionParams: async () => {
    try {
      const token = await getAccessToken();
      return { token };
    } catch {
      return {};
    }
  },
});

return trpc.createClient({
  links: [
    splitLink({
      condition: (op) => op.type === "subscription",
      true: wsLink({ client: wsClient }),
      false: httpBatchLink({
        url: apiUrl,
        async headers() {
          try {
            const token = await getAccessToken();
            return { Authorization: `Bearer ${token}` };
          } catch {
            return {};
          }
        },
      }),
    }),
  ],
});
```

HTTP requests send the token as a `Bearer` header. WebSocket connections send it via `connectionParams`, which the API reads in `createWSContextFactory` (see `context.ts`).

**Using auth in components:**

```typescript
import { useAuth0 } from "@auth0/auth0-react";

function MyComponent() {
  const { isAuthenticated, user, loginWithRedirect, logout } = useAuth0();
  // user.email, user.name, user.picture, etc.
}
```

**Protecting a route:**

```typescript
// packages/web/src/App.tsx
<Route
  path="/profile"
  element={
    <AuthGuard>
      <Profile />
    </AuthGuard>
  }
/>
```

`AuthGuard` redirects unauthenticated users to Auth0 login and shows a loading state while checking.

## Mobile Authentication

Uses `expo-auth-session` with PKCE flow. Tokens are stored in `expo-secure-store`.

```typescript
// packages/mobile/src/lib/auth.ts
import { getValidAccessToken } from "../lib/auth";

// Auto-refreshes if expired (60s buffer)
const token = await getValidAccessToken();
```

The `AuthContext` provider (`mobile/src/contexts/AuthContext.tsx`) wraps the app and exposes `getAccessToken` for tRPC.

## API Verification

```typescript
// packages/api/src/middleware/auth.ts
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getEnv } from "../lib/env.js";

let JWKS: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!JWKS) {
    const { AUTH0_ISSUER_BASE_URL } = getEnv();
    JWKS = createRemoteJWKSet(
      new URL(`${AUTH0_ISSUER_BASE_URL}/.well-known/jwks.json`)
    );
  }
  return JWKS;
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { AUTH0_ISSUER_BASE_URL, AUTH0_AUDIENCE } = getEnv();
    const { payload } = await jwtVerify(token, getJWKS(), {
      issuer: `${AUTH0_ISSUER_BASE_URL}/`,
      audience: AUTH0_AUDIENCE,
    });
    return payload;
  } catch {
    return null;
  }
}
```

The context factory extracts the Bearer token from the request and calls `verifyToken`. The result lands on `ctx.user`:

```typescript
// packages/api/src/context.ts
const authHeader = req.headers.authorization;
if (authHeader?.startsWith("Bearer ")) {
  user = await verifyToken(authHeader.slice(7));
}
return { user, db, pubsub };
```

## How to Implement Auth in a New Procedure

Use `protectedProcedure` instead of `publicProcedure`:

```typescript
import { protectedProcedure } from "../trpc.js";

mySecureEndpoint: protectedProcedure.mutation(async ({ ctx }) => {
  // ctx.user is the raw JWT payload (guaranteed non-null)
  // ctx.dbUser is the users table row resolved from ctx.user.sub (may be null for new users)
  const sub = ctx.user.sub; // Auth0 user ID (always present)
  const dbUser = ctx.dbUser; // DB row or null
  // ...
}),
```

> **Note:** `ctx.user` is the raw `JWTPayload` from `jose`. Auth0 access tokens with a custom audience only include standard claims (`sub`, `iss`, `aud`, `exp`) — the `email` claim is NOT present. Use `ctx.dbUser` to get user details from the database. The middleware automatically looks up the user by `sub` on every authenticated request.

> **Note:** `ctx.dbUser` is `null` for brand-new users who haven't called `user.create` yet. Routes that require a DB user should check for this (e.g., notification routes throw `NOT_FOUND`).

For public endpoints that optionally use auth:

```typescript
maybeAuthEndpoint: publicProcedure.query(async ({ ctx }) => {
  if (ctx.user) {
    // authenticated — personalize
  } else {
    // anonymous — return public data
  }
}),
```

## How to Test

Mock both `getEnv` (from `packages/api/src/lib/env.ts`) and `jose` — the auth middleware calls `getEnv()` at runtime to read env vars, so you mock the module rather than setting `process.env` directly:

```typescript
// packages/api/src/middleware/auth.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/env.js", () => ({
  getEnv: vi.fn(() => ({
    AUTH0_ISSUER_BASE_URL: "https://test.auth0.com",
    AUTH0_AUDIENCE: "https://api.test.com",
  })),
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock-jwks"),
  jwtVerify: vi.fn(),
}));

import { verifyToken } from "./auth.js";
import { jwtVerify } from "jose";

const mockJwtVerify = vi.mocked(jwtVerify);

describe("verifyToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns payload for valid token", async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: "user123", email: "test@example.com" },
      protectedHeader: { alg: "RS256" },
    } as any);

    const result = await verifyToken("valid-token");
    expect(result).toEqual({ sub: "user123", email: "test@example.com" });
  });

  it("returns null for invalid token", async () => {
    mockJwtVerify.mockRejectedValueOnce(new Error("invalid"));
    expect(await verifyToken("bad")).toBeNull();
  });
});
```

For router tests, mock the whole auth chain and pass `user` directly in the context:

```typescript
const caller = appRouter.createCaller({
  user: { sub: "user1", email: "test@test.com" },  // or null for unauthenticated
  db: mockDb as any,
  pubsub: mockPubsub as any,
});
```

## How to Debug

- **401 on every request?** Check that `AUTH0_ISSUER_BASE_URL` and `AUTH0_AUDIENCE` env vars match your Auth0 config. The audience must match exactly.
- **Token not sent?** Open DevTools Network tab, check the Authorization header on tRPC requests. If missing, the `getAccessToken()` call in TRPCProvider is failing silently — it catches errors and returns empty headers.
- **"Invalid audience" from jose?** The audience in the JWT must match `AUTH0_AUDIENCE` exactly. Check with `jwt.io` to decode the token and compare.
- **JWKS fetch fails?** The API needs outbound HTTPS access to `{AUTH0_ISSUER_BASE_URL}/.well-known/jwks.json`. Check DNS/firewall if in a restricted environment.
- **Mobile token expired?** `getValidAccessToken()` auto-refreshes with a 60s buffer, but if the refresh token is also expired, it throws. Catch it and re-prompt login.
