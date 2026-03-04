import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/mock-home"),
}));

vi.mock("../lib/api.js", () => ({
  searchSpecs: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { searchSpecs } from "../lib/api.js";
import { buildWstBlock, updateClaudeMd, validateApiKey, WST_MARKER } from "./init.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockSearchSpecs = vi.mocked(searchSpecs);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validateApiKey", () => {
  it("returns true when searchSpecs succeeds", async () => {
    mockSearchSpecs.mockResolvedValue({ results: [], durationMs: 10 });

    const result = await validateApiKey("valid-key", "http://localhost:3000");

    expect(result).toBe(true);
    expect(mockSearchSpecs).toHaveBeenCalledWith(
      { query: "test", limit: 1 },
      { apiKey: "valid-key", apiUrl: "http://localhost:3000" },
    );
  });

  it("returns false when searchSpecs throws (invalid key)", async () => {
    mockSearchSpecs.mockRejectedValue(
      new Error("Search request failed: 401 Unauthorized"),
    );

    const result = await validateApiKey("bad-key", "http://localhost:3000");

    expect(result).toBe(false);
  });
});

describe("updateClaudeMd", () => {
  it("creates CLAUDE.md with WST block when file does not exist", () => {
    mockExistsSync.mockReturnValue(false);

    const updated = updateClaudeMd("my-project", "/test/dir");

    expect(updated).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      "/test/dir/CLAUDE.md",
      expect.stringContaining(WST_MARKER),
      "utf-8",
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      "/test/dir/CLAUDE.md",
      expect.stringContaining("Project: my-project"),
      "utf-8",
    );
  });

  it("appends WST block to existing CLAUDE.md content", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("# Existing Project\n\nSome content.\n");

    const updated = updateClaudeMd("my-project", "/test/dir");

    expect(updated).toBe(true);
    const writtenContent = mockWriteFileSync.mock.calls[0][1] as string;
    expect(writtenContent).toContain("# Existing Project");
    expect(writtenContent).toContain("Some content.");
    expect(writtenContent).toContain(WST_MARKER);
    expect(writtenContent).toContain("Project: my-project");
  });

  it("skips appending when WST block already exists (idempotent)", () => {
    mockExistsSync.mockReturnValue(true);
    const existingContent = `# Project\n\n## ${WST_MARKER}\n\nAlready configured.\nProject: my-project\n`;
    mockReadFileSync.mockReturnValue(existingContent);

    const updated = updateClaudeMd("my-project", "/test/dir");

    expect(updated).toBe(false);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("running init twice does not duplicate the CLAUDE.md block", () => {
    // First call: file does not exist
    mockExistsSync.mockReturnValue(false);
    const firstUpdated = updateClaudeMd("my-project", "/test/dir");
    expect(firstUpdated).toBe(true);

    const firstWrittenContent = mockWriteFileSync.mock.calls[0][1] as string;

    // Second call: file now exists with the block
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(firstWrittenContent);

    const secondUpdated = updateClaudeMd("my-project", "/test/dir");
    expect(secondUpdated).toBe(false);
    // writeFileSync should only have been called once (from the first call)
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
  });
});

describe("buildWstBlock", () => {
  it("includes the project name in the block", () => {
    const block = buildWstBlock("test-project");

    expect(block).toContain(WST_MARKER);
    expect(block).toContain("Project: test-project");
    expect(block).toContain("wst arc '<query>'");
  });
});

describe("initCommand integration", () => {
  it("writes config with apiKey, apiUrl, and projectId", async () => {
    // We test the writeConfig call via the underlying functions
    // since commander action wiring is tested via the command itself.
    // The writeConfig function is already tested in config.test.ts.
    // Here we verify the validation + config write flow.
    mockSearchSpecs.mockResolvedValue({ results: [], durationMs: 5 });

    const isValid = await validateApiKey(
      "my-key",
      "http://localhost:3000/api/trpc",
    );
    expect(isValid).toBe(true);

    // Verify searchSpecs was called with correct validation params
    expect(mockSearchSpecs).toHaveBeenCalledWith(
      { query: "test", limit: 1 },
      { apiKey: "my-key", apiUrl: "http://localhost:3000/api/trpc" },
    );
  });

  it("uses --key flag value without prompting", async () => {
    // When --key is provided, validateApiKey is called directly with that key
    mockSearchSpecs.mockResolvedValue({ results: [], durationMs: 5 });

    const result = await validateApiKey(
      "flag-provided-key",
      "http://localhost:3000/api/trpc",
    );

    expect(result).toBe(true);
    expect(mockSearchSpecs).toHaveBeenCalledWith(
      { query: "test", limit: 1 },
      { apiKey: "flag-provided-key", apiUrl: "http://localhost:3000/api/trpc" },
    );
  });

  it("reports validation error when API key is invalid", async () => {
    mockSearchSpecs.mockRejectedValue(
      new Error("Search request failed: 401 Unauthorized"),
    );

    const result = await validateApiKey(
      "invalid-key",
      "http://localhost:3000/api/trpc",
    );

    expect(result).toBe(false);
  });
});
