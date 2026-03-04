import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogger = {
  info: vi.fn(),
};

vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => mockLogger),
}));

import { createConsolePushAdapter } from "./console.js";

describe("createConsolePushAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("send returns success and logs", async () => {
    const adapter = createConsolePushAdapter();
    const result = await adapter.send({
      token: "ExponentPushToken[xxx]",
      title: "Hello",
      body: "World",
    });

    expect(result).toEqual({ success: true });
    expect(mockLogger.info).toHaveBeenCalledWith(
      { token: "ExponentPushToken[xxx]", title: "Hello" },
      expect.stringContaining("console adapter"),
    );
  });

  it("sendBatch returns array of results", async () => {
    const adapter = createConsolePushAdapter();
    const results = await adapter.sendBatch([
      { token: "token-1", title: "A", body: "Body A" },
      { token: "token-2", title: "B", body: "Body B" },
    ]);

    expect(results).toEqual([{ success: true }, { success: true }]);
    expect(mockLogger.info).toHaveBeenCalledTimes(2);
  });
});
