import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogger = {
  info: vi.fn(),
};

vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => mockLogger),
}));

import { createConsoleSummarizationAdapter } from "./console.js";

describe("createConsoleSummarizationAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("truncates content to 200 chars by default", async () => {
    const adapter = createConsoleSummarizationAdapter();
    const longContent = "a".repeat(500);
    const result = await adapter.summarize({ content: longContent });

    expect(result).toEqual({
      success: true,
      summary: "a".repeat(200),
    });
  });

  it("respects maxLength parameter", async () => {
    const adapter = createConsoleSummarizationAdapter();
    const longContent = "a".repeat(500);
    const result = await adapter.summarize({
      content: longContent,
      maxLength: 100,
    });

    expect(result).toEqual({
      success: true,
      summary: "a".repeat(100),
    });
  });

  it("returns full content when shorter than limit", async () => {
    const adapter = createConsoleSummarizationAdapter();
    const result = await adapter.summarize({ content: "short content" });

    expect(result).toEqual({
      success: true,
      summary: "short content",
    });
  });

  it("logs summarization details", async () => {
    const adapter = createConsoleSummarizationAdapter();
    await adapter.summarize({ content: "test content" });

    expect(mockLogger.info).toHaveBeenCalledWith(
      { contentLength: 12, summaryLength: 12 },
      expect.stringContaining("console adapter"),
    );
  });
});
