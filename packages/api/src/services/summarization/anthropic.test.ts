import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
  })),
}));

import { createAnthropicSummarizationAdapter } from "./anthropic.js";

describe("createAnthropicSummarizationAdapter", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends correct payload to Anthropic API", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "A concise summary." }],
      }),
    });

    const adapter = createAnthropicSummarizationAdapter({
      apiKey: "test-api-key",
    });
    await adapter.summarize({ content: "Some architecture document" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: {
          "x-api-key": "test-api-key",
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-latest",
          max_tokens: 300,
          system:
            "You are a technical summarizer. Produce a concise summary of the following architecture specification. The summary should be suitable for vector embedding and semantic search. Focus on key technologies, patterns, constraints, and decisions.",
          messages: [{ role: "user", content: "Some architecture document" }],
        }),
      }),
    );
  });

  it("uses maxLength as max_tokens when provided", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "Short summary." }],
      }),
    });

    const adapter = createAnthropicSummarizationAdapter({
      apiKey: "test-api-key",
    });
    await adapter.summarize({ content: "Some content", maxLength: 150 });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.max_tokens).toBe(150);
  });

  it("handles successful response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "A concise summary." }],
      }),
    });

    const adapter = createAnthropicSummarizationAdapter({
      apiKey: "test-api-key",
    });
    const result = await adapter.summarize({
      content: "Some architecture document",
    });

    expect(result).toEqual({
      success: true,
      summary: "A concise summary.",
    });
  });

  it("handles non-ok HTTP response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Rate limited",
    });

    const adapter = createAnthropicSummarizationAdapter({
      apiKey: "test-api-key",
    });
    const result = await adapter.summarize({ content: "Some content" });

    expect(result).toEqual({
      success: false,
      error: "Anthropic API error: 429",
    });
  });

  it("handles fetch error gracefully", async () => {
    mockFetch.mockRejectedValue(new Error("Network failure"));

    const adapter = createAnthropicSummarizationAdapter({
      apiKey: "test-api-key",
    });
    const result = await adapter.summarize({ content: "Some content" });

    expect(result).toEqual({
      success: false,
      error: "Network failure",
    });
  });
});
