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

vi.mock("../jobs/index.js", () => ({
  enqueueJob: vi.fn().mockResolvedValue("job-123"),
}));

// We need to import the router under test. Since the test pattern uses
// `appRouter` via createCaller, and our router is NOT wired in yet, we
// build a lightweight local router just for this test.
import { router } from "../trpc.js";
import { apiKeyRouter } from "./apiKey.js";

const testRouter = router({ apiKey: apiKeyRouter });

// ── Constants ──────────────────────────────────────────────────────────
const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_USER_ID = "660e8400-e29b-41d4-a716-446655440001";
const KEY_ID = "880e8400-e29b-41d4-a716-446655440003";

describe("apiKeyRouter", () => {
  let resultQueue: unknown[];

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

  const createCaller = (authenticated = false) =>
    testRouter.createCaller({
      user: authenticated
        ? { sub: "user123", email: "test@example.com" }
        : null,
      db: mockDb as any,
      pubsub: mockPubsub as any,
      rawToken: null,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    resultQueue = [];

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockImplementation(() => {
      const result = resultQueue.shift();
      return Promise.resolve(result ?? []);
    });
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValue([]);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.delete.mockReturnThis();
  });

  // ─── generate ──────────────────────────────────────────────────────

  it("generate returns a wst_ prefixed key", async () => {
    const mockRow = {
      id: KEY_ID,
      userId: USER_ID,
      name: "My Key",
      keyHash: "hash-value",
      keyPrefix: "wst_abcd",
      lastUsedAt: null,
      createdAt: new Date(),
    };

    // protectedProcedure does: select().from(users).where().limit(1)
    resultQueue.push([{ id: USER_ID, sub: "user123", email: "test@example.com", name: "Test", role: "user", createdAt: new Date() }]);
    // insert().values().returning()
    mockDb.returning.mockResolvedValueOnce([mockRow]);

    const caller = createCaller(true);
    const result = await caller.apiKey.generate({ name: "My Key" });

    expect(result.plaintextKey).toMatch(/^wst_[a-f0-9]{64}$/);
    expect(result.id).toBe(KEY_ID);
    expect(result.name).toBe("My Key");
    expect(result.keyPrefix).toBeDefined();
    // Ensure the hash is NOT in the response
    expect((result as any).keyHash).toBeUndefined();
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      expect.stringContaining("apiKey"),
      expect.objectContaining({ action: "created" }),
    );
  });

  it("generate requires authentication", async () => {
    const caller = createCaller(false);
    await expect(
      caller.apiKey.generate({ name: "Test Key" }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── list ──────────────────────────────────────────────────────────

  it("list returns keys without hash or plaintext", async () => {
    const mockKeyRow = {
      id: KEY_ID,
      userId: USER_ID,
      name: "My Key",
      keyPrefix: "wst_abcd",
      lastUsedAt: null,
      createdAt: new Date(),
    };

    // protectedProcedure: select().from(users).where().limit(1)
    resultQueue.push([{ id: USER_ID, sub: "user123", email: "test@example.com", name: "Test", role: "user", createdAt: new Date() }]);

    // The list query uses select({columns}).from(apiKeys).where() where
    // where() is the terminal (no .limit() after it). We track where()
    // calls: first is for protectedProcedure (chains to .limit()), second
    // is the terminal list query.
    let whereCallCount = 0;
    mockDb.where.mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount <= 1) {
        // protectedProcedure path — chains to .limit()
        return mockDb;
      }
      // list query — terminal, return the result directly
      return Promise.resolve([mockKeyRow]);
    });

    const caller = createCaller(true);
    const result = await caller.apiKey.list();

    expect(Array.isArray(result)).toBe(true);
    const key = result[0];
    expect(key).toBeDefined();
    expect(key!.id).toBe(KEY_ID);
    expect(key!.name).toBe("My Key");
    expect(key!.keyPrefix).toBe("wst_abcd");
    // Must never expose sensitive fields
    expect((key as any).keyHash).toBeUndefined();
    expect((key as any).plaintextKey).toBeUndefined();
  });

  it("list requires authentication", async () => {
    const caller = createCaller(false);
    await expect(caller.apiKey.list()).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── revoke ────────────────────────────────────────────────────────

  it("revoke deletes own key", async () => {
    const mockKeyRow = {
      id: KEY_ID,
      userId: USER_ID,
      name: "My Key",
      keyHash: "hash",
      keyPrefix: "wst_abcd",
      lastUsedAt: null,
      createdAt: new Date(),
    };

    // protectedProcedure lookup
    resultQueue.push([{ id: USER_ID, sub: "user123", email: "test@example.com", name: "Test", role: "user", createdAt: new Date() }]);
    // Fetch existing key: select().from().where().limit(1)
    resultQueue.push([mockKeyRow]);
    // delete().where().returning()
    mockDb.returning.mockResolvedValueOnce([mockKeyRow]);

    const caller = createCaller(true);
    const result = await caller.apiKey.revoke({ id: KEY_ID });

    expect(result).toEqual({ success: true });
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      expect.stringContaining("apiKey"),
      expect.objectContaining({ action: "deleted" }),
    );
  });

  it("revoke rejects deleting another user's key", async () => {
    const otherUserKey = {
      id: KEY_ID,
      userId: OTHER_USER_ID,
      name: "Not Mine",
      keyHash: "hash",
      keyPrefix: "wst_xxxx",
      lastUsedAt: null,
      createdAt: new Date(),
    };

    // protectedProcedure lookup
    resultQueue.push([{ id: USER_ID, sub: "user123", email: "test@example.com", name: "Test", role: "user", createdAt: new Date() }]);
    // Fetch existing key — belongs to another user
    resultQueue.push([otherUserKey]);

    const caller = createCaller(true);
    await expect(
      caller.apiKey.revoke({ id: KEY_ID }),
    ).rejects.toThrow("Cannot revoke another user's API key");
  });

  it("revoke throws NOT_FOUND for missing key", async () => {
    // protectedProcedure lookup
    resultQueue.push([{ id: USER_ID, sub: "user123", email: "test@example.com", name: "Test", role: "user", createdAt: new Date() }]);
    // Key not found
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.apiKey.revoke({ id: KEY_ID }),
    ).rejects.toThrow("API key not found");
  });

  it("revoke requires authentication", async () => {
    const caller = createCaller(false);
    await expect(
      caller.apiKey.revoke({ id: KEY_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });
});
