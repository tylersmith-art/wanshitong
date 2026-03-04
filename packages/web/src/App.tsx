import { useAuth0 } from "@auth0/auth0-react";
import { Routes, Route } from "react-router-dom";
import { TRPCProvider, useSessionSync } from "@template/hooks";
import { NavBar } from "./components/NavBar.js";
import { NotificationToast } from "./components/NotificationToast.js";
import { Home } from "./views/Home.js";
import { Profile } from "./views/Profile.js";
import { Users } from "./views/Users.js";
import { Admin } from "./views/Admin.js";
import { AuthGuard } from "./components/AuthGuard.js";

function SessionSync() {
  const { user } = useAuth0();
  useSessionSync(user ?? null);
  return null;
}

export function App() {
  const { isAuthenticated, isLoading, getAccessTokenSilently } = useAuth0();

  const getAccessToken = async () => {
    return getAccessTokenSilently();
  };

  return (
    <TRPCProvider apiUrl="/api/trpc" getAccessToken={getAccessToken}>
      {!isLoading && isAuthenticated && <SessionSync />}
      <NavBar />
      {!isLoading && isAuthenticated && <NotificationToast />}
      <main className="max-w-[960px] mx-auto px-4 py-8">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route
            path="/profile"
            element={
              <AuthGuard>
                <Profile />
              </AuthGuard>
            }
          />
          <Route
            path="/users"
            element={
              <AuthGuard>
                <Users />
              </AuthGuard>
            }
          />
          <Route
            path="/admin"
            element={
              <AuthGuard>
                <Admin />
              </AuthGuard>
            }
          />
        </Routes>
      </main>
    </TRPCProvider>
  );
}
