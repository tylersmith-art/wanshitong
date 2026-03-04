import { describe, it, expect } from "vitest";
import { AttachSpecSchema, ProjectSpecSchema } from "./projectSpec.js";

const validUuid = "550e8400-e29b-41d4-a716-446655440000";

describe("AttachSpecSchema", () => {
  it("accepts valid input", () => {
    const result = AttachSpecSchema.safeParse({
      projectId: validUuid,
      specId: validUuid,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid projectId", () => {
    const result = AttachSpecSchema.safeParse({
      projectId: "not-a-uuid",
      specId: validUuid,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid specId", () => {
    const result = AttachSpecSchema.safeParse({
      projectId: validUuid,
      specId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});

describe("ProjectSpecSchema", () => {
  it("accepts valid project-spec association", () => {
    const result = ProjectSpecSchema.safeParse({
      id: validUuid,
      projectId: validUuid,
      specId: validUuid,
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });
});
