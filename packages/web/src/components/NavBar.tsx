import { useAuth0 } from "@auth0/auth0-react";
import { Link, useLocation } from "react-router-dom";
import { trpc } from "@wanshitong/hooks";

export function NavBar() {
  const { isAuthenticated, isLoading, user, loginWithRedirect, logout } =
    useAuth0();
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  const { data: unreadData } = trpc.notification.unreadCount.useQuery(
    undefined,
    { enabled: isAuthenticated },
  );
  const unreadCount = unreadData?.count ?? 0;

  return (
    <nav className="bg-white border-b border-gray-200 px-4">
      <div className="max-w-[960px] mx-auto flex justify-between items-center h-14">
        <div className="flex gap-6">
          <Link
            to="/"
            className={`no-underline font-medium ${isActive("/") ? "text-gray-900" : "text-gray-500"}`}
          >
            Home
          </Link>
          {isAuthenticated && (
            <>
              <Link
                to="/users"
                className={`no-underline font-medium ${isActive("/users") ? "text-gray-900" : "text-gray-500"}`}
              >
                Users
              </Link>
              <Link
                to="/orgs"
                className={`no-underline font-medium ${isActive("/orgs") ? "text-gray-900" : "text-gray-500"}`}
              >
                Orgs
              </Link>
              <Link
                to="/projects"
                className={`no-underline font-medium ${isActive("/projects") ? "text-gray-900" : "text-gray-500"}`}
              >
                Projects
              </Link>
              <Link
                to="/specs"
                className={`no-underline font-medium ${isActive("/specs") ? "text-gray-900" : "text-gray-500"}`}
              >
                Specs
              </Link>
              <Link
                to="/search"
                className={`no-underline font-medium ${isActive("/search") ? "text-gray-900" : "text-gray-500"}`}
              >
                Search
              </Link>
              <Link
                to="/api-keys"
                className={`no-underline font-medium ${isActive("/api-keys") ? "text-gray-900" : "text-gray-500"}`}
              >
                API Keys
              </Link>
              <Link
                to="/profile"
                className={`no-underline font-medium ${isActive("/profile") ? "text-gray-900" : "text-gray-500"}`}
              >
                Profile
                {unreadCount > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Link>
              <Link
                to="/admin"
                className={`no-underline font-medium ${isActive("/admin") ? "text-gray-900" : "text-gray-500"}`}
              >
                Admin
              </Link>
            </>
          )}
        </div>
        <div>
          {!isLoading &&
            (isAuthenticated ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500">{user?.name}</span>
                <button
                  onClick={() =>
                    logout({
                      logoutParams: { returnTo: window.location.origin },
                    })
                  }
                  className="px-4 py-1.5 border border-gray-300 rounded bg-white cursor-pointer text-sm hover:bg-gray-50"
                >
                  Log out
                </button>
              </div>
            ) : (
              <button
                onClick={() => loginWithRedirect()}
                className="px-4 py-1.5 border border-gray-300 rounded bg-white cursor-pointer text-sm hover:bg-gray-50"
              >
                Log in
              </button>
            ))}
        </div>
      </div>
    </nav>
  );
}
