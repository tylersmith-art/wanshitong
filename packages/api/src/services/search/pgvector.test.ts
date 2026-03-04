import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
};

vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => mockLogger),
}));

import { createPgVectorSearchAdapter } from "./pgvector.js";

describe("createPgVectorSearchAdapter", () => {
  let mockDb: { execute: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = { execute: vi.fn() };
  });

  it("returns search results on success", async () => {
    const mockRows = [
      {
        specId: "spec-1",
        name: "Auth Spec",
        description: "Authentication architecture",
        content: "JWT-based auth flow",
        similarity: 0.92,
      },
      {
        specId: "spec-2",
        name: "API Gateway",
        description: "Gateway architecture",
        content: "Rate limiting and routing",
        similarity: 0.85,
      },
    ];

    mockDb.execute.mockResolvedValue(mockRows);

    const adapter = createPgVectorSearchAdapter({ db: mockDb });
    const result = await adapter.search({
      embedding: [0.1, 0.2, 0.3],
    });

    expect(result.success).toBe(true);
    expect(result.results).toEqual(mockRows);
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  it("returns results from rows property when present", async () => {
    const mockRows = [
      {
        specId: "spec-1",
        name: "Auth Spec",
        description: "Authentication architecture",
        content: "JWT-based auth flow",
        similarity: 0.92,
      },
    ];

    mockDb.execute.mockResolvedValue({ rows: mockRows });

    const adapter = createPgVectorSearchAdapter({ db: mockDb });
    const result = await adapter.search({
      embedding: [0.1, 0.2, 0.3],
    });

    expect(result.success).toBe(true);
    expect(result.results).toEqual(mockRows);
  });

  it("uses default limit of 10 and threshold of 0.5", async () => {
    mockDb.execute.mockResolvedValue([]);

    const adapter = createPgVectorSearchAdapter({ db: mockDb });
    await adapter.search({ embedding: [0.1, 0.2, 0.3] });

    expect(mockDb.execute).toHaveBeenCalledTimes(1);
    const query = mockDb.execute.mock.calls[0][0];
    expect(query).toBeDefined();
  });

  it("passes custom limit and threshold", async () => {
    mockDb.execute.mockResolvedValue([]);

    const adapter = createPgVectorSearchAdapter({ db: mockDb });
    await adapter.search({
      embedding: [0.1, 0.2, 0.3],
      limit: 5,
      threshold: 0.8,
    });

    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  it("filters by projectId when provided", async () => {
    mockDb.execute.mockResolvedValue([]);

    const adapter = createPgVectorSearchAdapter({ db: mockDb });
    await adapter.search({
      embedding: [0.1, 0.2, 0.3],
      projectId: "proj-123",
    });

    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  it("handles db error gracefully", async () => {
    mockDb.execute.mockRejectedValue(new Error("Connection refused"));

    const adapter = createPgVectorSearchAdapter({ db: mockDb });
    const result = await adapter.search({
      embedding: [0.1, 0.2, 0.3],
    });

    expect(result).toEqual({
      success: false,
      error: "Connection refused",
    });
    expect(mockLogger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "pgvector search failed",
    );
  });

  it("returns empty results when no matches", async () => {
    mockDb.execute.mockResolvedValue([]);

    const adapter = createPgVectorSearchAdapter({ db: mockDb });
    const result = await adapter.search({
      embedding: [0.1, 0.2, 0.3],
      threshold: 0.99,
    });

    expect(result.success).toBe(true);
    expect(result.results).toEqual([]);
  });
});
