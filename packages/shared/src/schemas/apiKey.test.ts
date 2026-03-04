import { describe, it, expect } from "vitest";
import { CreateApiKeySchema, ApiKeySchema, ApiKeyCreatedSchema } from "./apiKey.js";

describe("CreateApiKeySchema", () => {
  it("accepts valid name", () => {
    const result = CreateApiKeySchema.safeParse({ name: "My API Key" });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = CreateApiKeySchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects name over 100 chars", () => {
    const result = CreateApiKeySchema.safeParse({ name: "a".repeat(101) });
    expect(result.success).toBe(false);
  });
});

describe("ApiKeySchema", () => {
  it("accepts valid API key", () => {
    const result = ApiKeySchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      userId: "660e8400-e29b-41d4-a716-446655440000",
      name: "My API Key",
      keyPrefix: "wst_abc123",
      lastUsedAt: null,
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("does not accept a plaintextKey field", () => {
    const shape = ApiKeySchema.shape;
    expect("plaintextKey" in shape).toBe(false);
  });
});

describe("ApiKeyCreatedSchema", () => {
  it("includes plaintextKey field", () => {
    const result = ApiKeyCreatedSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      userId: "660e8400-e29b-41d4-a716-446655440000",
      name: "My API Key",
      keyPrefix: "wst_abc123",
      lastUsedAt: null,
      createdAt: new Date(),
      plaintextKey: "wst_abc123_secretvalue",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.plaintextKey).toBe("wst_abc123_secretvalue");
    }
  });
});
