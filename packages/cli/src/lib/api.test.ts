import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchSpecs } from "./api.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchSpecs", () => {
  const defaultConfig = {
    apiKey: "test-api-key",
    apiUrl: "http://localhost:3000",
  };

  it("constructs correct URL with encoded input params", async () => {
    const mockResponse = {
      result: {
        data: {
          results: [],
          durationMs: 42,
        },
      },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    await searchSpecs({ query: "auth patterns" }, defaultConfig);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("http://localhost:3000/search.search?input=");

    const inputParam = calledUrl.split("input=")[1];
    const decoded = JSON.parse(decodeURIComponent(inputParam));
    expect(decoded).toEqual({ query: "auth patterns" });
  });

  it("sends Authorization header with Bearer token", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ result: { data: { results: [], durationMs: 0 } } }),
    });

    await searchSpecs({ query: "test" }, defaultConfig);

    const calledOptions = mockFetch.mock.calls[0][1] as RequestInit;
    expect(calledOptions.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer test-api-key",
      }),
    );
  });

  it("returns parsed search results", async () => {
    const mockResults = {
      result: {
        data: {
          results: [
            {
              specId: "spec-1",
              name: "Auth Module",
              description: "Authentication module",
              content: "JWT-based auth",
              similarity: 0.95,
            },
          ],
          durationMs: 15,
        },
      },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResults),
    });

    const result = await searchSpecs({ query: "auth" }, defaultConfig);

    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe("Auth Module");
    expect(result.results[0].similarity).toBe(0.95);
    expect(result.durationMs).toBe(15);
  });

  it("includes optional params in the request", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ result: { data: { results: [], durationMs: 0 } } }),
    });

    await searchSpecs(
      { query: "test", projectId: "proj-1", limit: 5 },
      defaultConfig,
    );

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    const inputParam = calledUrl.split("input=")[1];
    const decoded = JSON.parse(decodeURIComponent(inputParam));
    expect(decoded).toEqual({ query: "test", projectId: "proj-1", limit: 5 });
  });

  it("throws error on HTTP failure", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    await expect(
      searchSpecs({ query: "test" }, defaultConfig),
    ).rejects.toThrow("Search request failed: 401 Unauthorized");
  });

  it("throws error on network failure", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    await expect(
      searchSpecs({ query: "test" }, defaultConfig),
    ).rejects.toThrow("Network error");
  });
});
