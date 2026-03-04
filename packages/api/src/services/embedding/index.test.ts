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

import { getEmbeddingAdapter, resetEmbeddingAdapter } from "./index.js";
import { getEnv } from "../../lib/env.js";

describe("getEmbeddingAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEmbeddingAdapter();
  });

  afterEach(() => {
    resetEmbeddingAdapter();
  });

  it("returns console adapter by default (no EMBEDDING_PROVIDER)", () => {
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

    const adapter = getEmbeddingAdapter();
    expect(adapter).toBeDefined();
    expect(adapter.embed).toBeTypeOf("function");
  });

  it("returns anthropic adapter when EMBEDDING_PROVIDER=anthropic and ANTHROPIC_API_KEY set", () => {
    vi.mocked(getEnv).mockReturnValue({
      DATABASE_URL: "postgresql://mock",
      AUTH0_ISSUER_BASE_URL: "https://example.auth0.com",
      AUTH0_AUDIENCE: "https://api.example.com",
      PORT: "3001",
      CORS_ORIGIN: "http://localhost:3000",
      RATE_LIMIT_MAX: "100",
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      EMBEDDING_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-ant-test-123",
    });

    const adapter = getEmbeddingAdapter();
    expect(adapter).toBeDefined();
    expect(adapter.embed).toBeTypeOf("function");
  });

  it("throws when EMBEDDING_PROVIDER=anthropic but no ANTHROPIC_API_KEY", () => {
    vi.mocked(getEnv).mockReturnValue({
      DATABASE_URL: "postgresql://mock",
      AUTH0_ISSUER_BASE_URL: "https://example.auth0.com",
      AUTH0_AUDIENCE: "https://api.example.com",
      PORT: "3001",
      CORS_ORIGIN: "http://localhost:3000",
      RATE_LIMIT_MAX: "100",
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      EMBEDDING_PROVIDER: "anthropic",
    });

    expect(() => getEmbeddingAdapter()).toThrow(
      "EMBEDDING_PROVIDER=anthropic requires VOYAGE_API_KEY (or ANTHROPIC_API_KEY) to be set",
    );
  });
});
