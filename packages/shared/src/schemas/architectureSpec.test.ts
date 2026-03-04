import { describe, it, expect } from "vitest";
import {
  CreateSpecSchema,
  SpecSchema,
  VisibilitySchema,
  UpdateSpecSchema,
  EmbeddingStatusSchema,
} from "./architectureSpec.js";

const validUuid = "550e8400-e29b-41d4-a716-446655440000";

describe("CreateSpecSchema", () => {
  it("accepts valid input", () => {
    const result = CreateSpecSchema.safeParse({
      name: "REST API Spec",
      content: "openapi: 3.0.0\ninfo:\n  title: My API",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visibility).toBe("user");
      expect(result.data.description).toBe("");
    }
  });

  it("rejects empty name", () => {
    const result = CreateSpecSchema.safeParse({
      name: "",
      content: "some content",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty content", () => {
    const result = CreateSpecSchema.safeParse({
      name: "My Spec",
      content: "",
    });
    expect(result.success).toBe(false);
  });

  it("requires orgId when visibility is 'org'", () => {
    const result = CreateSpecSchema.safeParse({
      name: "Org Spec",
      content: "some content",
      visibility: "org",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("orgId"))).toBe(true);
    }
  });

  it("accepts missing orgId when visibility is 'user'", () => {
    const result = CreateSpecSchema.safeParse({
      name: "User Spec",
      content: "some content",
      visibility: "user",
    });
    expect(result.success).toBe(true);
  });

  it("accepts missing orgId when visibility is 'global'", () => {
    const result = CreateSpecSchema.safeParse({
      name: "Global Spec",
      content: "some content",
      visibility: "global",
    });
    expect(result.success).toBe(true);
  });

  it("accepts orgId when visibility is 'org'", () => {
    const result = CreateSpecSchema.safeParse({
      name: "Org Spec",
      content: "some content",
      visibility: "org",
      orgId: validUuid,
    });
    expect(result.success).toBe(true);
  });
});

describe("SpecSchema", () => {
  it("accepts valid spec", () => {
    const result = SpecSchema.safeParse({
      id: validUuid,
      name: "My Spec",
      description: "A description",
      content: "some content",
      visibility: "user",
      orgId: null,
      userId: validUuid,
      summary: null,
      embeddingStatus: "complete",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("defaults embeddingStatus to 'pending'", () => {
    const result = SpecSchema.safeParse({
      id: validUuid,
      name: "My Spec",
      description: "A description",
      content: "some content",
      visibility: "user",
      orgId: null,
      userId: validUuid,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.embeddingStatus).toBe("pending");
    }
  });
});

describe("VisibilitySchema", () => {
  it("accepts valid values", () => {
    expect(VisibilitySchema.safeParse("global").success).toBe(true);
    expect(VisibilitySchema.safeParse("org").success).toBe(true);
    expect(VisibilitySchema.safeParse("user").success).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(VisibilitySchema.safeParse("private").success).toBe(false);
    expect(VisibilitySchema.safeParse("public").success).toBe(false);
  });
});

describe("EmbeddingStatusSchema", () => {
  it("accepts valid values", () => {
    expect(EmbeddingStatusSchema.safeParse("pending").success).toBe(true);
    expect(EmbeddingStatusSchema.safeParse("processing").success).toBe(true);
    expect(EmbeddingStatusSchema.safeParse("complete").success).toBe(true);
    expect(EmbeddingStatusSchema.safeParse("failed").success).toBe(true);
  });
});

describe("UpdateSpecSchema", () => {
  it("accepts partial updates", () => {
    const result = UpdateSpecSchema.safeParse({ name: "Updated Name" });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    const result = UpdateSpecSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts nullable orgId", () => {
    const result = UpdateSpecSchema.safeParse({ orgId: null });
    expect(result.success).toBe(true);
  });
});
