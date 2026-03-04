import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module
vi.mock("../db/index.js", () => ({
  getConnectionString: vi.fn(() => "postgresql://mock"),
  getDb: vi.fn(() => ({})),
}));

// Mock jose for auth middleware
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

import { appRouter } from "./index.js";

describe("userRouter", () => {
  const mockUser = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: "Alice",
    email: "alice@example.com",
    role: "user",
    createdAt: new Date(),
  };

  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue([mockUser]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([mockUser]),
    delete: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([mockUser]),
  };

  const mockPubsub = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    close: vi.fn(),
  };

  const createCaller = (authenticated = false) =>
    appRouter.createCaller({
      user: authenticated ? { sub: "user123", email: "test@example.com" } : null,
      db: mockDb as any,
      pubsub: mockPubsub as any,
      rawToken: null,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chainable mock methods
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.orderBy.mockResolvedValue([mockUser]);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValue([mockUser]);
    mockDb.delete.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValue([mockUser]);
  });

  it("list returns users", async () => {
    const caller = createCaller();
    const result = await caller.user.list();
    expect(result).toEqual([mockUser]);
  });

  it("create requires authentication", async () => {
    const caller = createCaller(false);
    await expect(
      caller.user.create({ name: "Bob", email: "bob@example.com" }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("create inserts user when authenticated", async () => {
    const caller = createCaller(true);
    const result = await caller.user.create({ name: "Bob", email: "bob@example.com" });
    expect(result).toEqual(mockUser);
    expect(mockPubsub.publish).toHaveBeenCalled();
  });

  it("delete requires authentication", async () => {
    const caller = createCaller(false);
    await expect(
      caller.user.delete({ email: "alice@example.com" }),
    ).rejects.toThrow("UNAUTHORIZED");
  });
});
