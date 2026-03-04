import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/env.js", () => ({
  getEnv: vi.fn(() => ({
    AUTH0_ISSUER_BASE_URL: "https://test.auth0.com",
    AUTH0_AUDIENCE: "https://api.test.com",
  })),
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock-jwks"),
  jwtVerify: vi.fn(),
}));

import { verifyToken } from "./auth.js";
import { jwtVerify } from "jose";

const mockJwtVerify = vi.mocked(jwtVerify);

describe("verifyToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns payload for valid token", async () => {
    const mockPayload = { sub: "user123", email: "test@example.com" };
    mockJwtVerify.mockResolvedValueOnce({
      payload: mockPayload,
      protectedHeader: { alg: "RS256" },
    } as any);

    const result = await verifyToken("valid-token");
    expect(result).toEqual(mockPayload);
  });

  it("returns null for invalid token", async () => {
    mockJwtVerify.mockRejectedValueOnce(new Error("invalid"));

    const result = await verifyToken("bad-token");
    expect(result).toBeNull();
  });
});
