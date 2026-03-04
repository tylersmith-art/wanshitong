import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => mockLogger),
}));

const mockUpdate = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn() }) });
const mockSelectChain = {
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([]),
    }),
  }),
};
const mockSelect = vi.fn().mockReturnValue(mockSelectChain);
const mockDb = { select: mockSelect, update: mockUpdate };

vi.mock("../../db/index.js", () => ({
  getDb: vi.fn(() => mockDb),
}));

const mockSummarize = vi.fn();

vi.mock("../../services/summarization/index.js", () => ({
  getSummarizationAdapter: vi.fn(() => ({ summarize: mockSummarize })),
}));

const mockEnqueueJob = vi.fn().mockResolvedValue("job-id");

vi.mock("../index.js", () => ({
  enqueueJob: (...args: unknown[]) => mockEnqueueJob(...args),
}));

import {
  registerGenerateSummaryHandler,
  GENERATE_SUMMARY,
} from "./generateSummary.js";

describe("generateSummary handler", () => {
  let workCallback: (jobs: Array<{ id: string; data: unknown }>) => Promise<void>;

  const mockBoss = {
    work: vi.fn(async (_name: string, cb: any) => {
      workCallback = cb;
    }),
  };

  function setupSelectResult(result: unknown[]) {
    const mockLimit = vi.fn().mockResolvedValue(result);
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });
  }

  function setupUpdateChain() {
    const mockWhere = vi.fn().mockResolvedValue(undefined);
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
    mockUpdate.mockReturnValue({ set: mockSet });
    return { mockSet, mockWhere };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers handler for GENERATE_SUMMARY job", async () => {
    await registerGenerateSummaryHandler(mockBoss as any);
    expect(mockBoss.work).toHaveBeenCalledWith(
      GENERATE_SUMMARY,
      expect.any(Function),
    );
  });

  it("skips gracefully when spec is not found", async () => {
    await registerGenerateSummaryHandler(mockBoss as any);
    setupSelectResult([]);

    await workCallback([{ id: "job-1", data: { specId: "missing-id" } }]);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      { specId: "missing-id" },
      "Spec not found, skipping summary generation",
    );
    expect(mockSummarize).not.toHaveBeenCalled();
  });

  it("generates summary, saves to db, and enqueues embedding job", async () => {
    await registerGenerateSummaryHandler(mockBoss as any);

    const spec = { id: "spec-1", content: "Architecture content here" };
    setupSelectResult([spec]);
    const { mockSet } = setupUpdateChain();
    mockSummarize.mockResolvedValue({ success: true, summary: "A concise summary" });

    await workCallback([{ id: "job-1", data: { specId: "spec-1" } }]);

    // Should update status to processing first
    expect(mockSet).toHaveBeenCalledWith({ embeddingStatus: "processing" });

    // Should save the summary
    expect(mockSet).toHaveBeenCalledWith({ summary: "A concise summary" });

    // Should enqueue embedding job
    expect(mockEnqueueJob).toHaveBeenCalledWith("generate-embedding", { specId: "spec-1" });

    expect(mockLogger.info).toHaveBeenCalledWith(
      { specId: "spec-1" },
      "Summary generated, enqueuing embedding job",
    );
  });

  it("sets embeddingStatus to failed and throws on adapter failure", async () => {
    await registerGenerateSummaryHandler(mockBoss as any);

    const spec = { id: "spec-2", content: "Some content" };
    setupSelectResult([spec]);
    const { mockSet } = setupUpdateChain();
    mockSummarize.mockResolvedValue({ success: false, error: "API rate limit" });

    await expect(
      workCallback([{ id: "job-2", data: { specId: "spec-2" } }]),
    ).rejects.toThrow("API rate limit");

    // Should update status to processing first
    expect(mockSet).toHaveBeenCalledWith({ embeddingStatus: "processing" });

    // Should update status to failed
    expect(mockSet).toHaveBeenCalledWith({ embeddingStatus: "failed" });

    expect(mockLogger.error).toHaveBeenCalledWith(
      { specId: "spec-2", error: "API rate limit" },
      "Summary generation failed",
    );

    // Should NOT enqueue embedding job
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });
});
