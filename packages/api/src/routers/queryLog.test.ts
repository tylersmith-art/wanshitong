import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────
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

vi.mock("../lib/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("../jobs/index.js", () => ({
  enqueueJob: vi.fn().mockResolvedValue("job-123"),
}));

import { router } from "../trpc.js";
import { queryLogRouter } from "./queryLog.js";

const testRouter = router({ queryLog: queryLogRouter });

// ── Constants ──────────────────────────────────────────────────────────
const ADMIN_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const REGULAR_USER_ID = "660e8400-e29b-41d4-a716-446655440001";
const API_KEY_ID = "770e8400-e29b-41d4-a716-446655440002";
const LOG_ID_1 = "880e8400-e29b-41d4-a716-446655440003";
const LOG_ID_2 = "990e8400-e29b-41d4-a716-446655440004";

const adminUser = {
  id: ADMIN_USER_ID,
  sub: "user123",
  email: "admin@example.com",
  name: "Admin",
  role: "admin",
  avatarUrl: null,
  lastLoginAt: null,
  pushOptOut: false,
  createdAt: new Date(),
};

const regularUser = {
  id: REGULAR_USER_ID,
  sub: "user456",
  email: "user@example.com",
  name: "Regular",
  role: "user",
  avatarUrl: null,
  lastLoginAt: null,
  pushOptOut: false,
  createdAt: new Date(),
};

const mockLogRow = (id: string) => ({
  id,
  apiKeyId: API_KEY_ID,
  apiKeyName: "Test Key",
  userEmail: "admin@example.com",
  query: "SELECT * FROM specs",
  resultCount: 5,
  durationMs: 42,
  createdAt: new Date("2026-01-15T10:00:00Z"),
});

describe("queryLogRouter", () => {
  let limitResult: unknown[];
  let innerJoinCount: number;

  const mockPubsub = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    close: vi.fn(),
  };

  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn(() => {
      const result = limitResult.shift();
      return Promise.resolve(result ?? []);
    }),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };

  const createCaller = (opts: {
    authenticated?: boolean;
    userRow?: typeof adminUser;
  }) => {
    const { authenticated = true, userRow = adminUser } = opts;

    // protectedProcedure will call select().from(users).where().limit(1)
    // to resolve dbUser. Push the user row first.
    if (authenticated) {
      limitResult.unshift([userRow]);
    }

    return testRouter.createCaller({
      user: authenticated
        ? { sub: userRow.sub, email: userRow.email }
        : null,
      db: mockDb as any,
      pubsub: mockPubsub as any,
      rawToken: null,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    limitResult = [];
    innerJoinCount = 0;

    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.innerJoin.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockImplementation(() => {
      const result = limitResult.shift();
      return Promise.resolve(result ?? []);
    });
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValue([]);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.delete.mockReturnThis();
  });

  // ─── list ──────────────────────────────────────────────────────────

  it("admin can list query logs", async () => {
    const rows = [mockLogRow(LOG_ID_1), mockLogRow(LOG_ID_2)];
    // list query result
    limitResult.push(rows);

    const caller = createCaller({ authenticated: true, userRow: adminUser });
    const result = await caller.queryLog.list({});

    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.id).toBe(LOG_ID_1);
    expect(result.items[0]!.apiKeyName).toBe("Test Key");
    expect(result.items[0]!.query).toBe("SELECT * FROM specs");
    expect(result.nextCursor).toBeUndefined();
  });

  it("non-admin gets FORBIDDEN", async () => {
    const caller = createCaller({ authenticated: true, userRow: regularUser });
    await expect(caller.queryLog.list({})).rejects.toThrow(
      "Admin access required",
    );
  });

  it("unauthenticated user gets UNAUTHORIZED", async () => {
    const caller = createCaller({ authenticated: false });
    await expect(caller.queryLog.list({})).rejects.toThrow("UNAUTHORIZED");
  });

  it("pagination with cursor returns nextCursor when more items exist", async () => {
    // Return limit+1 items to simulate "has more"
    const rows = Array.from({ length: 21 }, (_, i) =>
      mockLogRow(`${LOG_ID_1.slice(0, -2)}${String(i).padStart(2, "0")}`),
    );
    limitResult.push(rows);

    const caller = createCaller({ authenticated: true, userRow: adminUser });
    const result = await caller.queryLog.list({ limit: 20 });

    expect(result.items).toHaveLength(20);
    expect(result.nextCursor).toBeDefined();
    expect(result.nextCursor).toBe(result.items[19]!.id);
  });

  it("pagination returns no nextCursor when fewer items than limit", async () => {
    const rows = [mockLogRow(LOG_ID_1)];
    limitResult.push(rows);

    const caller = createCaller({ authenticated: true, userRow: adminUser });
    const result = await caller.queryLog.list({ limit: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeUndefined();
  });

  // ─── getById ───────────────────────────────────────────────────────

  it("getById returns full detail for admin", async () => {
    const row = mockLogRow(LOG_ID_1);
    limitResult.push([row]);

    const caller = createCaller({ authenticated: true, userRow: adminUser });
    const result = await caller.queryLog.getById({ id: LOG_ID_1 });

    expect(result.id).toBe(LOG_ID_1);
    expect(result.query).toBe("SELECT * FROM specs");
    expect(result.userEmail).toBe("admin@example.com");
    expect(result.durationMs).toBe(42);
  });

  it("getById throws NOT_FOUND for missing log", async () => {
    limitResult.push([]);

    const caller = createCaller({ authenticated: true, userRow: adminUser });
    await expect(
      caller.queryLog.getById({ id: LOG_ID_1 }),
    ).rejects.toThrow("Query log not found");
  });

  it("getById rejects non-admin", async () => {
    const caller = createCaller({ authenticated: true, userRow: regularUser });
    await expect(
      caller.queryLog.getById({ id: LOG_ID_1 }),
    ).rejects.toThrow("Admin access required");
  });

  it("getById requires authentication", async () => {
    const caller = createCaller({ authenticated: false });
    await expect(
      caller.queryLog.getById({ id: LOG_ID_1 }),
    ).rejects.toThrow("UNAUTHORIZED");
  });
});
