import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("../../lib/env.js", () => ({
  getEnv: vi.fn(() => ({
    DATABASE_URL: "postgresql://mock",
    AUTH0_ISSUER_BASE_URL: "https://example.auth0.com",
    AUTH0_AUDIENCE: "https://api.example.com",
    PORT: "3001",
    CORS_ORIGIN: "http://localhost:3000",
    RATE_LIMIT_MAX: "100",
    NODE_ENV: "development",
    LOG_LEVEL: "info",
  })),
}));

import { sendNotification, broadcastNotification } from "./index.js";
import { setPushAdapter, resetPushAdapter } from "../push/index.js";
import type { PushAdapter } from "../push/types.js";

const USER_ID_1 = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID_2 = "660e8400-e29b-41d4-a716-446655440000";
const TOKEN_ID_1 = "770e8400-e29b-41d4-a716-446655440000";
const NOTIF_ID_1 = "880e8400-e29b-41d4-a716-446655440000";
const NOTIF_ID_2 = "990e8400-e29b-41d4-a716-446655440000";

const payload = { title: "Test", body: "Test notification" };

function createMockNotification(userId: string, id: string) {
  return {
    id,
    userId,
    title: payload.title,
    body: payload.body,
    actionUrl: null,
    read: false,
    createdAt: new Date(),
  };
}

function createMockDb() {
  const mock = {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn(),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };
  return mock;
}

function createMockPubsub() {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    close: vi.fn(),
  };
}

let mockPush: PushAdapter;

beforeEach(() => {
  vi.clearAllMocks();
  mockPush = {
    send: vi.fn().mockResolvedValue({ success: true }),
    sendBatch: vi.fn().mockResolvedValue([{ success: true }]),
  };
  setPushAdapter(mockPush);
});

afterEach(() => {
  resetPushAdapter();
});

describe("sendNotification", () => {
  it("inserts 1 notification, publishes 1 sync event, looks up tokens, sends push", async () => {
    const db = createMockDb();
    const pubsub = createMockPubsub();

    const mockNotif = createMockNotification(USER_ID_1, NOTIF_ID_1);
    db.returning
      .mockResolvedValueOnce([mockNotif])           // insert().returning()
      .mockResolvedValueOnce(undefined);             // possible delete().returning()

    // select().from(users).where() — opt-out check
    // select().from(pushTokens).where() — token lookup
    let selectCallCount = 0;
    db.where.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        // users opt-out query
        return Promise.resolve([{ id: USER_ID_1, pushOptOut: false }]);
      }
      if (selectCallCount === 2) {
        // push tokens query
        return Promise.resolve([{ id: TOKEN_ID_1, userId: USER_ID_1, token: "expo-token-abc", createdAt: new Date() }]);
      }
      return Promise.resolve([]);
    });

    const result = await sendNotification(db as any, pubsub as any, { userId: USER_ID_1 }, payload);

    expect(result.notificationIds).toEqual([NOTIF_ID_1]);
    expect(result.pushResults.sent).toBe(1);
    expect(result.pushResults.skipped).toBe(0);
    expect(result.pushResults.failed).toBe(0);

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(pubsub.publish).toHaveBeenCalledTimes(1);
    expect(pubsub.publish).toHaveBeenCalledWith(
      "sync:notification",
      expect.objectContaining({ action: "created", data: mockNotif }),
    );
    expect(mockPush.sendBatch).toHaveBeenCalledWith([
      expect.objectContaining({ token: "expo-token-abc", title: "Test", body: "Test notification" }),
    ]);
  });

  it("inserts N notifications and publishes N sync events for multiple users", async () => {
    const db = createMockDb();
    const pubsub = createMockPubsub();

    const mockNotif1 = createMockNotification(USER_ID_1, NOTIF_ID_1);
    const mockNotif2 = createMockNotification(USER_ID_2, NOTIF_ID_2);
    db.returning.mockResolvedValueOnce([mockNotif1, mockNotif2]);

    let selectCallCount = 0;
    db.where.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        return Promise.resolve([
          { id: USER_ID_1, pushOptOut: false },
          { id: USER_ID_2, pushOptOut: false },
        ]);
      }
      if (selectCallCount === 2) {
        return Promise.resolve([
          { id: TOKEN_ID_1, userId: USER_ID_1, token: "token-1", createdAt: new Date() },
          { id: "aae8400-e29b-41d4-a716-446655440000", userId: USER_ID_2, token: "token-2", createdAt: new Date() },
        ]);
      }
      return Promise.resolve([]);
    });

    vi.mocked(mockPush.sendBatch).mockResolvedValueOnce([
      { success: true },
      { success: true },
    ]);

    const result = await sendNotification(
      db as any,
      pubsub as any,
      { userIds: [USER_ID_1, USER_ID_2] },
      payload,
    );

    expect(result.notificationIds).toHaveLength(2);
    expect(pubsub.publish).toHaveBeenCalledTimes(2);
    expect(result.pushResults.sent).toBe(2);
    expect(mockPush.sendBatch).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ token: "token-1" }),
        expect.objectContaining({ token: "token-2" }),
      ]),
    );
  });

  it("skips push for user with pushOptOut=true", async () => {
    const db = createMockDb();
    const pubsub = createMockPubsub();

    const mockNotif = createMockNotification(USER_ID_1, NOTIF_ID_1);
    db.returning.mockResolvedValueOnce([mockNotif]);

    db.where.mockImplementation(() => {
      return Promise.resolve([{ id: USER_ID_1, pushOptOut: true }]);
    });

    const result = await sendNotification(db as any, pubsub as any, { userId: USER_ID_1 }, payload);

    expect(result.notificationIds).toEqual([NOTIF_ID_1]);
    expect(pubsub.publish).toHaveBeenCalledTimes(1);
    expect(result.pushResults.skipped).toBe(1);
    expect(result.pushResults.sent).toBe(0);
    expect(mockPush.sendBatch).not.toHaveBeenCalled();
  });

  it("skips push when user has no push tokens", async () => {
    const db = createMockDb();
    const pubsub = createMockPubsub();

    const mockNotif = createMockNotification(USER_ID_1, NOTIF_ID_1);
    db.returning.mockResolvedValueOnce([mockNotif]);

    let selectCallCount = 0;
    db.where.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        return Promise.resolve([{ id: USER_ID_1, pushOptOut: false }]);
      }
      // No tokens
      return Promise.resolve([]);
    });

    const result = await sendNotification(db as any, pubsub as any, { userId: USER_ID_1 }, payload);

    expect(result.notificationIds).toEqual([NOTIF_ID_1]);
    expect(pubsub.publish).toHaveBeenCalledTimes(1);
    expect(result.pushResults.sent).toBe(0);
    expect(result.pushResults.skipped).toBe(0);
    expect(mockPush.sendBatch).not.toHaveBeenCalled();
  });

  it("deletes stale token on DeviceNotRegistered", async () => {
    const db = createMockDb();
    const pubsub = createMockPubsub();

    const mockNotif = createMockNotification(USER_ID_1, NOTIF_ID_1);
    db.returning.mockResolvedValueOnce([mockNotif]);

    let selectCallCount = 0;
    db.where.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        return Promise.resolve([{ id: USER_ID_1, pushOptOut: false }]);
      }
      if (selectCallCount === 2) {
        return Promise.resolve([{ id: TOKEN_ID_1, userId: USER_ID_1, token: "stale-token", createdAt: new Date() }]);
      }
      // delete where clause
      return Promise.resolve(undefined);
    });

    vi.mocked(mockPush.sendBatch).mockResolvedValueOnce([
      { success: false, error: "DeviceNotRegistered", deviceNotRegistered: true },
    ]);

    const result = await sendNotification(db as any, pubsub as any, { userId: USER_ID_1 }, payload);

    expect(result.pushResults.failed).toBe(1);
    expect(result.pushResults.sent).toBe(0);
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it("returns successfully even when push adapter throws", async () => {
    const db = createMockDb();
    const pubsub = createMockPubsub();

    const mockNotif = createMockNotification(USER_ID_1, NOTIF_ID_1);
    db.returning.mockResolvedValueOnce([mockNotif]);

    let selectCallCount = 0;
    db.where.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        return Promise.resolve([{ id: USER_ID_1, pushOptOut: false }]);
      }
      if (selectCallCount === 2) {
        return Promise.resolve([{ id: TOKEN_ID_1, userId: USER_ID_1, token: "some-token", createdAt: new Date() }]);
      }
      return Promise.resolve([]);
    });

    vi.mocked(mockPush.sendBatch).mockRejectedValueOnce(new Error("Network error"));

    const result = await sendNotification(db as any, pubsub as any, { userId: USER_ID_1 }, payload);

    expect(result.notificationIds).toEqual([NOTIF_ID_1]);
    expect(pubsub.publish).toHaveBeenCalledTimes(1);
    expect(result.pushResults.sent).toBe(0);
  });
});

describe("broadcastNotification", () => {
  it("queries all users and delegates to sendNotification logic", async () => {
    const db = createMockDb();
    const pubsub = createMockPubsub();

    // First select: broadcastNotification fetches all users
    // Then sendNotification calls insert, then select for opt-out, select for tokens
    let fromCallCount = 0;
    db.from.mockImplementation(() => {
      fromCallCount++;
      if (fromCallCount === 1) {
        // broadcastNotification: select all user ids
        return { where: db.where, ...Promise.resolve([{ id: USER_ID_1 }, { id: USER_ID_2 }]) };
      }
      return db;
    });

    // Handle the initial "select all users" call that doesn't chain .where()
    // broadcastNotification calls db.select({id}).from(users) — no .where()
    // We need the from() to resolve directly for that first call
    let selectCallCount = 0;
    db.select.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        // broadcastNotification: select all users — returns a thenable that also has .from()
        return {
          from: vi.fn().mockResolvedValue([{ id: USER_ID_1 }, { id: USER_ID_2 }]),
        };
      }
      // Subsequent calls go through the normal chain
      return db;
    });

    const mockNotif1 = createMockNotification(USER_ID_1, NOTIF_ID_1);
    const mockNotif2 = createMockNotification(USER_ID_2, NOTIF_ID_2);
    db.returning.mockResolvedValueOnce([mockNotif1, mockNotif2]);

    let whereCallCount = 0;
    db.where.mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount === 1) {
        return Promise.resolve([
          { id: USER_ID_1, pushOptOut: false },
          { id: USER_ID_2, pushOptOut: false },
        ]);
      }
      if (whereCallCount === 2) {
        return Promise.resolve([
          { id: TOKEN_ID_1, userId: USER_ID_1, token: "token-a", createdAt: new Date() },
        ]);
      }
      return Promise.resolve([]);
    });

    vi.mocked(mockPush.sendBatch).mockResolvedValueOnce([{ success: true }]);

    const result = await broadcastNotification(db as any, pubsub as any, payload);

    expect(result.notificationIds).toHaveLength(2);
    expect(pubsub.publish).toHaveBeenCalledTimes(2);
    expect(result.pushResults.sent).toBe(1);
  });
});
