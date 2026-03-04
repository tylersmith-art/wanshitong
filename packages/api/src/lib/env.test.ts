import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateEnv } from "./env.js";

describe("validateEnv", () => {
  const validEnv = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
    AUTH0_ISSUER_BASE_URL: "https://example.auth0.com",
    AUTH0_AUDIENCE: "https://api.example.com",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed env for valid input", () => {
    vi.stubEnv("DATABASE_URL", validEnv.DATABASE_URL);
    vi.stubEnv("AUTH0_ISSUER_BASE_URL", validEnv.AUTH0_ISSUER_BASE_URL);
    vi.stubEnv("AUTH0_AUDIENCE", validEnv.AUTH0_AUDIENCE);

    const env = validateEnv();
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(env.PORT).toBe("3001");
    expect(env.CORS_ORIGIN).toBe("http://localhost:3000");
  });

  it("boots without Anthropic vars", () => {
    vi.stubEnv("DATABASE_URL", validEnv.DATABASE_URL);
    vi.stubEnv("AUTH0_ISSUER_BASE_URL", validEnv.AUTH0_ISSUER_BASE_URL);
    vi.stubEnv("AUTH0_AUDIENCE", validEnv.AUTH0_AUDIENCE);

    const env = validateEnv();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.EMBEDDING_PROVIDER).toBeUndefined();
    expect(env.SUMMARIZATION_PROVIDER).toBeUndefined();
  });

  it("includes ANTHROPIC_API_KEY when set", () => {
    vi.stubEnv("DATABASE_URL", validEnv.DATABASE_URL);
    vi.stubEnv("AUTH0_ISSUER_BASE_URL", validEnv.AUTH0_ISSUER_BASE_URL);
    vi.stubEnv("AUTH0_AUDIENCE", validEnv.AUTH0_AUDIENCE);
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key");

    const env = validateEnv();
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test-key");
  });

  it("accepts optional EMBEDDING_PROVIDER and SUMMARIZATION_PROVIDER", () => {
    vi.stubEnv("DATABASE_URL", validEnv.DATABASE_URL);
    vi.stubEnv("AUTH0_ISSUER_BASE_URL", validEnv.AUTH0_ISSUER_BASE_URL);
    vi.stubEnv("AUTH0_AUDIENCE", validEnv.AUTH0_AUDIENCE);
    vi.stubEnv("EMBEDDING_PROVIDER", "anthropic");
    vi.stubEnv("SUMMARIZATION_PROVIDER", "anthropic");

    const env = validateEnv();
    expect(env.EMBEDDING_PROVIDER).toBe("anthropic");
    expect(env.SUMMARIZATION_PROVIDER).toBe("anthropic");
  });

  it("exits on missing required vars", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AUTH0_ISSUER_BASE_URL", "");
    vi.stubEnv("AUTH0_AUDIENCE", "");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => validateEnv()).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
