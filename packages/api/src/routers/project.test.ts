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

import { router } from "../trpc.js";
import { projectRouter } from "./project.js";

const testRouter = router({ project: projectRouter });

describe("projectRouter", () => {
  const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const OTHER_USER_ID = "660e8400-e29b-41d4-a716-446655440001";
  const ORG_ID = "770e8400-e29b-41d4-a716-446655440002";
  const OTHER_ORG_ID = "770e8400-e29b-41d4-a716-446655440099";
  const PROJECT_ID = "880e8400-e29b-41d4-a716-446655440003";
  const SPEC_ID = "990e8400-e29b-41d4-a716-446655440004";
  const LINK_ID = "aa0e8400-e29b-41d4-a716-446655440005";

  const mockProject = {
    id: PROJECT_ID,
    orgId: ORG_ID,
    name: "My Project",
    description: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockOwnerMember = {
    id: "mem-001",
    orgId: ORG_ID,
    userId: USER_ID,
    role: "owner",
    createdAt: new Date(),
  };

  const mockAdminMember = {
    ...mockOwnerMember,
    role: "admin",
  };

  const mockRegularMember = {
    ...mockOwnerMember,
    role: "member",
  };

  const mockGlobalSpec = {
    id: SPEC_ID,
    name: "Global Spec",
    visibility: "global",
    orgId: null,
    userId: OTHER_USER_ID,
  };

  const mockOrgSpec = {
    id: SPEC_ID,
    name: "Org Spec",
    visibility: "org",
    orgId: ORG_ID,
    userId: OTHER_USER_ID,
  };

  const mockOtherOrgSpec = {
    id: SPEC_ID,
    name: "Other Org Spec",
    visibility: "org",
    orgId: OTHER_ORG_ID,
    userId: OTHER_USER_ID,
  };

  const mockUserSpec = {
    id: SPEC_ID,
    name: "User Spec",
    visibility: "user",
    orgId: null,
    userId: USER_ID,
  };

  const mockOtherUserSpec = {
    id: SPEC_ID,
    name: "Other User Spec",
    visibility: "user",
    orgId: null,
    userId: OTHER_USER_ID,
  };

  const mockProjectSpec = {
    id: LINK_ID,
    projectId: PROJECT_ID,
    specId: SPEC_ID,
    createdAt: new Date(),
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

  it("create creates project when caller is org member", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireMembership check
    resultQueue.push([mockOwnerMember]);
    // insert project returning
    returningResults.push([mockProject]);

    const caller = createCaller(true);
    const result = await caller.project.create({
      name: "My Project",
      orgId: ORG_ID,
    });

    expect(result).toEqual(mockProject);
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:project",
      expect.objectContaining({ action: "created" }),
    );
  });

  it("create requires org membership", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireMembership: not a member
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.project.create({ name: "My Project", orgId: ORG_ID }),
    ).rejects.toThrow("Not a member of this organization");
  });

  it("create requires authentication", async () => {
    const caller = createCaller(false);
    await expect(
      caller.project.create({ name: "My Project", orgId: ORG_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── list ─────────────────────────────────────────────────────────

  it("list returns projects scoped to orgId", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireMembership check
    resultQueue.push([mockOwnerMember]);

    // list query chains where().orderBy() — orderBy is terminal
    mockDb.orderBy.mockResolvedValueOnce([mockProject]);

    const caller = createCaller(true);
    const result = await caller.project.list({ orgId: ORG_ID });

    expect(result).toEqual([mockProject]);
  });

  it("list requires org membership", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireMembership: not a member
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.project.list({ orgId: ORG_ID }),
    ).rejects.toThrow("Not a member of this organization");
  });

  it("list requires authentication", async () => {
    const caller = createCaller(false);
    await expect(
      caller.project.list({ orgId: ORG_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── getById ──────────────────────────────────────────────────────

  it("getById returns project with spec count for member", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireProjectAccess: project lookup
    resultQueue.push([mockProject]);
    // requireProjectAccess -> requireMembership
    resultQueue.push([mockOwnerMember]);
    // spec count query
    resultQueue.push([{ count: 3 }]);

    const caller = createCaller(true);
    const result = await caller.project.getById({ id: PROJECT_ID });

    expect(result).toEqual({ ...mockProject, specCount: 3 });
  });

  it("getById rejects non-member", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireProjectAccess: project lookup
    resultQueue.push([mockProject]);
    // requireProjectAccess -> requireMembership: not a member
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.project.getById({ id: PROJECT_ID }),
    ).rejects.toThrow("Not a member of this organization");
  });

  it("getById requires authentication", async () => {
    const caller = createCaller(false);
    await expect(
      caller.project.getById({ id: PROJECT_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── update ───────────────────────────────────────────────────────

  it("update succeeds for org member", async () => {
    const updatedProject = { ...mockProject, name: "Updated Name" };

    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireProjectAccess: project lookup
    resultQueue.push([mockProject]);
    // requireProjectAccess -> requireMembership
    resultQueue.push([mockOwnerMember]);
    // update returning
    returningResults.push([updatedProject]);

    const caller = createCaller(true);
    const result = await caller.project.update({
      id: PROJECT_ID,
      name: "Updated Name",
    });

    expect(result).toEqual(updatedProject);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:project",
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("update rejects non-member", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireProjectAccess: project lookup
    resultQueue.push([mockProject]);
    // requireProjectAccess -> requireMembership: not a member
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.project.update({ id: PROJECT_ID, name: "Updated" }),
    ).rejects.toThrow("Not a member of this organization");
  });

  it("update requires authentication", async () => {
    const caller = createCaller(false);
    await expect(
      caller.project.update({ id: PROJECT_ID, name: "Updated" }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── delete ───────────────────────────────────────────────────────

  it("delete succeeds for owner", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireProjectAccess: project lookup
    resultQueue.push([mockProject]);
    // requireProjectAccess -> requireMembership: owner
    resultQueue.push([mockOwnerMember]);
    // delete returning
    returningResults.push([mockProject]);

    const caller = createCaller(true);
    const result = await caller.project.delete({ id: PROJECT_ID });

    expect(result).toEqual({ success: true });
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:project",
      expect.objectContaining({ action: "deleted" }),
    );
  });

  it("delete succeeds for admin", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireProjectAccess: project lookup
    resultQueue.push([mockProject]);
    // requireProjectAccess -> requireMembership: admin
    resultQueue.push([mockAdminMember]);
    // delete returning
    returningResults.push([mockProject]);

    const caller = createCaller(true);
    const result = await caller.project.delete({ id: PROJECT_ID });

    expect(result).toEqual({ success: true });
  });

  it("delete rejects regular member", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireProjectAccess: project lookup
    resultQueue.push([mockProject]);
    // requireProjectAccess -> requireMembership: member
    resultQueue.push([mockRegularMember]);

    const caller = createCaller(true);
    await expect(
      caller.project.delete({ id: PROJECT_ID }),
    ).rejects.toThrow("Only owner/admin can delete project");
  });

  it("delete requires authentication", async () => {
    const caller = createCaller(false);
    await expect(
      caller.project.delete({ id: PROJECT_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── attachSpec ───────────────────────────────────────────────────

  it("attachSpec attaches a global spec", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireProjectAccess: project lookup
    resultQueue.push([mockProject]);
    // requireProjectAccess -> requireMembership
    resultQueue.push([mockOwnerMember]);
    // spec lookup
    resultQueue.push([mockGlobalSpec]);
    // checkSpecAccess: global => no extra DB call
    // insert returning
    returningResults.push([mockProjectSpec]);

    const caller = createCaller(true);
    const result = await caller.project.attachSpec({
      projectId: PROJECT_ID,
      specId: SPEC_ID,
    });

    expect(result).toEqual(mockProjectSpec);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:project",
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("attachSpec attaches an org spec when member of spec org", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireProjectAccess: project lookup
    resultQueue.push([mockProject]);
    // requireProjectAccess -> requireMembership (project org)
    resultQueue.push([mockOwnerMember]);
    // spec lookup
    resultQueue.push([mockOrgSpec]);
    // checkSpecAccess -> requireMembership (spec org = same org)
    resultQueue.push([mockOwnerMember]);
    // insert returning
    returningResults.push([mockProjectSpec]);

    const caller = createCaller(true);
    const result = await caller.project.attachSpec({
      projectId: PROJECT_ID,
      specId: SPEC_ID,
    });

    expect(result).toEqual(mockProjectSpec);
  });

  it("attachSpec rejects when not member of spec org", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireProjectAccess: project lookup
    resultQueue.push([mockProject]);
    // requireProjectAccess -> requireMembership (project org)
    resultQueue.push([mockOwnerMember]);
    // spec lookup
    resultQueue.push([mockOtherOrgSpec]);
    // checkSpecAccess -> requireMembership (other org): not a member
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.project.attachSpec({ projectId: PROJECT_ID, specId: SPEC_ID }),
    ).rejects.toThrow("Not a member of this organization");
  });

  it("attachSpec rejects other user's private spec", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireProjectAccess: project lookup
    resultQueue.push([mockProject]);
    // requireProjectAccess -> requireMembership
    resultQueue.push([mockOwnerMember]);
    // spec lookup
    resultQueue.push([mockOtherUserSpec]);
    // checkSpecAccess: user visibility, different user => FORBIDDEN

    const caller = createCaller(true);
    await expect(
      caller.project.attachSpec({ projectId: PROJECT_ID, specId: SPEC_ID }),
    ).rejects.toThrow("Access denied");
  });

  it("attachSpec rejects when not member of project org", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireProjectAccess: project lookup
    resultQueue.push([mockProject]);
    // requireProjectAccess -> requireMembership: not a member
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.project.attachSpec({ projectId: PROJECT_ID, specId: SPEC_ID }),
    ).rejects.toThrow("Not a member of this organization");
  });

  it("attachSpec requires authentication", async () => {
    const caller = createCaller(false);
    await expect(
      caller.project.attachSpec({ projectId: PROJECT_ID, specId: SPEC_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── detachSpec ───────────────────────────────────────────────────

  it("detachSpec removes spec attachment", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireProjectAccess: project lookup
    resultQueue.push([mockProject]);
    // requireProjectAccess -> requireMembership
    resultQueue.push([mockOwnerMember]);
    // delete returning
    returningResults.push([mockProjectSpec]);

    const caller = createCaller(true);
    const result = await caller.project.detachSpec({
      projectId: PROJECT_ID,
      specId: SPEC_ID,
    });

    expect(result).toEqual({ success: true });
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:project",
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("detachSpec rejects non-member", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireProjectAccess: project lookup
    resultQueue.push([mockProject]);
    // requireProjectAccess -> requireMembership: not a member
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.project.detachSpec({ projectId: PROJECT_ID, specId: SPEC_ID }),
    ).rejects.toThrow("Not a member of this organization");
  });

  it("detachSpec requires authentication", async () => {
    const caller = createCaller(false);
    await expect(
      caller.project.detachSpec({ projectId: PROJECT_ID, specId: SPEC_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── listSpecs ────────────────────────────────────────────────────

  it("listSpecs returns attached specs for member", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireProjectAccess: project lookup
    resultQueue.push([mockProject]);
    // requireProjectAccess -> requireMembership
    resultQueue.push([mockOwnerMember]);

    // listSpecs query chains where().orderBy() — orderBy is terminal
    mockDb.orderBy.mockResolvedValueOnce([mockProjectSpec]);

    const caller = createCaller(true);
    const result = await caller.project.listSpecs({
      projectId: PROJECT_ID,
    });

    expect(result).toEqual([mockProjectSpec]);
  });

  it("listSpecs rejects non-member", async () => {
    // protectedProcedure: lookup dbUser
    resultQueue.push([{ id: USER_ID }]);
    // requireProjectAccess: project lookup
    resultQueue.push([mockProject]);
    // requireProjectAccess -> requireMembership: not a member
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.project.listSpecs({ projectId: PROJECT_ID }),
    ).rejects.toThrow("Not a member of this organization");
  });

  it("listSpecs requires authentication", async () => {
    const caller = createCaller(false);
    await expect(
      caller.project.listSpecs({ projectId: PROJECT_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  // ─── Sync events are published on mutations ───────────────────────

  it("publishes sync event on create", async () => {
    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([mockOwnerMember]);
    returningResults.push([mockProject]);

    const caller = createCaller(true);
    await caller.project.create({ name: "Test", orgId: ORG_ID });

    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:project",
      expect.objectContaining({
        action: "created",
        data: mockProject,
        timestamp: expect.any(Number),
      }),
    );
  });

  it("publishes sync event on delete", async () => {
    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([mockProject]);
    resultQueue.push([mockOwnerMember]);
    returningResults.push([mockProject]);

    const caller = createCaller(true);
    await caller.project.delete({ id: PROJECT_ID });

    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:project",
      expect.objectContaining({
        action: "deleted",
        data: mockProject,
        timestamp: expect.any(Number),
      }),
    );
  });

  it("publishes sync event on update", async () => {
    const updatedProject = { ...mockProject, name: "Updated" };
    resultQueue.push([{ id: USER_ID }]);
    resultQueue.push([mockProject]);
    resultQueue.push([mockOwnerMember]);
    returningResults.push([updatedProject]);

    const caller = createCaller(true);
    await caller.project.update({ id: PROJECT_ID, name: "Updated" });

    expect(mockPubsub.publish).toHaveBeenCalledWith(
      "sync:project",
      expect.objectContaining({
        action: "updated",
        data: updatedProject,
        timestamp: expect.any(Number),
      }),
    );
  });
});
