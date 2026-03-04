import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogger = {
  info: vi.fn(),
};

vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => mockLogger),
}));

import { createConsoleEmbeddingAdapter } from "./console.js";

describe("createConsoleEmbeddingAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success with 1024-dimension zero vector", async () => {
    const adapter = createConsoleEmbeddingAdapter();
    const result = await adapter.embed({ text: "hello world" });

    expect(result.success).toBe(true);
    expect(result.dimensions).toBe(1024);
    expect(result.embedding).toHaveLength(1024);
    expect(result.embedding!.every((v) => v === 0)).toBe(true);
  });

  it("logs the text length", async () => {
    const adapter = createConsoleEmbeddingAdapter();
    await adapter.embed({ text: "hello world" });

    expect(mockLogger.info).toHaveBeenCalledWith(
      { textLength: 11 },
      expect.stringContaining("console adapter"),
    );
  });
});
