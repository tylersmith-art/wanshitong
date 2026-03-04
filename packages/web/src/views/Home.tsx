import { useAuth0 } from "@auth0/auth0-react";
import { Link } from "react-router-dom";

export function Home() {
  const { isAuthenticated, loginWithRedirect } = useAuth0();

  return (
    <div className="text-center pt-12">
      <h1 className="text-5xl font-bold mb-4">Wan Shi Tong</h1>
      <p className="text-xl text-gray-500 mb-8 max-w-2xl mx-auto">
        Architecture knowledge for your codebase — semantic search over your
        specs, accessible from the terminal.
      </p>
      {isAuthenticated ? (
        <Link
          to="/projects"
          className="inline-block px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors no-underline mb-16"
        >
          Go to Projects
        </Link>
      ) : (
        <button
          onClick={() => loginWithRedirect()}
          className="px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer mb-16"
        >
          Get Started
        </button>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
        <div className="p-6 border border-gray-200 rounded-lg bg-white">
          <h3 className="font-semibold mb-2">End-to-End Type Safety</h3>
          <p className="text-gray-500 text-sm leading-relaxed">
            Shared Zod schemas and tRPC give you full autocomplete from database
            to UI.
          </p>
        </div>
        <div className="p-6 border border-gray-200 rounded-lg bg-white">
          <h3 className="font-semibold mb-2">Auth0 Authentication</h3>
          <p className="text-gray-500 text-sm leading-relaxed">
            {isAuthenticated
              ? "You're logged in."
              : "Log in to access protected routes and API mutations."}
          </p>
        </div>
        <div className="p-6 border border-gray-200 rounded-lg bg-white">
          <h3 className="font-semibold mb-2">Demo</h3>
          <p className="text-gray-500 text-sm leading-relaxed">
            Visit the{" "}
            <Link to="/users" className="text-indigo-600">
              Users page
            </Link>{" "}
            to see tRPC in action with full CRUD operations.
          </p>
        </div>
      </div>
    </div>
  );
}
