# Web App

React 19 SPA built with Vite, styled with TailwindCSS v4, using React Router v7 for navigation and tRPC + React Query for data fetching.

## Structure

```
packages/web/src/
  main.tsx           — App entry, Auth0Provider + BrowserRouter
  App.tsx            — Route definitions, TRPCProvider
  components/
    NavBar.tsx       — Navigation with auth-aware links
    AuthGuard.tsx    — Redirect to login for protected routes
  views/
    Home.tsx         — Landing page
    Users.tsx        — Create + list users (hook also exposes delete; real-time sync via subscription)
    Profile.tsx      — Auth0 user info
    Admin.tsx        — User management (admin only)
```

## How to Implement

### Add a new page

#### 1. Create the view

```typescript
// packages/web/src/views/Directory.tsx
import { trpc } from "@wanshitong/hooks";

export function Directory() {
  // Use tRPC hooks for data
  const { data: users, isLoading } = trpc.user.list.useQuery();

  if (isLoading) return <p>Loading...</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Directory</h1>
      <ul>
        {users?.map((u) => (
          <li key={u.email}>{u.name} — {u.email}</li>
        ))}
      </ul>
    </div>
  );
}
```

#### 2. Add the route

```typescript
// packages/web/src/App.tsx
import { Directory } from "./views/Directory.js";

<Routes>
  {/* ...existing routes... */}
  <Route
    path="/directory"
    element={
      <AuthGuard>        {/* remove AuthGuard if the page is public */}
        <Directory />
      </AuthGuard>
    }
  />
</Routes>
```

#### 3. Add a nav link

```typescript
// packages/web/src/components/NavBar.tsx — inside the nav links div
{isAuthenticated && (
  <Link
    to="/directory"
    className={`no-underline font-medium ${isActive("/directory") ? "text-gray-900" : "text-gray-500"}`}
  >
    Directory
  </Link>
)}
```

### Calling the API

```typescript
import { trpc } from "@wanshitong/hooks";

// Query (GET)
const { data, isLoading, error } = trpc.user.list.useQuery();

// Mutation (POST)
const create = trpc.user.create.useMutation({
  onSuccess: () => utils.user.list.invalidate(),
});
await create.mutateAsync({ name: "Alice", email: "a@b.com" });

// Subscription (WebSocket)
// The server wraps each event with tRPC's tracked(), so the real payload is at event.data.
trpc.user.onSync.useSubscription(undefined, {
  onData(event) {
    const { action, data } = event.data as unknown as SyncEvent<SerializedUser>;
    // handle real-time update based on action ("created" | "updated" | "deleted")
  },
});
```

### Using shared hooks

```typescript
import { useUsers } from "@wanshitong/hooks";

function MyComponent() {
  const { users, isLoading, error, createUser, deleteUser, isCreating, isDeleting } = useUsers();
  // useUsers already handles real-time sync
}
```

### Styling

TailwindCSS v4 via Vite plugin. No config file needed — use utility classes directly:

```tsx
<div className="max-w-[960px] mx-auto px-4 py-8">
  <h1 className="text-2xl font-bold mb-4">Title</h1>
  <p className="text-gray-500 text-sm">Description</p>
  <button className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">
    Action
  </button>
</div>
```

### Auth-conditional UI

```typescript
import { useAuth0 } from "@auth0/auth0-react";

const { isAuthenticated, isLoading, user } = useAuth0();

// Show different content based on auth state
{isAuthenticated ? (
  <p>Welcome, {user?.name}</p>
) : (
  <p>Please log in</p>
)}
```

## How to Test

The web package does not have tests yet -- the `test` script is a no-op placeholder. The steps below are optional future setup for adding component testing:

1. Install test dependencies: `pnpm --filter @wanshitong/web add -D vitest @testing-library/react @testing-library/jest-dom jsdom`
2. Create `packages/web/vitest.config.ts` with `environment: "jsdom"`
3. Write tests:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Home } from "./Home";

// You'll need to mock Auth0 and wrap in providers
describe("Home", () => {
  it("renders the title", () => {
    render(<Home />);  // needs Auth0 + Router providers
    expect(screen.getByText("Template App")).toBeInTheDocument();
  });
});
```

## How to Debug

- **Blank page?** Check the browser console for errors. Most common: missing env vars (`VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`).
- **tRPC calls failing?** Check the Network tab. If requests go to `/api/trpc` and return 404, the Vite dev proxy isn't running or misconfigured. In production, check that the API is up and CORS allows the web origin.
- **Types out of date?** Run `pnpm build --filter=@wanshitong/shared --filter=@wanshitong/api --filter=@wanshitong/hooks`. The web package reads types from the compiled output of other packages.
- **Auth redirect loop?** Usually a misconfigured callback URL in Auth0. The redirect_uri must match `window.location.origin` exactly.
- **Styles not applying?** TailwindCSS v4 uses `@import "tailwindcss"` in the CSS file. Make sure `packages/web/src/index.css` has this import and the Vite Tailwind plugin is in `vite.config.ts`.
- **HMR not working?** Vite HMR should work out of the box. If not, check for syntax errors that prevent the module from loading.
