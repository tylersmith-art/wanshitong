import { describe, it, expect, vi, beforeEach } from "vitest";
import { readConfig, writeConfig } from "./config.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/mock-home"),
}));

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockMkdirSync = vi.mocked(mkdirSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readConfig", () => {
  it("returns empty config when no file exists", () => {
    mockExistsSync.mockReturnValue(false);

    const config = readConfig();

    expect(config).toEqual({});
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("reads and parses existing config file", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        apiKey: "test-key",
        apiUrl: "http://localhost:3000",
        projectId: "proj-123",
      }),
    );

    const config = readConfig();

    expect(config).toEqual({
      apiKey: "test-key",
      apiUrl: "http://localhost:3000",
      projectId: "proj-123",
    });
    expect(mockReadFileSync).toHaveBeenCalledWith(
      "/mock-home/.wst/config.json",
      "utf-8",
    );
  });
});

describe("writeConfig", () => {
  it("creates directory and writes config file", () => {
    mockExistsSync.mockReturnValue(false);

    const config = {
      apiKey: "test-key",
      apiUrl: "http://localhost:3000",
    };

    writeConfig(config);

    expect(mockMkdirSync).toHaveBeenCalledWith("/mock-home/.wst", {
      recursive: true,
    });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      "/mock-home/.wst/config.json",
      JSON.stringify(config, null, 2),
      "utf-8",
    );
  });

  it("skips directory creation when it already exists", () => {
    mockExistsSync.mockReturnValue(true);

    writeConfig({ apiKey: "key" });

    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it("round-trips config through write and read", () => {
    const original = {
      apiKey: "round-trip-key",
      apiUrl: "https://api.example.com",
      projectId: "proj-456",
    };

    let writtenData = "";
    mockExistsSync.mockReturnValue(false);
    mockWriteFileSync.mockImplementation((_path, data) => {
      writtenData = data as string;
    });

    writeConfig(original);

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(writtenData);

    const result = readConfig();

    expect(result).toEqual(original);
  });
});
