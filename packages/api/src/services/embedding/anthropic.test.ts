import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
  })),
}));

import { createAnthropicEmbeddingAdapter } from "./anthropic.js";

describe("createAnthropicEmbeddingAdapter", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends correct payload to Voyage API (default document input_type)", async () => {
    const fakeEmbedding = new Array(1024).fill(0.1);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: fakeEmbedding }],
        usage: { total_tokens: 5 },
      }),
    });

    const adapter = createAnthropicEmbeddingAdapter({ apiKey: "test-key" });
    await adapter.embed({ text: "hello world" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.voyageai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "voyage-3",
          input: ["hello world"],
          input_type: "document",
        }),
      }),
    );
  });

  it("sends query input_type when specified", async () => {
    const fakeEmbedding = new Array(1024).fill(0.1);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: fakeEmbedding }],
        usage: { total_tokens: 5 },
      }),
    });

    const adapter = createAnthropicEmbeddingAdapter({ apiKey: "test-key" });
    await adapter.embed({ text: "search query", inputType: "query" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.voyageai.com/v1/embeddings",
      expect.objectContaining({
        body: JSON.stringify({
          model: "voyage-3",
          input: ["search query"],
          input_type: "query",
        }),
      }),
    );
  });

  it("handles successful response", async () => {
    const fakeEmbedding = new Array(1024).fill(0.42);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: fakeEmbedding }],
        usage: { total_tokens: 5 },
      }),
    });

    const adapter = createAnthropicEmbeddingAdapter({ apiKey: "test-key" });
    const result = await adapter.embed({ text: "hello world" });

    expect(result).toEqual({
      success: true,
      embedding: fakeEmbedding,
      dimensions: 1024,
    });
  });

  it("handles fetch error gracefully", async () => {
    mockFetch.mockRejectedValue(new Error("Network failure"));

    const adapter = createAnthropicEmbeddingAdapter({ apiKey: "test-key" });
    const result = await adapter.embed({ text: "hello world" });

    expect(result).toEqual({
      success: false,
      error: "Network failure",
    });
  });

  it("handles non-ok HTTP response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Rate limited",
    });

    const adapter = createAnthropicEmbeddingAdapter({ apiKey: "test-key" });
    const result = await adapter.embed({ text: "hello world" });

    expect(result).toEqual({
      success: false,
      error: "Voyage API error: 429",
    });
  });
});
