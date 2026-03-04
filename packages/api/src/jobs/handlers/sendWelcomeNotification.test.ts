import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
};

vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => mockLogger),
}));

vi.mock("../../db/index.js", () => ({
  getConnectionString: vi.fn(() => "postgresql://mock"),
  getDb: vi.fn(() => "mock-db"),
}));

vi.mock("../../pubsub.js", () => ({
  PgPubSub: vi.fn().mockImplementation(() => ({
    publish: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../services/notifications/index.js", () => ({
  sendNotification: vi.fn().mockResolvedValue({
    notificationIds: ["n1"],
    pushResults: { sent: 1, skipped: 0, failed: 0 },
  }),
}));

import {
  registerWelcomeNotificationHandler,
  WELCOME_NOTIFICATION,
} from "./sendWelcomeNotification.js";
import { sendNotification } from "../../services/notifications/index.js";

describe("sendWelcomeNotification handler", () => {
  let workCallback: (jobs: Array<{ id: string; data: unknown }>) => Promise<void>;

  const mockBoss = {
    work: vi.fn(async (_name: string, cb: any) => {
      workCallback = cb;
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers handler for WELCOME_NOTIFICATION job", async () => {
    await registerWelcomeNotificationHandler(mockBoss as any);
    expect(mockBoss.work).toHaveBeenCalledWith(
      WELCOME_NOTIFICATION,
      expect.any(Function),
    );
  });

  it("calls sendNotification with correct userId and welcome message", async () => {
    await registerWelcomeNotificationHandler(mockBoss as any);

    await workCallback([
      { id: "job-1", data: { userId: "user-abc" } },
    ]);

    expect(sendNotification).toHaveBeenCalledWith(
      "mock-db",
      expect.any(Object),
      { userId: "user-abc" },
      {
        title: "Thanks for registering!",
        body: "Welcome! Explore the app to get started.",
      },
    );
  });

  it("logs success after sending", async () => {
    await registerWelcomeNotificationHandler(mockBoss as any);

    await workCallback([
      { id: "job-1", data: { userId: "user-abc" } },
    ]);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        userId: "user-abc",
        notificationIds: ["n1"],
      }),
      "Welcome notification sent",
    );
  });
});
