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

describe("notificationRouter", () => {
  const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const OTHER_USER_ID = "660e8400-e29b-41d4-a716-446655440001";
  const NOTIF_ID = "770e8400-e29b-41d4-a716-446655440002";

  const mockNotification = {
    id: NOTIF_ID,
    userId: USER_ID,
    title: "Test",
    body: "Test body",
    actionUrl: null,
    read: false,
    createdAt: new Date(),
  };

  const mockPubsub = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    close: vi.fn(),
  };

  // Track sequential db call results via a queue
  let resultQueue: unknown[];

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
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };

  const createCaller = (authenticated = false) =>
    appRouter.createCaller({
      user: authenticated
        ? { sub: "user123", email: "test@example.com" }
        : null,
      db: mockDb as any,
      pubsub: mockPubsub as any,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    resultQueue = [];

    // Reset all chainable methods
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
    mockDb.onConflictDoUpdate.mockResolvedValue(undefined);
    mockDb.returning.mockResolvedValue([]);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.delete.mockReturnThis();
  });

  // ─── list ──────────────────────────────────────────────────────────

  it("list returns paginated notifications", async () => {
    // lookupUserId → select().from(users).where().limit(1) → [{id}]
    resultQueue.push([{ id: USER_ID }]);
    // list query → select().from(notifications).where().orderBy().limit(21) → then awaited
    // The list query chains orderBy().limit() — limit is the terminal
    resultQueue.push([mockNotification]);

    const caller = createCaller(true);
    const result = await caller.notification.list({ limit: 20 });

    expect(result.notifications).toEqual([mockNotification]);
    expect(result.nextCursor).toBeNull();
  });

  it("list requires auth", async () => {
    const caller = createCaller(false);
    await expect(caller.notification.list({ limit: 20 })).rejects.toThrow(
      "UNAUTHORIZED",
    );
  });

  // ─── unreadCount ───────────────────────────────────────────────────

  it("unreadCount returns count", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);

    // unreadCount query doesn't use limit — it awaits the where() result directly
    // Need to make where() return a promise for this call
    let whereCallCount = 0;
    mockDb.where.mockImplementation(() => {
      whereCallCount++;
      // First where call: lookupUserId (chains to .limit())
      if (whereCallCount <= 1) {
        return mockDb;
      }
      // Second where call: the unread query — this is the terminal
      return Promise.resolve([
        { ...mockNotification, read: false },
        { ...mockNotification, id: "other-notif", read: false },
      ]);
    });

    const caller = createCaller(true);
    const result = await caller.notification.unreadCount();

    expect(result).toEqual({ count: 2 });
  });

  // ─── markRead ──────────────────────────────────────────────────────

  it("markRead updates and publishes sync", async () => {
    const updatedNotif = { ...mockNotification, read: true };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // Fetch notification by id → select().from().where().limit(1)
    resultQueue.push([mockNotification]);
    // update().set().where().returning()
    mockDb.returning.mockResolvedValue([updatedNotif]);

    const caller = createCaller(true);
    const result = await caller.notification.markRead({ id: NOTIF_ID });

    expect(result).toEqual(updatedNotif);
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      expect.stringContaining("notification"),
      expect.objectContaining({ action: "updated" }),
    );
  });

  it("markRead rejects other user's notification", async () => {
    const otherNotif = { ...mockNotification, userId: OTHER_USER_ID };

    // lookupUserId returns current user
    resultQueue.push([{ id: USER_ID }]);
    // Fetch notification owned by another user
    resultQueue.push([otherNotif]);

    const caller = createCaller(true);
    await expect(
      caller.notification.markRead({ id: NOTIF_ID }),
    ).rejects.toThrow("Not your notification");
  });

  it("markRead throws NOT_FOUND for missing notification", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // Notification not found
    resultQueue.push([]);

    const caller = createCaller(true);
    await expect(
      caller.notification.markRead({ id: NOTIF_ID }),
    ).rejects.toThrow("Notification not found");
  });

  // ─── markUnread ────────────────────────────────────────────────────

  it("markUnread updates and publishes sync", async () => {
    const readNotif = { ...mockNotification, read: true };
    const updatedNotif = { ...mockNotification, read: false };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // Fetch notification
    resultQueue.push([readNotif]);
    // update().set().where().returning()
    mockDb.returning.mockResolvedValue([updatedNotif]);

    const caller = createCaller(true);
    const result = await caller.notification.markUnread({ id: NOTIF_ID });

    expect(result).toEqual(updatedNotif);
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      expect.stringContaining("notification"),
      expect.objectContaining({ action: "updated" }),
    );
  });

  // ─── markAllRead ───────────────────────────────────────────────────

  it("markAllRead bulk updates and publishes", async () => {
    const updatedNotifs = [
      { ...mockNotification, id: "n1", read: true },
      { ...mockNotification, id: "n2", read: true },
    ];

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // update().set().where().returning()
    mockDb.returning.mockResolvedValue(updatedNotifs);

    const caller = createCaller(true);
    const result = await caller.notification.markAllRead();

    expect(result).toEqual({ count: 2 });
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      expect.stringContaining("notification"),
      expect.objectContaining({ action: "updated" }),
    );
  });

  // ─── registerPushToken ─────────────────────────────────────────────

  it("registerPushToken upserts token", async () => {
    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);

    const caller = createCaller(true);
    const result = await caller.notification.registerPushToken({
      token: "ExponentPushToken[xxx]",
    });

    expect(result).toEqual({ success: true });
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.onConflictDoUpdate).toHaveBeenCalled();
  });

  // ─── updatePushOptOut ──────────────────────────────────────────────

  it("updatePushOptOut updates user and publishes sync", async () => {
    const updatedUser = {
      id: USER_ID,
      email: "test@example.com",
      pushOptOut: true,
    };

    // lookupUserId
    resultQueue.push([{ id: USER_ID }]);
    // update().set().where().returning()
    mockDb.returning.mockResolvedValue([updatedUser]);

    const caller = createCaller(true);
    const result = await caller.notification.updatePushOptOut({ optOut: true });

    expect(result).toEqual({ pushOptOut: true });
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockPubsub.publish).toHaveBeenCalledWith(
      expect.stringContaining("user"),
      expect.objectContaining({ action: "updated" }),
    );
  });

  // ─── Auth required on all endpoints ────────────────────────────────

  it("unreadCount requires auth", async () => {
    const caller = createCaller(false);
    await expect(caller.notification.unreadCount()).rejects.toThrow(
      "UNAUTHORIZED",
    );
  });

  it("markRead requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.notification.markRead({ id: NOTIF_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("markUnread requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.notification.markUnread({ id: NOTIF_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("markAllRead requires auth", async () => {
    const caller = createCaller(false);
    await expect(caller.notification.markAllRead()).rejects.toThrow(
      "UNAUTHORIZED",
    );
  });

  it("registerPushToken rejects when user has no DB record", async () => {
    // User has a sub but no matching DB row → dbUser is null
    const caller = appRouter.createCaller({
      user: { sub: "unknown-sub" },
      db: mockDb as any,
      pubsub: mockPubsub as any,
    });
    await expect(
      caller.notification.registerPushToken({ token: "tok" }),
    ).rejects.toThrow("User not found");
  });

  it("registerPushToken requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.notification.registerPushToken({ token: "tok" }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("updatePushOptOut requires auth", async () => {
    const caller = createCaller(false);
    await expect(
      caller.notification.updatePushOptOut({ optOut: true }),
    ).rejects.toThrow("UNAUTHORIZED");
  });
});
