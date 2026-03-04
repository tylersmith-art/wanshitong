import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/config.js", () => ({
  readConfig: vi.fn(),
}));

vi.mock("../lib/api.js", () => ({
  searchSpecs: vi.fn(),
}));

import { readConfig } from "../lib/config.js";
import { searchSpecs } from "../lib/api.js";
import { createArcCommand } from "./arc.js";

const mockReadConfig = vi.mocked(readConfig);
const mockSearchSpecs = vi.mocked(searchSpecs);

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
});

describe("arcCommand", () => {
  const defaultConfig = {
    apiKey: "test-key",
    apiUrl: "http://localhost:3000/api/trpc",
    projectId: "my-project",
  };

  async function runArc(args: string[]): Promise<string> {
    const logs: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...msgArgs: unknown[]) => logs.push(msgArgs.join(" "));
    console.error = (...msgArgs: unknown[]) => logs.push(msgArgs.join(" "));

    try {
      const cmd = createArcCommand();
      await cmd.parseAsync(["node", "arc", ...args]);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    return logs.join("\n");
  }

  it("displays search results formatted correctly", async () => {
    mockReadConfig.mockReturnValue(defaultConfig);
    mockSearchSpecs.mockResolvedValue({
      results: [
        {
          specId: "spec-1",
          name: "Auth Module",
          description: "Authentication architecture",
          content: "Use JWT with refresh tokens.",
          similarity: 0.9512,
        },
        {
          specId: "spec-2",
          name: "API Gateway",
          description: null,
          content: "Route through gateway.",
          similarity: 0.8234,
        },
      ],
      durationMs: 42,
    });

    const output = await runArc(["auth patterns"]);

    expect(output).toContain("Found 2 result(s) for: 'auth patterns' (took 42ms)");
    expect(output).toContain("## Auth Module (score: 0.95)");
    expect(output).toContain("Authentication architecture");
    expect(output).toContain("Use JWT with refresh tokens.");
    expect(output).toContain("## API Gateway (score: 0.82)");
    expect(output).toContain("Route through gateway.");
    expect(output).not.toContain("null");
  });

  it("handles no config found — prints init prompt and sets exitCode", async () => {
    mockReadConfig.mockReturnValue({});

    const output = await runArc(["some query"]);

    expect(output).toContain("No configuration found. Run `wst init` first.");
    expect(process.exitCode).toBe(1);
    expect(mockSearchSpecs).not.toHaveBeenCalled();
  });

  it("handles auth failure — prints auth error message and sets exitCode", async () => {
    mockReadConfig.mockReturnValue(defaultConfig);
    mockSearchSpecs.mockRejectedValue(
      new Error("Search request failed: 401 Unauthorized"),
    );

    const output = await runArc(["auth patterns"]);

    expect(output).toContain(
      "Authentication failed. Check your API key or run `wst init` again.",
    );
    expect(process.exitCode).toBe(1);
  });

  it("handles no results — prints informative message", async () => {
    mockReadConfig.mockReturnValue(defaultConfig);
    mockSearchSpecs.mockResolvedValue({
      results: [],
      durationMs: 10,
    });

    const output = await runArc(["obscure topic"]);

    expect(output).toContain(
      "No matching architecture specs found for: 'obscure topic'",
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("passes query and limit to searchSpecs correctly", async () => {
    mockReadConfig.mockReturnValue(defaultConfig);
    mockSearchSpecs.mockResolvedValue({ results: [], durationMs: 5 });

    await runArc(["auth patterns", "--limit", "10"]);

    expect(mockSearchSpecs).toHaveBeenCalledWith(
      { query: "auth patterns", projectId: "my-project", limit: 10 },
      { apiKey: "test-key", apiUrl: "http://localhost:3000/api/trpc" },
    );
  });

  it("uses default limit of 5 when not specified", async () => {
    mockReadConfig.mockReturnValue(defaultConfig);
    mockSearchSpecs.mockResolvedValue({ results: [], durationMs: 5 });

    await runArc(["some query"]);

    expect(mockSearchSpecs).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 }),
      expect.any(Object),
    );
  });

  it("reads projectId from config and passes it to searchSpecs", async () => {
    mockReadConfig.mockReturnValue({
      apiKey: "key-123",
      apiUrl: "http://example.com",
      projectId: "project-abc",
    });
    mockSearchSpecs.mockResolvedValue({ results: [], durationMs: 3 });

    await runArc(["query"]);

    expect(mockSearchSpecs).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-abc" }),
      expect.objectContaining({ apiKey: "key-123" }),
    );
  });
});
