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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 text-left">
        <div className="p-6 border border-gray-200 rounded-lg bg-white">
          <div className="text-4xl mb-3">🔍</div>
          <h3 className="font-semibold mb-2">Semantic Search</h3>
          <p className="text-gray-500 text-sm leading-relaxed">
            Search your architecture docs by meaning, not just keywords. Powered
            by vector embeddings.
          </p>
        </div>
        <div className="p-6 border border-gray-200 rounded-lg bg-white">
          <div className="text-4xl mb-3">⌨️</div>
          <h3 className="font-semibold mb-2">CLI Tool</h3>
          <p className="text-gray-500 text-sm leading-relaxed">
            wst arc searches your project's specs right from the terminal.
            Install via Homebrew.
          </p>
        </div>
        <div className="p-6 border border-gray-200 rounded-lg bg-white">
          <div className="text-4xl mb-3">🤖</div>
          <h3 className="font-semibold mb-2">AI Agent Integration</h3>
          <p className="text-gray-500 text-sm leading-relaxed">
            wst init injects architecture guidance into CLAUDE.md so AI agents
            automatically reference your docs.
          </p>
        </div>
        <div className="p-6 border border-gray-200 rounded-lg bg-white">
          <div className="text-4xl mb-3">📁</div>
          <h3 className="font-semibold mb-2">Project-Scoped Knowledge</h3>
          <p className="text-gray-500 text-sm leading-relaxed">
            Attach specs to projects. Each project gets its own curated
            knowledge base.
          </p>
        </div>
      </div>
    </div>
  );
}
