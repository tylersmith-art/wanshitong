import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { specRouter } from "./spec.js";

describe("specRouter", () => {
  const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const OTHER_USER_ID = "660e8400-e29b-41d4-a716-446655440001";
  const ORG_ID = "770e8400-e29b-41d4-a716-446655440002";
  const SPEC_ID = "990e8400-e29b-41d4-a716-446655440004";

  const now = new Date();

  const mockSpec = {
    id: SPEC_ID,
    name: "Test Spec",
    description: "A test spec",
    content: "spec content here",
    summary: null,
    embedding: null,
    visibility: "user",
    orgId: null,
    userId: USER_ID,
    embeddingStatus: "pending",
    createdAt: now,
    updatedAt: now,
  };

  const mockGlobalSpec = {
    ...mockSpec,
    id: "aa0e8400-e29b-41d4-a716-446655440005",
    visibility: "global",
    name: "Global Spec",
  };

  const mockOrgSpec = {
    ...mockSpec,
    id: "bb0e8400-e29b-41d4-a716-446655440006",
    visibility: "org",
    orgId: ORG_ID,
    name: "Org Spec",
  };

  const mockOtherUserSpec = {
    ...mockSpec,
    id: "cc0e8400-e29b-41d4-a716-446655440007",
    userId: OTHER_USER_ID,
    name: "Other User Spec",
  };

  const mockMember = {
    id: "dd0e8400-e29b-41d4-a716-446655440008",
    orgId: ORG_ID,
    userId: USER_ID,
    role: "member",
    createdAt: now,
  };

  const mockPubsub = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    close: vi.fn(),
  };

  let resultQueue: unknown[];
  let returningResults: unknown[];

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

  const createCaller = (opts: {
    authenticated?: boolean;
    role?: string;
  } = {}) => {
    const { authenticated = false, role = "user" } = opts;
    return specRouter.createCaller({
      user: authenticated ? { sub: "user123", email: "test@example.com" } : null,
      db: mockDb as any,
      pubsub: mockPubsub as any,
      rawToken: null,
      // protectedProcedure looks up dbUser via sub, but since we mock the db
      // we control what comes back from the limit() call (resultQueue)
    } as any);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resultQueue = [];
    returningResults = [];

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
    mockDb.returning.mockImplementation(() => {
      const result = returningResults.shift();
      return Promise.resolve(result ?? []);
    });
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.delete.mockReturnThis();
  });

  // ─── create ───────────────────────────────────────────────────────

  it("create creates a user-visibility spec", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID, role: "user" }]);
    // insert returning
    returningResults.push([mockSpec]);

    const caller = createCaller({ authenticated: true });
    const result = await caller.create({
      name: "Test Spec",
      content: "spec content here",
    });

    expect(result).toEqual(mockSpec);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:spec",
      expect.objectContaining({ action: "created" }),
    );
  });

  it("create org spec validates membership", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID, role: "user" }]);
    // requireMembership: found
    resultQueue.push([mockMember]);
    // insert returning
    returningResults.push([mockOrgSpec]);

    const caller = createCaller({ authenticated: true });
    const result = await caller.create({
      name: "Org Spec",
      content: "org content",
      visibility: "org",
      orgId: ORG_ID,
    });

    expect(result).toEqual(mockOrgSpec);
  });

  it("create org spec rejects non-member", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID, role: "user" }]);
    // requireMembership: not found
    resultQueue.push([]);

    const caller = createCaller({ authenticated: true });
    await expect(
      caller.create({
        name: "Org Spec",
        content: "org content",
        visibility: "org",
        orgId: ORG_ID,
      }),
    ).rejects.toThrow("Not a member of this organization");
  });

  it("create global spec requires admin role", async () => {
    // protectedProcedure: lookup dbUser (admin)
    resultQueue.push([{ id: USER_ID, role: "admin" }]);
    // insert returning
    returningResults.push([mockGlobalSpec]);

    const caller = createCaller({ authenticated: true });
    const result = await caller.create({
      name: "Global Spec",
      content: "global content",
      visibility: "global",
    });

    expect(result).toEqual(mockGlobalSpec);
  });

  it("create global spec rejects non-admin", async () => {
    // protectedProcedure: lookup dbUser (regular user)
    resultQueue.push([{ id: USER_ID, role: "user" }]);

    const caller = createCaller({ authenticated: true });
    await expect(
      caller.create({
        name: "Global Spec",
        content: "global content",
        visibility: "global",
      }),
    ).rejects.toThrow("Admin access required");
  });

  it("create requires authentication", async () => {
    const caller = createCaller({ authenticated: false });
    await expect(
      caller.create({ name: "Test", content: "content" }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── list ─────────────────────────────────────────────────────────

  it("list returns global + org (member) + own user specs", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID, role: "user" }]);

    // The list procedure makes multiple chained queries.
    // First: orgMembers query (select -> from -> where, terminal at where)
    // Second: architectureSpecs query (select -> from -> where -> orderBy, terminal at orderBy)
    let whereCallCount = 0;
    mockDb.where.mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount === 1) {
        // dbUser lookup chains to .limit()
        return mockDb;
      }
      if (whereCallCount === 2) {
        // orgMembers membership query — terminal
        return Promise.resolve([{ orgId: ORG_ID }]);
      }
      // architectureSpecs main query — chains to orderBy
      return mockDb;
    });
    mockDb.orderBy.mockResolvedValueOnce([mockGlobalSpec, mockOrgSpec, mockSpec]);

    const caller = createCaller({ authenticated: true });
    const result = await caller.list();

    expect(result).toEqual([mockGlobalSpec, mockOrgSpec, mockSpec]);
  });

  it("list does not return other users' private specs", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID, role: "user" }]);

    let whereCallCount = 0;
    mockDb.where.mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount === 1) return mockDb; // dbUser lookup
      if (whereCallCount === 2) return Promise.resolve([]); // no org memberships
      return mockDb; // main query
    });
    // Only own spec returned (other user's private spec filtered by query)
    mockDb.orderBy.mockResolvedValueOnce([mockSpec]);

    const caller = createCaller({ authenticated: true });
    const result = await caller.list();

    expect(result).toEqual([mockSpec]);
    expect(result).not.toContainEqual(
      expect.objectContaining({ userId: OTHER_USER_ID, visibility: "user" }),
    );
  });

  it("list does not return non-member org specs", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID, role: "user" }]);

    let whereCallCount = 0;
    mockDb.where.mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount === 1) return mockDb; // dbUser lookup
      if (whereCallCount === 2) return Promise.resolve([]); // no memberships
      return mockDb; // main query
    });
    mockDb.orderBy.mockResolvedValueOnce([mockGlobalSpec, mockSpec]);

    const caller = createCaller({ authenticated: true });
    const result = await caller.list();

    expect(result).toEqual([mockGlobalSpec, mockSpec]);
    expect(result).not.toContainEqual(
      expect.objectContaining({ visibility: "org" }),
    );
  });

  it("list requires authentication", async () => {
    const caller = createCaller({ authenticated: false });
    await expect(caller.list()).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── getById ──────────────────────────────────────────────────────

  it("getById returns own spec", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID, role: "user" }]);
    // getById: spec lookup
    resultQueue.push([mockSpec]);

    const caller = createCaller({ authenticated: true });
    const result = await caller.getById({ id: SPEC_ID });

    expect(result).toEqual(mockSpec);
  });

  it("getById returns global spec", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID, role: "user" }]);
    // getById: spec lookup
    resultQueue.push([mockGlobalSpec]);

    const caller = createCaller({ authenticated: true });
    const result = await caller.getById({ id: mockGlobalSpec.id });

    expect(result).toEqual(mockGlobalSpec);
  });

  it("getById returns org spec for member", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID, role: "user" }]);
    // getById: spec lookup
    resultQueue.push([mockOrgSpec]);
    // checkSpecAccess -> requireMembership
    resultQueue.push([mockMember]);

    const caller = createCaller({ authenticated: true });
    const result = await caller.getById({ id: mockOrgSpec.id });

    expect(result).toEqual(mockOrgSpec);
  });

  it("getById rejects access to other users' private spec", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID, role: "user" }]);
    // getById: spec lookup (belongs to another user)
    resultQueue.push([mockOtherUserSpec]);

    const caller = createCaller({ authenticated: true });
    await expect(
      caller.getById({ id: mockOtherUserSpec.id }),
    ).rejects.toThrow("Access denied");
  });

  it("getById returns NOT_FOUND for missing spec", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID, role: "user" }]);
    // getById: no spec found
    resultQueue.push([]);

    const caller = createCaller({ authenticated: true });
    await expect(
      caller.getById({ id: SPEC_ID }),
    ).rejects.toThrow("Spec not found");
  });

  it("getById requires authentication", async () => {
    const caller = createCaller({ authenticated: false });
    await expect(caller.getById({ id: SPEC_ID })).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── update ───────────────────────────────────────────────────────

  it("update succeeds for owner", async () => {
    const updatedSpec = { ...mockSpec, name: "Updated Spec" };

    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID, role: "user" }]);
    // update: fetch existing spec
    resultQueue.push([mockSpec]);
    // update returning
    returningResults.push([updatedSpec]);

    const caller = createCaller({ authenticated: true });
    const result = await caller.update({ id: SPEC_ID, name: "Updated Spec" });

    expect(result).toEqual(updatedSpec);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:spec",
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("update succeeds for admin on another user's spec", async () => {
    const updatedSpec = { ...mockOtherUserSpec, name: "Admin Updated" };

    // protectedProcedure: lookup dbUser (admin)
    resultQueue.push([{ id: USER_ID, role: "admin" }]);
    // update: fetch existing spec (owned by OTHER_USER_ID)
    resultQueue.push([mockOtherUserSpec]);
    // update returning
    returningResults.push([updatedSpec]);

    const caller = createCaller({ authenticated: true });
    const result = await caller.update({ id: mockOtherUserSpec.id, name: "Admin Updated" });

    expect(result).toEqual(updatedSpec);
  });

  it("update rejects non-owner non-admin", async () => {
    // protectedProcedure: lookup dbUser (regular user)
    resultQueue.push([{ id: USER_ID, role: "user" }]);
    // update: fetch existing spec (owned by OTHER_USER_ID)
    resultQueue.push([mockOtherUserSpec]);

    const caller = createCaller({ authenticated: true });
    await expect(
      caller.update({ id: mockOtherUserSpec.id, name: "Nope" }),
    ).rejects.toThrow("Not authorized to update this spec");
  });

  it("update requires authentication", async () => {
    const caller = createCaller({ authenticated: false });
    await expect(
      caller.update({ id: SPEC_ID, name: "Nope" }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── delete ───────────────────────────────────────────────────────

  it("delete succeeds for owner", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID, role: "user" }]);
    // delete: fetch existing spec
    resultQueue.push([mockSpec]);
    // delete returning
    returningResults.push([mockSpec]);

    const caller = createCaller({ authenticated: true });
    const result = await caller.delete({ id: SPEC_ID });

    expect(result).toEqual({ success: true });
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:spec",
      expect.objectContaining({ action: "deleted" }),
    );
  });

  it("delete succeeds for admin on another user's spec", async () => {
    // protectedProcedure: lookup dbUser (admin)
    resultQueue.push([{ id: USER_ID, role: "admin" }]);
    // delete: fetch existing spec (owned by OTHER_USER_ID)
    resultQueue.push([mockOtherUserSpec]);
    // delete returning
    returningResults.push([mockOtherUserSpec]);

    const caller = createCaller({ authenticated: true });
    const result = await caller.delete({ id: mockOtherUserSpec.id });

    expect(result).toEqual({ success: true });
  });

  it("delete rejects non-owner non-admin", async () => {
    // protectedProcedure: lookup dbUser (regular user)
    resultQueue.push([{ id: USER_ID, role: "user" }]);
    // delete: fetch existing spec (owned by OTHER_USER_ID)
    resultQueue.push([mockOtherUserSpec]);

    const caller = createCaller({ authenticated: true });
    await expect(
      caller.delete({ id: mockOtherUserSpec.id }),
    ).rejects.toThrow("Not authorized to delete this spec");
  });

  it("delete requires authentication", async () => {
    const caller = createCaller({ authenticated: false });
    await expect(caller.delete({ id: SPEC_ID })).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── Sync events are published on mutations ───────────────────────

  it("publishes sync event on create", async () => {
    resultQueue.push([{ id: USER_ID, role: "user" }]);
    returningResults.push([mockSpec]);

    const caller = createCaller({ authenticated: true });
    await caller.create({ name: "Test", content: "content" });

    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:spec",
      expect.objectContaining({
        action: "created",
        data: mockSpec,
        timestamp: expect.any(Number),
      }),
    );
  });

  it("publishes sync event on delete", async () => {
    resultQueue.push([{ id: USER_ID, role: "user" }]);
    resultQueue.push([mockSpec]);
    returningResults.push([mockSpec]);

    const caller = createCaller({ authenticated: true });
    await caller.delete({ id: SPEC_ID });

    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:spec",
      expect.objectContaining({
        action: "deleted",
        data: mockSpec,
        timestamp: expect.any(Number),
      }),
    );
  });
});
