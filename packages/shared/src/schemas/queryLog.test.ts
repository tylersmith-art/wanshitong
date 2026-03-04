import { describe, it, expect } from "vitest";
import { QueryLogSchema, QueryLogListInputSchema } from "./queryLog.js";

describe("QueryLogSchema", () => {
  it("accepts valid log entry", () => {
    const result = QueryLogSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      apiKeyId: "660e8400-e29b-41d4-a716-446655440000",
      query: "SELECT * FROM users",
      resultCount: 42,
      durationMs: 123.45,
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });
});

describe("QueryLogListInputSchema", () => {
  it("defaults limit to 20", () => {
    const result = QueryLogListInputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
    }
  });

  it("accepts valid cursor", () => {
    const result = QueryLogListInputSchema.safeParse({
      cursor: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects limit over 100", () => {
    const result = QueryLogListInputSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });

  it("rejects limit of 0", () => {
    const result = QueryLogListInputSchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });
});
