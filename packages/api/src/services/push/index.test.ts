import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("../../lib/env.js", () => ({
  getEnv: vi.fn(),
}));

import { getPushAdapter, resetPushAdapter } from "./index.js";
import { getEnv } from "../../lib/env.js";

describe("getPushAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPushAdapter();
  });

  afterEach(() => {
    resetPushAdapter();
  });

  it("returns console adapter by default (no PUSH_PROVIDER)", () => {
    vi.mocked(getEnv).mockReturnValue({
      DATABASE_URL: "postgresql://mock",
      AUTH0_ISSUER_BASE_URL: "https://example.auth0.com",
      AUTH0_AUDIENCE: "https://api.example.com",
      PORT: "3001",
      CORS_ORIGIN: "http://localhost:3000",
      RATE_LIMIT_MAX: "100",
      NODE_ENV: "development",
      LOG_LEVEL: "info",
    });

    const adapter = getPushAdapter();
    expect(adapter).toBeDefined();
    expect(adapter.send).toBeTypeOf("function");
    expect(adapter.sendBatch).toBeTypeOf("function");
  });

  it("returns expo adapter when PUSH_PROVIDER=expo and EXPO_ACCESS_TOKEN set", () => {
    vi.mocked(getEnv).mockReturnValue({
      DATABASE_URL: "postgresql://mock",
      AUTH0_ISSUER_BASE_URL: "https://example.auth0.com",
      AUTH0_AUDIENCE: "https://api.example.com",
      PORT: "3001",
      CORS_ORIGIN: "http://localhost:3000",
      RATE_LIMIT_MAX: "100",
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      PUSH_PROVIDER: "expo",
      EXPO_ACCESS_TOKEN: "expo-token-123",
    });

    const adapter = getPushAdapter();
    expect(adapter).toBeDefined();
    expect(adapter.send).toBeTypeOf("function");
    expect(adapter.sendBatch).toBeTypeOf("function");
  });

  it("throws when PUSH_PROVIDER=expo but no EXPO_ACCESS_TOKEN", () => {
    vi.mocked(getEnv).mockReturnValue({
      DATABASE_URL: "postgresql://mock",
      AUTH0_ISSUER_BASE_URL: "https://example.auth0.com",
      AUTH0_AUDIENCE: "https://api.example.com",
      PORT: "3001",
      CORS_ORIGIN: "http://localhost:3000",
      RATE_LIMIT_MAX: "100",
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      PUSH_PROVIDER: "expo",
    });

    expect(() => getPushAdapter()).toThrow(
      "PUSH_PROVIDER=expo requires EXPO_ACCESS_TOKEN",
    );
  });
});
