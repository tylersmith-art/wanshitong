import { describe, it, expect } from "vitest";
import {
  CreateNotificationSchema,
  NotificationSchema,
  PushTokenSchema,
  RegisterPushTokenSchema,
  NotificationListInputSchema,
  UpdatePushOptOutSchema,
} from "./notification.js";

describe("CreateNotificationSchema", () => {
  it("accepts valid input", () => {
    const result = CreateNotificationSchema.safeParse({
      title: "New message",
      body: "You have a new message",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = CreateNotificationSchema.safeParse({
      title: "",
      body: "You have a new message",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty body", () => {
    const result = CreateNotificationSchema.safeParse({
      title: "New message",
      body: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts null actionUrl", () => {
    const result = CreateNotificationSchema.safeParse({
      title: "New message",
      body: "You have a new message",
      actionUrl: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts undefined actionUrl", () => {
    const result = CreateNotificationSchema.safeParse({
      title: "New message",
      body: "You have a new message",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.actionUrl).toBeUndefined();
    }
  });

  it("rejects title over 255 chars", () => {
    const result = CreateNotificationSchema.safeParse({
      title: "a".repeat(256),
      body: "You have a new message",
    });
    expect(result.success).toBe(false);
  });
});

describe("NotificationSchema", () => {
  it("accepts valid notification with all fields", () => {
    const result = NotificationSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      userId: "660e8400-e29b-41d4-a716-446655440000",
      title: "New message",
      body: "You have a new message",
      read: false,
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid uuid for id", () => {
    const result = NotificationSchema.safeParse({
      id: "not-a-uuid",
      userId: "660e8400-e29b-41d4-a716-446655440000",
      title: "New message",
      body: "You have a new message",
      read: false,
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });
});

describe("PushTokenSchema", () => {
  it("accepts valid token", () => {
    const result = PushTokenSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      userId: "660e8400-e29b-41d4-a716-446655440000",
      token: "ExponentPushToken[abc123]",
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty token", () => {
    const result = PushTokenSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      userId: "660e8400-e29b-41d4-a716-446655440000",
      token: "",
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });
});

describe("RegisterPushTokenSchema", () => {
  it("accepts valid token", () => {
    const result = RegisterPushTokenSchema.safeParse({
      token: "ExponentPushToken[abc123]",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty token", () => {
    const result = RegisterPushTokenSchema.safeParse({ token: "" });
    expect(result.success).toBe(false);
  });
});

describe("NotificationListInputSchema", () => {
  it("defaults limit to 20 when not provided", () => {
    const result = NotificationListInputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cursor).toBeUndefined();
      expect(result.data.limit).toBe(20);
    }
  });

  it("accepts valid cursor", () => {
    const result = NotificationListInputSchema.safeParse({
      cursor: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects limit over 100", () => {
    const result = NotificationListInputSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });

  it("rejects limit under 1", () => {
    const result = NotificationListInputSchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });
});

describe("UpdatePushOptOutSchema", () => {
  it("accepts true", () => {
    const result = UpdatePushOptOutSchema.safeParse({ optOut: true });
    expect(result.success).toBe(true);
  });

  it("accepts false", () => {
    const result = UpdatePushOptOutSchema.safeParse({ optOut: false });
    expect(result.success).toBe(true);
  });
});
