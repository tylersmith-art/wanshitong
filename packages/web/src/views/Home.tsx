import { useAuth0 } from "@auth0/auth0-react";
import { Link } from "react-router-dom";

export function Home() {
  const { isAuthenticated } = useAuth0();

  return (
    <div className="text-center pt-12">
      <h1 className="text-4xl font-bold mb-2">Template App</h1>
      <p className="text-gray-500 mb-12">
        A full-stack TypeScript template with tRPC, React, Drizzle ORM, and
        Auth0.
      </p>
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
