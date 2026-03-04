import { useAuth0 } from "@auth0/auth0-react";
import { Routes, Route } from "react-router-dom";
import { TRPCProvider, useSessionSync } from "@wanshitong/hooks";
import { NavBar } from "./components/NavBar.js";
import { NotificationToast } from "./components/NotificationToast.js";
import { Home } from "./views/Home.js";
import { Profile } from "./views/Profile.js";
import { Users } from "./views/Users.js";
import { Organizations } from "./views/Organizations.js";
import { OrgDetail } from "./views/OrgDetail.js";
import { ApiKeys } from "./views/ApiKeys.js";
import { Specs } from "./views/Specs.js";
import { SpecDetail } from "./views/SpecDetail.js";
import { SpecEditor } from "./views/SpecEditor.js";
import { Projects } from "./views/Projects.js";
import { ProjectDetail } from "./views/ProjectDetail.js";
import { Admin } from "./views/Admin.js";
import { Search } from "./views/Search.js";
import { QueryLogs } from "./views/QueryLogs.js";
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
            path="/orgs"
            element={
              <AuthGuard>
                <Organizations />
              </AuthGuard>
            }
          />
          <Route
            path="/orgs/:id"
            element={
              <AuthGuard>
                <OrgDetail />
              </AuthGuard>
            }
          />
          <Route
            path="/api-keys"
            element={
              <AuthGuard>
                <ApiKeys />
              </AuthGuard>
            }
          />
          <Route
            path="/specs"
            element={
              <AuthGuard>
                <Specs />
              </AuthGuard>
            }
          />
          <Route
            path="/specs/new"
            element={
              <AuthGuard>
                <SpecEditor />
              </AuthGuard>
            }
          />
          <Route
            path="/specs/:id"
            element={
              <AuthGuard>
                <SpecDetail />
              </AuthGuard>
            }
          />
          <Route
            path="/specs/:id/edit"
            element={
              <AuthGuard>
                <SpecEditor />
              </AuthGuard>
            }
          />
          <Route
            path="/projects"
            element={
              <AuthGuard>
                <Projects />
              </AuthGuard>
            }
          />
          <Route
            path="/projects/:id"
            element={
              <AuthGuard>
                <ProjectDetail />
              </AuthGuard>
            }
          />
          <Route
            path="/search"
            element={
              <AuthGuard>
                <Search />
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
          <Route
            path="/admin/query-logs"
            element={
              <AuthGuard>
                <QueryLogs />
              </AuthGuard>
            }
          />
        </Routes>
      </main>
    </TRPCProvider>
  );
}
