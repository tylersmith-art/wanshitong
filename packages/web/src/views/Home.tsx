import { useAuth0 } from "@auth0/auth0-react";
import { Link } from "react-router-dom";
import { Search, Terminal, Bot, FolderOpen } from "lucide-react";
import { CodeBlock } from "../components/CodeBlock.js";

export function Home() {
  const { isAuthenticated, loginWithRedirect } = useAuth0();

  return (
    <div className="text-center pt-12 pb-16">
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
          <Search className="w-8 h-8 text-indigo-600 mb-3" />
          <h3 className="font-semibold mb-2">Semantic Search</h3>
          <p className="text-gray-500 text-sm leading-relaxed">
            Search your architecture docs by meaning, not just keywords. Powered
            by vector embeddings.
          </p>
        </div>
        <div className="p-6 border border-gray-200 rounded-lg bg-white">
          <Terminal className="w-8 h-8 text-indigo-600 mb-3" />
          <h3 className="font-semibold mb-2">CLI Tool</h3>
          <p className="text-gray-500 text-sm leading-relaxed">
            wst arc searches your project's specs right from the terminal.
            Install via Homebrew.
          </p>
        </div>
        <div className="p-6 border border-gray-200 rounded-lg bg-white">
          <Bot className="w-8 h-8 text-indigo-600 mb-3" />
          <h3 className="font-semibold mb-2">AI Agent Integration</h3>
          <p className="text-gray-500 text-sm leading-relaxed">
            wst init injects architecture guidance into CLAUDE.md so AI agents
            automatically reference your docs.
          </p>
        </div>
        <div className="p-6 border border-gray-200 rounded-lg bg-white">
          <FolderOpen className="w-8 h-8 text-indigo-600 mb-3" />
          <h3 className="font-semibold mb-2">Project-Scoped Knowledge</h3>
          <p className="text-gray-500 text-sm leading-relaxed">
            Attach specs to projects. Each project gets its own curated
            knowledge base.
          </p>
        </div>
      </div>

      <div className="mt-16 text-left max-w-2xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-8">Quick Start</h2>

        <div className="mb-8">
          <p className="text-lg font-semibold mb-2">1. Create an account</p>
          {isAuthenticated ? (
            <p className="text-green-600 font-medium">
              &#10003; You're signed in!
            </p>
          ) : (
            <p className="text-gray-600">
              Sign up for a free account to get started.{" "}
              <button
                onClick={() => loginWithRedirect()}
                className="text-indigo-600 underline cursor-pointer bg-transparent border-none p-0 font-inherit"
              >
                Sign up
              </button>
            </p>
          )}
        </div>

        <div className="mb-8">
          <p className="text-lg font-semibold mb-2">2. Get an API key</p>
          <p className="text-gray-600">
            Generate an API key from your{" "}
            <Link to="/api-keys" className="text-indigo-600 underline">
              dashboard
            </Link>
            .
          </p>
        </div>

        <div className="mb-8">
          <p className="text-lg font-semibold mb-2">3. Install the CLI</p>
          <CodeBlock
            code="brew tap tylersmith-art/wst && brew install wst"
            language="bash"
          />
          <p className="text-gray-600 mt-2">
            Or install with npm:{" "}
            <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">
              npm install -g @wanshitong/cli
            </code>
          </p>
        </div>

        <div className="mb-8">
          <p className="text-lg font-semibold mb-2">
            4. Initialize your project
          </p>
          <CodeBlock
            code="wst init my-project --key <your-api-key>"
            language="bash"
          />
          <p className="text-gray-600 mt-2">
            This caches your API key and injects architecture guidance into
            CLAUDE.md.
          </p>
        </div>

        <div className="mb-8">
          <p className="text-lg font-semibold mb-2">
            5. Search your architecture
          </p>
          <CodeBlock
            code='wst arc "how to handle authentication"'
            language="bash"
          />
          <p className="text-gray-600 mt-2">
            Returns relevant architecture docs ranked by semantic similarity.
          </p>
        </div>
      </div>
    </div>
  );
}
