import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
  })),
}));

import { createExpoPushAdapter } from "./expo.js";

describe("createExpoPushAdapter", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends correct payload to Expo API", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ status: "ok", id: "ticket-1" }] }),
    });

    const adapter = createExpoPushAdapter({ accessToken: "test-token" });
    await adapter.send({
      token: "ExponentPushToken[xxx]",
      title: "Hello",
      body: "World",
      data: { actionUrl: "/home" },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://exp.host/--/api/v2/push/send",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          {
            to: "ExponentPushToken[xxx]",
            title: "Hello",
            body: "World",
            data: { actionUrl: "/home" },
          },
        ]),
      }),
    );
  });

  it("handles successful response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ status: "ok", id: "ticket-1" }] }),
    });

    const adapter = createExpoPushAdapter({ accessToken: "test-token" });
    const result = await adapter.send({
      token: "ExponentPushToken[xxx]",
      title: "Hello",
      body: "World",
    });

    expect(result).toEqual({ success: true });
  });

  it("handles DeviceNotRegistered in ticket", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            status: "error",
            message: "Device not registered",
            details: { error: "DeviceNotRegistered" },
          },
        ],
      }),
    });

    const adapter = createExpoPushAdapter({ accessToken: "test-token" });
    const result = await adapter.send({
      token: "ExponentPushToken[stale]",
      title: "Hello",
      body: "World",
    });

    expect(result).toEqual({
      success: false,
      error: "Device not registered",
      deviceNotRegistered: true,
    });
  });

  it("handles fetch error gracefully", async () => {
    mockFetch.mockRejectedValue(new Error("Network failure"));

    const adapter = createExpoPushAdapter({ accessToken: "test-token" });
    const result = await adapter.send({
      token: "ExponentPushToken[xxx]",
      title: "Hello",
      body: "World",
    });

    expect(result).toEqual({
      success: false,
      error: "Network failure",
    });
  });

  it("handles non-ok HTTP response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Rate limited",
    });

    const adapter = createExpoPushAdapter({ accessToken: "test-token" });
    const result = await adapter.send({
      token: "ExponentPushToken[xxx]",
      title: "Hello",
      body: "World",
    });

    expect(result).toEqual({
      success: false,
      error: "Expo Push error: 429",
    });
  });

  it("batches >100 tokens into multiple requests", async () => {
    const makeResponse = (count: number) => ({
      ok: true,
      json: async () => ({
        data: Array.from({ length: count }, (_, i) => ({
          status: "ok" as const,
          id: `ticket-${i}`,
        })),
      }),
    });

    mockFetch
      .mockResolvedValueOnce(makeResponse(100))
      .mockResolvedValueOnce(makeResponse(20));

    const adapter = createExpoPushAdapter({ accessToken: "test-token" });
    const params = Array.from({ length: 120 }, (_, i) => ({
      token: `token-${i}`,
      title: "Hello",
      body: "World",
    }));

    const results = await adapter.sendBatch(params);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(120);
    expect(results.every((r) => r.success)).toBe(true);

    // Verify first call has 100 messages
    const firstCallBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(firstCallBody).toHaveLength(100);

    // Verify second call has 20 messages
    const secondCallBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(secondCallBody).toHaveLength(20);
  });
});
