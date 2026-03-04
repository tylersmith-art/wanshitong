import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => mockLogger),
}));

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockUpdateWhere = vi.fn();

const mockDb = {
  select: mockSelect,
  update: mockUpdate,
};

mockSelect.mockReturnValue({ from: mockFrom });
mockFrom.mockReturnValue({ where: mockWhere });
mockWhere.mockReturnValue({ limit: mockLimit });
mockUpdate.mockReturnValue({ set: mockSet });
mockSet.mockReturnValue({ where: mockUpdateWhere });

vi.mock("../../db/index.js", () => ({
  getDb: vi.fn(() => mockDb),
}));

const mockEmbed = vi.fn();

vi.mock("../../services/embedding/index.js", () => ({
  getEmbeddingAdapter: vi.fn(() => ({
    embed: mockEmbed,
  })),
}));

import {
  registerGenerateEmbeddingHandler,
  GENERATE_EMBEDDING,
} from "./generateEmbedding.js";

describe("generateEmbedding handler", () => {
  let workCallback: (
    jobs: Array<{ id: string; data: unknown }>,
  ) => Promise<void>;

  const mockBoss = {
    work: vi.fn(async (_name: string, cb: any) => {
      workCallback = cb;
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chain mocks
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockUpdateWhere });
  });

  it("registers handler for GENERATE_EMBEDDING job", async () => {
    await registerGenerateEmbeddingHandler(mockBoss as any);
    expect(mockBoss.work).toHaveBeenCalledWith(
      GENERATE_EMBEDDING,
      expect.any(Function),
    );
  });

  it("generates embedding and saves to db with status complete", async () => {
    const fakeEmbedding = Array.from({ length: 1024 }, (_, i) => i * 0.001);

    mockLimit.mockResolvedValue([
      { id: "spec-1", summary: "A microservices architecture using event sourcing" },
    ]);
    mockEmbed.mockResolvedValue({
      success: true,
      embedding: fakeEmbedding,
      dimensions: 1024,
    });
    mockUpdateWhere.mockResolvedValue(undefined);

    await registerGenerateEmbeddingHandler(mockBoss as any);
    await workCallback([{ id: "job-1", data: { specId: "spec-1" } }]);

    expect(mockEmbed).toHaveBeenCalledWith({
      text: "A microservices architecture using event sourcing",
    });
    expect(mockSet).toHaveBeenCalledWith({
      embedding: fakeEmbedding,
      embeddingStatus: "complete",
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ specId: "spec-1", dimensions: 1024 }),
      "Embedding generated and stored",
    );
  });

  it("skips if spec not found", async () => {
    mockLimit.mockResolvedValue([]);

    await registerGenerateEmbeddingHandler(mockBoss as any);
    await workCallback([{ id: "job-2", data: { specId: "missing-spec" } }]);

    expect(mockEmbed).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { specId: "missing-spec" },
      "Spec not found, skipping embedding generation",
    );
  });

  it("skips if spec has no summary", async () => {
    mockLimit.mockResolvedValue([{ id: "spec-2", summary: null }]);

    await registerGenerateEmbeddingHandler(mockBoss as any);
    await workCallback([{ id: "job-3", data: { specId: "spec-2" } }]);

    expect(mockEmbed).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { specId: "spec-2" },
      "Spec has no summary, skipping embedding generation",
    );
  });

  it("handles adapter failure by setting status to failed and throwing for retry", async () => {
    mockLimit.mockResolvedValue([
      { id: "spec-3", summary: "Some architecture spec" },
    ]);
    mockEmbed.mockResolvedValue({
      success: false,
      error: "API rate limit exceeded",
    });
    mockUpdateWhere.mockResolvedValue(undefined);

    await registerGenerateEmbeddingHandler(mockBoss as any);

    await expect(
      workCallback([{ id: "job-4", data: { specId: "spec-3" } }]),
    ).rejects.toThrow("API rate limit exceeded");

    expect(mockSet).toHaveBeenCalledWith({ embeddingStatus: "failed" });
    expect(mockLogger.error).toHaveBeenCalledWith(
      { specId: "spec-3", error: "API rate limit exceeded" },
      "Embedding generation failed",
    );
  });
});
