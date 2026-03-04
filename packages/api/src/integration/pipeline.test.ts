import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Shared mocks ────────────────────────────────────────────────────────

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("../lib/logger.js", () => ({
  getLogger: vi.fn(() => mockLogger),
}));

vi.mock("../db/index.js", () => ({
  getConnectionString: vi.fn(() => "postgresql://mock"),
  getDb: vi.fn(() => ({})),
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock-jwks"),
  jwtVerify: vi.fn().mockResolvedValue({
    payload: { sub: "user123", email: "admin@example.com" },
    protectedHeader: { alg: "RS256" },
  }),
}));

vi.mock("../lib/env.js", () => ({
  getEnv: vi.fn(() => ({
    EMBEDDING_PROVIDER: "console",
  })),
}));

// ── Module-level mocks for adapters and jobs ────────────────────────────

const mockEnqueueJob = vi.fn().mockResolvedValue("job-123");

vi.mock("../jobs/index.js", () => ({
  enqueueJob: (...args: unknown[]) => mockEnqueueJob(...args),
}));

const mockSummarize = vi.fn();

vi.mock("../services/summarization/index.js", () => ({
  getSummarizationAdapter: vi.fn(() => ({ summarize: mockSummarize })),
}));

const mockEmbed = vi.fn();

vi.mock("../services/embedding/index.js", () => ({
  getEmbeddingAdapter: vi.fn(() => ({ embed: mockEmbed })),
}));

const mockSearch = vi.fn();

vi.mock("../services/search/index.js", () => ({
  getSearchAdapter: vi.fn(() => ({ search: mockSearch })),
}));

// ── Imports (must come after vi.mock calls) ─────────────────────────────

import { specRouter } from "../routers/spec.js";
import {
  registerGenerateSummaryHandler,
  GENERATE_SUMMARY,
} from "../jobs/handlers/generateSummary.js";
import {
  registerGenerateEmbeddingHandler,
  GENERATE_EMBEDDING,
} from "../jobs/handlers/generateEmbedding.js";
import { router } from "../trpc.js";
import { searchRouter } from "../routers/search.js";

// ── Constants ───────────────────────────────────────────────────────────

const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const SPEC_ID = "990e8400-e29b-41d4-a716-446655440004";

// ── Tests ───────────────────────────────────────────────────────────────

describe("Full Pipeline Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Step 1: Spec creation enqueues summary job ──────────────────────

  it("spec creation enqueues summary job", async () => {
    const now = new Date();
    const mockSpec = {
      id: SPEC_ID,
      name: "REST API Design Patterns",
      description: "REST conventions",
      content: "Resource naming should follow noun-based conventions.",
      summary: null,
      embedding: null,
      visibility: "global",
      orgId: null,
      userId: USER_ID,
      embeddingStatus: "pending",
      createdAt: now,
      updatedAt: now,
    };

    let resultQueue: unknown[] = [];
    let returningResults: unknown[] = [];

    const mockPubsub = {
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(),
      close: vi.fn(),
    };

    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(() => {
        const result = resultQueue.shift();
        return Promise.resolve(result ?? []);
      }),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn(() => {
        const result = returningResults.shift();
        return Promise.resolve(result ?? []);
      }),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
    };

    // protectedProcedure: lookup dbUser (admin for global spec)
    resultQueue.push([{ id: USER_ID, role: "admin" }]);
    // insert returning the new spec
    returningResults.push([mockSpec]);

    const caller = specRouter.createCaller({
      user: { sub: "user123", email: "admin@example.com" },
      db: mockDb as any,
      pubsub: mockPubsub as any,
      rawToken: null,
    } as any);

    const result = await caller.create({
      name: "REST API Design Patterns",
      content: "Resource naming should follow noun-based conventions.",
      visibility: "global",
    });

    expect(result.id).toBe(SPEC_ID);
    expect(mockEnqueueJob).toHaveBeenCalledWith(GENERATE_SUMMARY, {
      specId: SPEC_ID,
    });
  });

  // ─── Step 2: Summary handler calls adapter and enqueues embedding ────

  it("summary handler calls summarization and enqueues embedding", async () => {
    const mockSelect = vi.fn();
    const mockUpdate = vi.fn();

    const setupSelectResult = (result: unknown[]) => {
      const mockLimit = vi.fn().mockResolvedValue(result);
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      mockSelect.mockReturnValue({ from: mockFrom });
    };

    const setupUpdateChain = () => {
      const mockWhere = vi.fn().mockResolvedValue(undefined);
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
      mockUpdate.mockReturnValue({ set: mockSet });
      return { mockSet, mockWhere };
    };

    // Override getDb for this test
    const { getDb } = await import("../db/index.js");
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({
      select: mockSelect,
      update: mockUpdate,
    });

    const spec = {
      id: SPEC_ID,
      content: "Resource naming should follow noun-based conventions.",
    };
    setupSelectResult([spec]);
    const { mockSet } = setupUpdateChain();

    mockSummarize.mockResolvedValue({
      success: true,
      summary: "A guide to REST API design covering resource naming, HTTP methods, and pagination.",
    });

    let workCallback: (
      jobs: Array<{ id: string; data: unknown }>
    ) => Promise<void>;

    const mockBoss = {
      work: vi.fn(async (_name: string, cb: any) => {
        workCallback = cb;
      }),
    };

    await registerGenerateSummaryHandler(mockBoss as any);
    await workCallback!([{ id: "job-1", data: { specId: SPEC_ID } }]);

    // Verify summarization adapter was called with spec content
    expect(mockSummarize).toHaveBeenCalledWith({
      content: spec.content,
    });

    // Verify status set to processing
    expect(mockSet).toHaveBeenCalledWith({ embeddingStatus: "processing" });

    // Verify summary was saved
    expect(mockSet).toHaveBeenCalledWith({
      summary: "A guide to REST API design covering resource naming, HTTP methods, and pagination.",
    });

    // Verify embedding job was enqueued
    expect(mockEnqueueJob).toHaveBeenCalledWith("generate-embedding", {
      specId: SPEC_ID,
    });
  });

  // ─── Step 3: Embedding handler calls adapter and stores vector ───────

  it("embedding handler calls embedding adapter", async () => {
    const fakeEmbedding = Array.from({ length: 1024 }, (_, i) => i * 0.001);

    const mockSelectEmbed = vi.fn();
    const mockFromEmbed = vi.fn();
    const mockWhereEmbed = vi.fn();
    const mockLimitEmbed = vi.fn();
    const mockUpdateEmbed = vi.fn();
    const mockSetEmbed = vi.fn();
    const mockUpdateWhereEmbed = vi.fn();

    mockSelectEmbed.mockReturnValue({ from: mockFromEmbed });
    mockFromEmbed.mockReturnValue({ where: mockWhereEmbed });
    mockWhereEmbed.mockReturnValue({ limit: mockLimitEmbed });
    mockUpdateEmbed.mockReturnValue({ set: mockSetEmbed });
    mockSetEmbed.mockReturnValue({ where: mockUpdateWhereEmbed });

    const { getDb } = await import("../db/index.js");
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({
      select: mockSelectEmbed,
      update: mockUpdateEmbed,
    });

    mockLimitEmbed.mockResolvedValue([
      {
        id: SPEC_ID,
        summary: "A guide to REST API design covering resource naming, HTTP methods, and pagination.",
      },
    ]);

    mockEmbed.mockResolvedValue({
      success: true,
      embedding: fakeEmbedding,
      dimensions: 1024,
    });

    mockUpdateWhereEmbed.mockResolvedValue(undefined);

    let workCallback: (
      jobs: Array<{ id: string; data: unknown }>
    ) => Promise<void>;

    const mockBoss = {
      work: vi.fn(async (_name: string, cb: any) => {
        workCallback = cb;
      }),
    };

    await registerGenerateEmbeddingHandler(mockBoss as any);
    await workCallback!([{ id: "job-2", data: { specId: SPEC_ID } }]);

    // Verify embedding adapter was called with the summary text
    expect(mockEmbed).toHaveBeenCalledWith({
      text: "A guide to REST API design covering resource naming, HTTP methods, and pagination.",
    });

    // Verify embedding and status were stored
    expect(mockSetEmbed).toHaveBeenCalledWith({
      embedding: fakeEmbedding,
      embeddingStatus: "complete",
    });
  });

  // ─── Step 4: Search returns matching specs ───────────────────────────

  it("search returns matching specs with similarity scores", async () => {
    const MOCK_SEARCH_RESULTS = [
      {
        specId: SPEC_ID,
        name: "REST API Design Patterns",
        description: "REST conventions",
        content: "Resource naming should follow noun-based conventions.",
        similarity: 0.95,
      },
      {
        specId: "aa0e8400-e29b-41d4-a716-446655440005",
        name: "Authentication & Authorization Patterns",
        description: "Auth patterns",
        content: "JWT-based authentication...",
        similarity: 0.82,
      },
    ];

    mockEmbed.mockResolvedValue({
      success: true,
      embedding: [0.1, 0.2, 0.3],
      dimensions: 3,
    });

    mockSearch.mockResolvedValue({
      success: true,
      results: MOCK_SEARCH_RESULTS,
    });

    let resultQueue: unknown[] = [];

    const mockPubsub = {
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(),
      close: vi.fn(),
    };

    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(() => {
        const result = resultQueue.shift();
        return Promise.resolve(result ?? []);
      }),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
    };

    // flexibleAuthProcedure JWT path: user lookup
    resultQueue.push([
      {
        id: USER_ID,
        sub: "user123",
        email: "admin@example.com",
        name: "Admin User",
        role: "admin",
        createdAt: new Date(),
      },
    ]);

    const testRouter = router({ search: searchRouter });
    const caller = testRouter.createCaller({
      user: { sub: "user123", email: "admin@example.com" },
      db: mockDb as any,
      pubsub: mockPubsub as any,
      rawToken: null,
    });

    const result = await caller.search.search({
      query: "REST API design patterns",
    });

    // Verify embedding adapter was called with the search query
    expect(mockEmbed).toHaveBeenCalledWith({ text: "REST API design patterns" });

    // Verify search adapter was called with the embedding
    expect(mockSearch).toHaveBeenCalledWith({
      embedding: [0.1, 0.2, 0.3],
      projectId: undefined,
      limit: 10,
    });

    // Verify results are returned with similarity scores
    expect(result.results).toHaveLength(2);
    expect(result.results[0].specId).toBe(SPEC_ID);
    expect(result.results[0].similarity).toBe(0.95);
    expect(result.results[1].similarity).toBe(0.82);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
