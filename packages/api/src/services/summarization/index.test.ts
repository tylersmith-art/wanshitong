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

import {
  getSummarizationAdapter,
  resetSummarizationAdapter,
} from "./index.js";
import { getEnv } from "../../lib/env.js";

describe("getSummarizationAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSummarizationAdapter();
  });

  afterEach(() => {
    resetSummarizationAdapter();
  });

  it("returns console adapter by default (no SUMMARIZATION_PROVIDER)", () => {
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

    const adapter = getSummarizationAdapter();
    expect(adapter).toBeDefined();
    expect(adapter.summarize).toBeTypeOf("function");
  });

  it("returns anthropic adapter when SUMMARIZATION_PROVIDER=anthropic and ANTHROPIC_API_KEY set", () => {
    vi.mocked(getEnv).mockReturnValue({
      DATABASE_URL: "postgresql://mock",
      AUTH0_ISSUER_BASE_URL: "https://example.auth0.com",
      AUTH0_AUDIENCE: "https://api.example.com",
      PORT: "3001",
      CORS_ORIGIN: "http://localhost:3000",
      RATE_LIMIT_MAX: "100",
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      SUMMARIZATION_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-ant-test-key",
    });

    const adapter = getSummarizationAdapter();
    expect(adapter).toBeDefined();
    expect(adapter.summarize).toBeTypeOf("function");
  });

  it("throws when SUMMARIZATION_PROVIDER=anthropic but no ANTHROPIC_API_KEY", () => {
    vi.mocked(getEnv).mockReturnValue({
      DATABASE_URL: "postgresql://mock",
      AUTH0_ISSUER_BASE_URL: "https://example.auth0.com",
      AUTH0_AUDIENCE: "https://api.example.com",
      PORT: "3001",
      CORS_ORIGIN: "http://localhost:3000",
      RATE_LIMIT_MAX: "100",
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      SUMMARIZATION_PROVIDER: "anthropic",
    });

    expect(() => getSummarizationAdapter()).toThrow(
      "SUMMARIZATION_PROVIDER=anthropic requires ANTHROPIC_API_KEY",
    );
  });

  it("caches instance on subsequent calls", () => {
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

    const first = getSummarizationAdapter();
    const second = getSummarizationAdapter();
    expect(first).toBe(second);
  });
});
