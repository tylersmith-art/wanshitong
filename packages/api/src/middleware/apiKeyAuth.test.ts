import { createHash } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB module before any imports that use it
vi.mock("../db/index.js", () => ({
  getConnectionString: vi.fn(() => "postgresql://mock"),
  getDb: vi.fn(() => ({})),
}));

// Mock jose so auth.ts doesn't hit real JWKS endpoint
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

import { router } from "../trpc.js";
import { apiKeyProcedure, flexibleAuthProcedure, hashApiKey } from "./apiKeyAuth.js";

// ── Helpers ──────────────────────────────────────────────────────────

const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const KEY_ID = "660e8400-e29b-41d4-a716-446655440001";
const API_KEY = "wst_test1234567890abcdef";
const KEY_HASH = createHash("sha256").update(API_KEY).digest("hex");

const mockUser = {
  id: USER_ID,
  sub: "auth0|user123",
  name: "Alice",
  email: "alice@example.com",
  role: "user",
  avatarUrl: null,
  lastLoginAt: null,
  pushOptOut: false,
  createdAt: new Date(),
};

const mockKeyRow = {
  id: KEY_ID,
  userId: USER_ID,
  name: "Test Key",
  keyHash: KEY_HASH,
  keyPrefix: "wst_test1234",
  lastUsedAt: null,
  createdAt: new Date(),
};

// Build a tiny test router so we can use createCaller
const testRouter = router({
  apiKeyOnly: apiKeyProcedure.query(({ ctx }) => ({
    userId: ctx.dbUser?.id ?? null,
    apiKeyId: ctx.apiKeyId ?? null,
  })),
  flexible: flexibleAuthProcedure.query(({ ctx }) => ({
    userId: ctx.dbUser?.id ?? null,
    apiKeyId: ctx.apiKeyId ?? null,
  })),
});

// ── Mock DB factory ──────────────────────────────────────────────────

function createMockDb(opts: {
  keyRow?: typeof mockKeyRow | null;
  userRow?: typeof mockUser | null;
}) {
  let callCount = 0;

  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => {
      callCount++;
      // First select query: apiKeys lookup
      // Second select query: users lookup
      if (callCount === 1) {
        return Promise.resolve(opts.keyRow ? [opts.keyRow] : []);
      }
      return Promise.resolve(opts.userRow ? [opts.userRow] : []);
    }),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
  };

  return chain;
}

const mockPubsub = {
  publish: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn(),
  close: vi.fn(),
};

// ── Tests ────────────────────────────────────────────────────────────

describe("hashApiKey", () => {
  it("returns deterministic sha256 hex digest", () => {
    const result = hashApiKey("wst_abc123");
    const expected = createHash("sha256").update("wst_abc123").digest("hex");
    expect(result).toBe(expected);
    expect(result).toHaveLength(64);
  });
});

describe("apiKeyProcedure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves user from a valid API key", async () => {
    const db = createMockDb({ keyRow: mockKeyRow, userRow: mockUser });
    const caller = testRouter.createCaller({
      user: null,
      db: db as any,
      pubsub: mockPubsub as any,
      rawToken: API_KEY,
    });

    const result = await caller.apiKeyOnly();
    expect(result.userId).toBe(USER_ID);
    expect(result.apiKeyId).toBe(KEY_ID);
  });

  it("updates lastUsedAt on successful auth", async () => {
    const db = createMockDb({ keyRow: mockKeyRow, userRow: mockUser });
    const caller = testRouter.createCaller({
      user: null,
      db: db as any,
      pubsub: mockPubsub as any,
      rawToken: API_KEY,
    });

    await caller.apiKeyOnly();
    expect(db.update).toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ lastUsedAt: expect.any(Date) }),
    );
  });

  it("throws UNAUTHORIZED when rawToken is null", async () => {
    const db = createMockDb({ keyRow: null, userRow: null });
    const caller = testRouter.createCaller({
      user: null,
      db: db as any,
      pubsub: mockPubsub as any,
      rawToken: null,
    });

    await expect(caller.apiKeyOnly()).rejects.toThrow("Valid API key required");
  });

  it("throws UNAUTHORIZED when token does not start with wst_", async () => {
    const db = createMockDb({ keyRow: null, userRow: null });
    const caller = testRouter.createCaller({
      user: null,
      db: db as any,
      pubsub: mockPubsub as any,
      rawToken: "some-jwt-token",
    });

    await expect(caller.apiKeyOnly()).rejects.toThrow("Valid API key required");
  });

  it("throws UNAUTHORIZED when API key hash is not found in DB", async () => {
    const db = createMockDb({ keyRow: null, userRow: null });
    const caller = testRouter.createCaller({
      user: null,
      db: db as any,
      pubsub: mockPubsub as any,
      rawToken: "wst_nonexistentkey",
    });

    await expect(caller.apiKeyOnly()).rejects.toThrow("Invalid API key");
  });

  it("throws UNAUTHORIZED when API key owner user is not found", async () => {
    const db = createMockDb({ keyRow: mockKeyRow, userRow: null });
    const caller = testRouter.createCaller({
      user: null,
      db: db as any,
      pubsub: mockPubsub as any,
      rawToken: API_KEY,
    });

    await expect(caller.apiKeyOnly()).rejects.toThrow(
      "API key owner not found",
    );
  });
});

describe("flexibleAuthProcedure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses JWT user when ctx.user is already set", async () => {
    // For JWT path, the limit mock returns the user on the first call
    let callCount = 0;
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(() => {
        callCount++;
        return Promise.resolve(callCount === 1 ? [mockUser] : []);
      }),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };

    const caller = testRouter.createCaller({
      user: { sub: "auth0|user123", email: "alice@example.com" },
      db: db as any,
      pubsub: mockPubsub as any,
      rawToken: "some-jwt-token",
    });

    const result = await caller.flexible();
    expect(result.userId).toBe(USER_ID);
    expect(result.apiKeyId).toBeNull();
    // Should NOT call update (no lastUsedAt tracking for JWT)
    expect(db.update).not.toHaveBeenCalled();
  });

  it("falls back to API key when ctx.user is null", async () => {
    const db = createMockDb({ keyRow: mockKeyRow, userRow: mockUser });
    const caller = testRouter.createCaller({
      user: null,
      db: db as any,
      pubsub: mockPubsub as any,
      rawToken: API_KEY,
    });

    const result = await caller.flexible();
    expect(result.userId).toBe(USER_ID);
    expect(result.apiKeyId).toBe(KEY_ID);
  });

  it("throws UNAUTHORIZED when neither JWT nor API key is present", async () => {
    const db = createMockDb({ keyRow: null, userRow: null });
    const caller = testRouter.createCaller({
      user: null,
      db: db as any,
      pubsub: mockPubsub as any,
      rawToken: null,
    });

    await expect(caller.flexible()).rejects.toThrow("UNAUTHORIZED");
  });

  it("throws UNAUTHORIZED when API key is invalid and no JWT", async () => {
    const db = createMockDb({ keyRow: null, userRow: null });
    const caller = testRouter.createCaller({
      user: null,
      db: db as any,
      pubsub: mockPubsub as any,
      rawToken: "wst_badkey",
    });

    await expect(caller.flexible()).rejects.toThrow("UNAUTHORIZED");
  });
});
