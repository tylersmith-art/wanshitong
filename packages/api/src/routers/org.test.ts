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

import { appRouter } from "./index.js";

describe("orgRouter", () => {
  const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const OTHER_USER_ID = "660e8400-e29b-41d4-a716-446655440001";
  const ORG_ID = "770e8400-e29b-41d4-a716-446655440002";
  const MEMBER_ID = "880e8400-e29b-41d4-a716-446655440003";

  const mockOrg = {
    id: ORG_ID,
    name: "Acme Corp",
    slug: "acme-corp",
    createdAt: new Date(),
  };

  const mockOwnerMember = {
    id: MEMBER_ID,
    orgId: ORG_ID,
    userId: USER_ID,
    role: "owner",
    createdAt: new Date(),
  };

  const mockAdminMember = {
    ...mockOwnerMember,
    userId: OTHER_USER_ID,
    role: "admin",
  };

  const mockRegularMember = {
    ...mockOwnerMember,
    userId: OTHER_USER_ID,
    role: "member",
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

  const createCaller = (authenticated = false) =>
    appRouter.createCaller({
      user: authenticated ? { sub: "user123", email: "test@example.com" } : null,
      db: mockDb as any,
      pubsub: mockPubsub as any,
      rawToken: null,
    });

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

  it("create creates org and adds creator as owner", async () => {
    // protectedProcedure: lookup dbUser by sub
    resultQueue.push([{ id: USER_ID }]);
    // insert org returning
    returningResults.push([mockOrg]);
    // insert orgMember (no returning needed, but values() is called)

    const caller = createCaller(true);
    const result = await caller.org.create({ name: "Acme Corp", slug: "acme-corp" });

    expect(result).toEqual(mockOrg);
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      expect.stringContaining("org"),
      expect.objectContaining({ action: "created" }),
    );
  });

  it("create requires authentication", async () => {
    const caller = createCaller(false);
    await expect(
      caller.org.create({ name: "Acme Corp", slug: "acme-corp" }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── list ─────────────────────────────────────────────────────────

  it("list returns only orgs user is member of", async () => {
    // protectedProcedure: lookup dbUser by sub
    resultQueue.push([{ id: USER_ID }]);

    // Override where to handle the two different queries
    let whereCallCount = 0;
    mockDb.where.mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount === 1) {
        // dbUser lookup chains to .limit()
        return mockDb;
      }
      if (whereCallCount === 2) {
        // orgMembers query — terminal (no .limit() in this path)
        return Promise.resolve([{ orgId: ORG_ID }]);
      }
      return mockDb;
    });
    // orderBy is the terminal for the organizations query
    mockDb.orderBy.mockResolvedValue([mockOrg]);

    const caller = createCaller(true);
    const result = await caller.org.list();

    expect(result).toEqual([mockOrg]);
  });

  it("list returns empty when user has no memberships", async () => {
    // protectedProcedure: lookup dbUser by sub
    resultQueue.push([{ id: USER_ID }]);

    let whereCallCount = 0;
    mockDb.where.mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount === 1) {
        return mockDb; // dbUser lookup
      }
      // orgMembers query — no memberships
      return Promise.resolve([]);
    });

    const caller = createCaller(true);
    const result = await caller.org.list();

    expect(result).toEqual([]);
  });

  it("list requires authentication", async () => {
    const caller = createCaller(false);
    await expect(caller.org.list()).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── getById ──────────────────────────────────────────────────────

  it("getById returns org for member", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireMembership: orgMembers query
    resultQueue.push([mockOwnerMember]);
    // getById: organizations query
    resultQueue.push([mockOrg]);

    const caller = createCaller(true);
    const result = await caller.org.getById({ id: ORG_ID });

    expect(result).toEqual(mockOrg);
  });

  it("getById rejects non-member", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireMembership: no membership found
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(caller.org.getById({ id: ORG_ID })).rejects.toThrow(
      "Not a member of this organization",
    );
  });

  // ─── update ───────────────────────────────────────────────────────

  it("update succeeds for owner", async () => {
    const updatedOrg = { ...mockOrg, name: "Acme Inc" };

    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireMembership: owner
    resultQueue.push([mockOwnerMember]);
    // update returning
    returningResults.push([updatedOrg]);

    const caller = createCaller(true);
    const result = await caller.org.update({ id: ORG_ID, name: "Acme Inc" });

    expect(result).toEqual(updatedOrg);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      expect.stringContaining("org"),
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("update rejects for regular member", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireMembership: member role
    resultQueue.push([{ ...mockOwnerMember, role: "member" }]);

    const caller = createCaller(true);
    await expect(
      caller.org.update({ id: ORG_ID, name: "Acme Inc" }),
    ).rejects.toThrow("Only owner/admin can update organization");
  });

  it("update requires authentication", async () => {
    const caller = createCaller(false);
    await expect(
      caller.org.update({ id: ORG_ID, name: "Acme Inc" }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── delete ───────────────────────────────────────────────────────

  it("delete succeeds for owner", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireMembership: owner
    resultQueue.push([mockOwnerMember]);
    // delete returning
    returningResults.push([mockOrg]);

    const caller = createCaller(true);
    const result = await caller.org.delete({ id: ORG_ID });

    expect(result).toEqual({ success: true });
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      expect.stringContaining("org"),
      expect.objectContaining({ action: "deleted" }),
    );
  });

  it("delete rejects for admin", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireMembership: admin role
    resultQueue.push([{ ...mockOwnerMember, role: "admin" }]);

    const caller = createCaller(true);
    await expect(caller.org.delete({ id: ORG_ID })).rejects.toThrow(
      "Only owner can delete organization",
    );
  });

  it("delete requires authentication", async () => {
    const caller = createCaller(false);
    await expect(caller.org.delete({ id: ORG_ID })).rejects.toThrow(
      "UNAUTHORIZED",
    );
  });

  // ─── addMember ────────────────────────────────────────────────────

  it("addMember succeeds for owner", async () => {
    const newMember = { ...mockRegularMember, id: "new-member-id" };

    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireMembership: owner
    resultQueue.push([mockOwnerMember]);
    // insert returning
    returningResults.push([newMember]);

    const caller = createCaller(true);
    const result = await caller.org.addMember({
      orgId: ORG_ID,
      userId: OTHER_USER_ID,
      role: "member",
    });

    expect(result).toEqual(newMember);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      expect.stringContaining("org"),
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("addMember succeeds for admin", async () => {
    const newMember = { ...mockRegularMember, id: "new-member-id" };

    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireMembership: admin
    resultQueue.push([{ ...mockOwnerMember, role: "admin" }]);
    // insert returning
    returningResults.push([newMember]);

    const caller = createCaller(true);
    const result = await caller.org.addMember({
      orgId: ORG_ID,
      userId: OTHER_USER_ID,
      role: "member",
    });

    expect(result).toEqual(newMember);
  });

  it("addMember rejects for regular member", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireMembership: member role
    resultQueue.push([{ ...mockOwnerMember, role: "member" }]);

    const caller = createCaller(true);
    await expect(
      caller.org.addMember({ orgId: ORG_ID, userId: OTHER_USER_ID, role: "member" }),
    ).rejects.toThrow("Only owner/admin can add members");
  });

  it("addMember requires authentication", async () => {
    const caller = createCaller(false);
    await expect(
      caller.org.addMember({ orgId: ORG_ID, userId: OTHER_USER_ID, role: "member" }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── removeMember ─────────────────────────────────────────────────

  it("removeMember self-remove works", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // delete returning (self-remove skips requireMembership)
    returningResults.push([mockOwnerMember]);

    const caller = createCaller(true);
    const result = await caller.org.removeMember({
      orgId: ORG_ID,
      userId: USER_ID,
    });

    expect(result).toEqual({ success: true });
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      expect.stringContaining("org"),
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("removeMember by owner works", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireMembership: owner (not self-remove)
    resultQueue.push([mockOwnerMember]);
    // delete returning
    returningResults.push([mockRegularMember]);

    const caller = createCaller(true);
    const result = await caller.org.removeMember({
      orgId: ORG_ID,
      userId: OTHER_USER_ID,
    });

    expect(result).toEqual({ success: true });
  });

  it("removeMember rejects for regular member removing others", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireMembership: member role
    resultQueue.push([{ ...mockOwnerMember, role: "member" }]);

    const caller = createCaller(true);
    await expect(
      caller.org.removeMember({ orgId: ORG_ID, userId: OTHER_USER_ID }),
    ).rejects.toThrow("Only owner/admin can remove members");
  });

  it("removeMember requires authentication", async () => {
    const caller = createCaller(false);
    await expect(
      caller.org.removeMember({ orgId: ORG_ID, userId: OTHER_USER_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── updateMemberRole ─────────────────────────────────────────────

  it("updateMemberRole succeeds for owner", async () => {
    const updatedMember = { ...mockRegularMember, role: "admin" };

    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireMembership: owner
    resultQueue.push([mockOwnerMember]);
    // update returning
    returningResults.push([updatedMember]);

    const caller = createCaller(true);
    const result = await caller.org.updateMemberRole({
      orgId: ORG_ID,
      userId: OTHER_USER_ID,
      role: "admin",
    });

    expect(result).toEqual(updatedMember);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      expect.stringContaining("org"),
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("updateMemberRole rejects for admin", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireMembership: admin role
    resultQueue.push([{ ...mockOwnerMember, role: "admin" }]);

    const caller = createCaller(true);
    await expect(
      caller.org.updateMemberRole({ orgId: ORG_ID, userId: OTHER_USER_ID, role: "member" }),
    ).rejects.toThrow("Only owner can update member roles");
  });

  it("updateMemberRole requires authentication", async () => {
    const caller = createCaller(false);
    await expect(
      caller.org.updateMemberRole({ orgId: ORG_ID, userId: OTHER_USER_ID, role: "admin" }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── listMembers ──────────────────────────────────────────────────

  it("listMembers returns members for org member", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireMembership: member
    resultQueue.push([mockOwnerMember]);

    // listMembers query chains where().orderBy() — orderBy is terminal
    mockDb.orderBy.mockResolvedValueOnce([mockOwnerMember, mockRegularMember]);

    const caller = createCaller(true);
    const result = await caller.org.listMembers({ orgId: ORG_ID });

    expect(result).toEqual([mockOwnerMember, mockRegularMember]);
  });

  it("listMembers rejects non-member", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireMembership: not a member
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.org.listMembers({ orgId: ORG_ID }),
    ).rejects.toThrow("Not a member of this organization");
  });

  it("listMembers requires authentication", async () => {
    const caller = createCaller(false);
    await expect(
      caller.org.listMembers({ orgId: ORG_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── Sync events are published on mutations ───────────────────────

  it("publishes sync event on create", async () => {
    resultQueue.push([{ id: USER_ID }]);
    returningResults.push([mockOrg]);

    const caller = createCaller(true);
    await caller.org.create({ name: "Test", slug: "test" });

    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:org",
      expect.objectContaining({
        action: "created",
        data: mockOrg,
        timestamp: expect.any(Number),
      }),
    );
  });

  it("publishes sync event on delete", async () => {
    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([mockOwnerMember]);
    returningResults.push([mockOrg]);

    const caller = createCaller(true);
    await caller.org.delete({ id: ORG_ID });

    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:org",
      expect.objectContaining({
        action: "deleted",
        data: mockOrg,
        timestamp: expect.any(Number),
      }),
    );
  });
});
