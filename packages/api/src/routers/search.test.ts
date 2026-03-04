import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────
vi.mock("../db/index.js", () => ({
  getConnectionString: vi.fn(() => "postgresql://mock"),
  getDb: vi.fn(() => ({})),
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock-jwks"),
  jwtVerify: vi.fn().mockResolvedValue({
    payload: { sub: "user123", email: "test@example.com" },
    protectedHeader: { alg: "RS256" },
  }),
}));

vi.mock("../lib/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("../lib/env.js", () => ({
  getEnv: vi.fn(() => ({
    EMBEDDING_PROVIDER: "console",
  })),
}));

const mockEmbed = vi.fn();
const mockSearch = vi.fn();

vi.mock("../services/embedding/index.js", () => ({
  getEmbeddingAdapter: vi.fn(() => ({
    embed: mockEmbed,
  })),
}));

vi.mock("../services/search/index.js", () => ({
  getSearchAdapter: vi.fn(() => ({
    search: mockSearch,
  })),
}));

import { router } from "../trpc.js";
import { searchRouter } from "./search.js";

const testRouter = router({ search: searchRouter });

// ── Constants ──────────────────────────────────────────────────────────
const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const API_KEY_ID = "660e8400-e29b-41d4-a716-446655440001";
const PROJECT_ID = "770e8400-e29b-41d4-a716-446655440002";
const ORG_ID = "880e8400-e29b-41d4-a716-446655440003";

const MOCK_SEARCH_RESULTS = [
  {
    specId: "990e8400-e29b-41d4-a716-446655440004",
    name: "Auth Spec",
    description: "Authentication architecture",
    content: "JWT-based authentication flow...",
    similarity: 0.92,
  },
  {
    specId: "aa0e8400-e29b-41d4-a716-446655440005",
    name: "Database Spec",
    description: "Database design patterns",
    content: "PostgreSQL with connection pooling...",
    similarity: 0.85,
  },
];

describe("searchRouter", () => {
  let resultQueue: unknown[];
  let insertedValues: unknown[];

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
    values: vi.fn((vals: unknown) => {
      insertedValues.push(vals);
      return mockDb;
    }),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };

  /** Create a caller with JWT auth (apiKeyId = null) */
  const createJwtCaller = () =>
    testRouter.createCaller({
      user: { sub: "user123", email: "test@example.com" },
      db: mockDb as any,
      pubsub: mockPubsub as any,
      rawToken: null,
    });

  /** Create a caller with API key auth (apiKeyId set) */
  const createApiKeyCaller = () =>
    testRouter.createCaller({
      user: null,
      db: mockDb as any,
      pubsub: mockPubsub as any,
      rawToken: "wst_testapikey123",
    });

  /** Create an unauthenticated caller */
  const createUnauthCaller = () =>
    testRouter.createCaller({
      user: null,
      db: mockDb as any,
      pubsub: mockPubsub as any,
      rawToken: null,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    resultQueue = [];
    insertedValues = [];

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockImplementation(() => {
      const result = resultQueue.shift();
      return Promise.resolve(result ?? []);
    });
    mockDb.insert.mockReturnThis();
    mockDb.values.mockImplementation((vals: unknown) => {
      insertedValues.push(vals);
      return mockDb;
    });
    mockDb.returning.mockResolvedValue([]);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.delete.mockReturnThis();

    // Default adapter mocks: success
    mockEmbed.mockResolvedValue({
      success: true,
      embedding: [0.1, 0.2, 0.3],
      dimensions: 3,
    });

    mockSearch.mockResolvedValue({
      success: true,
      results: MOCK_SEARCH_RESULTS,
    });
  });

  // ─── Successful search ─────────────────────────────────────────────

  it("returns search results for a basic query (JWT auth)", async () => {
    // flexibleAuthProcedure JWT path: select().from(users).where().limit(1)
    resultQueue.push([
      {
        id: USER_ID,
        sub: "user123",
        email: "test@example.com",
        name: "Test",
        role: "user",
        createdAt: new Date(),
      },
    ]);

    const caller = createJwtCaller();
    const result = await caller.search.search({ query: "authentication" });

    expect(result.results).toHaveLength(2);
    expect(result.results[0].specId).toBe(MOCK_SEARCH_RESULTS[0].specId);
    expect(result.results[0].similarity).toBe(0.92);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    expect(mockEmbed).toHaveBeenCalledWith({ text: "authentication" });
    expect(mockSearch).toHaveBeenCalledWith({
      embedding: [0.1, 0.2, 0.3],
      projectId: undefined,
      limit: 10,
    });
  });

  it("passes projectId and custom limit to search adapter", async () => {
    // flexibleAuthProcedure JWT path: user lookup
    resultQueue.push([
      {
        id: USER_ID,
        sub: "user123",
        email: "test@example.com",
        name: "Test",
        role: "user",
        createdAt: new Date(),
      },
    ]);
    // Project lookup
    resultQueue.push([{ id: PROJECT_ID, orgId: ORG_ID, name: "Test Project" }]);
    // Org membership check
    resultQueue.push([
      { id: "mem-1", orgId: ORG_ID, userId: USER_ID, role: "member" },
    ]);

    const caller = createJwtCaller();
    const result = await caller.search.search({
      query: "database patterns",
      projectId: PROJECT_ID,
      limit: 5,
    });

    expect(result.results).toHaveLength(2);
    expect(mockSearch).toHaveBeenCalledWith({
      embedding: [0.1, 0.2, 0.3],
      projectId: PROJECT_ID,
      limit: 5,
    });
  });

  // ─── Project access check ─────────────────────────────────────────

  it("rejects search when user is not a member of the project org", async () => {
    // flexibleAuthProcedure JWT path: user lookup
    resultQueue.push([
      {
        id: USER_ID,
        sub: "user123",
        email: "test@example.com",
        name: "Test",
        role: "user",
        createdAt: new Date(),
      },
    ]);
    // Project lookup
    resultQueue.push([{ id: PROJECT_ID, orgId: ORG_ID, name: "Test Project" }]);
    // Org membership check: no member found
    resultQueue.push([]);

    const caller = createJwtCaller();
    await expect(
      caller.search.search({ query: "test", projectId: PROJECT_ID }),
    ).rejects.toThrow("Not a member of this organization");
  });

  it("throws NOT_FOUND when projectId does not exist", async () => {
    // flexibleAuthProcedure JWT path: user lookup
    resultQueue.push([
      {
        id: USER_ID,
        sub: "user123",
        email: "test@example.com",
        name: "Test",
        role: "user",
        createdAt: new Date(),
      },
    ]);
    // Project lookup: not found
    resultQueue.push([]);

    const caller = createJwtCaller();
    await expect(
      caller.search.search({ query: "test", projectId: PROJECT_ID }),
    ).rejects.toThrow("Project not found");
  });

  // ─── Query logging ────────────────────────────────────────────────

  it("writes query log for API key authenticated requests", async () => {
    // flexibleAuthProcedure API key path:
    // 1. select apiKeys by keyHash -> limit(1)
    resultQueue.push([
      {
        id: API_KEY_ID,
        userId: USER_ID,
        name: "My Key",
        keyHash: "hash",
        keyPrefix: "wst_test",
      },
    ]);
    // 2. update apiKeys lastUsedAt (set().where() returns mockDb)
    // 3. select user by id -> limit(1)
    resultQueue.push([
      {
        id: USER_ID,
        sub: "user123",
        email: "test@example.com",
        name: "Test",
        role: "user",
        createdAt: new Date(),
      },
    ]);

    const caller = createApiKeyCaller();
    await caller.search.search({ query: "auth patterns" });

    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toEqual(
      expect.objectContaining({
        apiKeyId: API_KEY_ID,
        query: "auth patterns",
        resultCount: 2,
      }),
    );
  });

  it("does NOT write query log for JWT authenticated requests", async () => {
    // flexibleAuthProcedure JWT path: user lookup
    resultQueue.push([
      {
        id: USER_ID,
        sub: "user123",
        email: "test@example.com",
        name: "Test",
        role: "user",
        createdAt: new Date(),
      },
    ]);

    const caller = createJwtCaller();
    await caller.search.search({ query: "test query" });

    // insert should never be called (no query log for JWT)
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  // ─── Embedding failure ────────────────────────────────────────────

  it("returns error when embedding generation fails", async () => {
    // flexibleAuthProcedure JWT path: user lookup
    resultQueue.push([
      {
        id: USER_ID,
        sub: "user123",
        email: "test@example.com",
        name: "Test",
        role: "user",
        createdAt: new Date(),
      },
    ]);

    mockEmbed.mockResolvedValueOnce({
      success: false,
      error: "Embedding service unavailable",
    });

    const caller = createJwtCaller();
    await expect(
      caller.search.search({ query: "test" }),
    ).rejects.toThrow("Failed to generate embedding");
  });

  // ─── Search failure ───────────────────────────────────────────────

  it("returns error when search adapter fails", async () => {
    // flexibleAuthProcedure JWT path: user lookup
    resultQueue.push([
      {
        id: USER_ID,
        sub: "user123",
        email: "test@example.com",
        name: "Test",
        role: "user",
        createdAt: new Date(),
      },
    ]);

    mockSearch.mockResolvedValueOnce({
      success: false,
      error: "Search index unavailable",
    });

    const caller = createJwtCaller();
    await expect(
      caller.search.search({ query: "test" }),
    ).rejects.toThrow("Search failed");
  });

  // ─── Auth required ────────────────────────────────────────────────

  it("rejects unauthenticated requests", async () => {
    const caller = createUnauthCaller();
    await expect(
      caller.search.search({ query: "test" }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── Input validation ─────────────────────────────────────────────

  it("rejects empty query string", async () => {
    const caller = createJwtCaller();
    await expect(
      caller.search.search({ query: "" }),
    ).rejects.toThrow();
  });

  it("returns empty results when search yields none", async () => {
    // flexibleAuthProcedure JWT path: user lookup
    resultQueue.push([
      {
        id: USER_ID,
        sub: "user123",
        email: "test@example.com",
        name: "Test",
        role: "user",
        createdAt: new Date(),
      },
    ]);

    mockSearch.mockResolvedValueOnce({
      success: true,
      results: [],
    });

    const caller = createJwtCaller();
    const result = await caller.search.search({ query: "obscure topic" });

    expect(result.results).toHaveLength(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
